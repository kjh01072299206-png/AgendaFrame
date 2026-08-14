#Requires -Version 5.1
<#
.SYNOPSIS
    Provisions the recurring pipeline's Pub/Sub, Secret Manager, and alerts.

.DESCRIPTION
    Dry-run is the default. The apply path is deliberately separate from the
    foundation provisioner because it creates message delivery and alerting
    resources. It never creates secret versions: operators must add approved
    values through Secret Manager after the containers and IAM are verified.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$NotificationChannel = "",
    [switch]$Apply,
    [switch]$SpendCapsConfirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$TopicName = "agenda-article-analysis"
$DeadLetterTopicName = "agenda-article-analysis-dlq"
$SubscriptionName = "agenda-article-analysis-worker"
$SecretDefinitions = @(
    @{ Id = "agendaframe-news-source-auth"; Account = "collector" },
    @{ Id = "agendaframe-vertex-service-config"; Account = "analyzer" },
    @{ Id = "agendaframe-site-import-token"; Account = "publisher" }
)
$MetricDefinitions = @(
    @{ Name = "agendaframe_collection_run_failed"; Kind = "DELTA"; ValueType = "INT64"; Unit = "1"; Filter = 'jsonPayload.service="agendaframe" AND jsonPayload.event="collection_run_failed"' },
    @{ Name = "agendaframe_collection_run_succeeded"; Kind = "DELTA"; ValueType = "INT64"; Unit = "1"; Filter = 'jsonPayload.service="agendaframe" AND jsonPayload.event="collection_run_succeeded"' },
    @{ Name = "agendaframe_active_snapshot_published"; Kind = "DELTA"; ValueType = "INT64"; Unit = "1"; Filter = 'jsonPayload.service="agendaframe" AND jsonPayload.event="active_snapshot_published"' },
    @{ Name = "agendaframe_quality_gate_failed"; Kind = "DELTA"; ValueType = "INT64"; Unit = "1"; Filter = 'jsonPayload.service="agendaframe" AND jsonPayload.event="quality_gate_failed"' }
)
$AlertDefinitions = @(
    @{ DisplayName = "AgendaFrame collection run failed"; Metric = "agendaframe_collection_run_failed"; Kind = "threshold"; Comparison = "COMPARISON_GT"; Threshold = 0; Duration = "300s"; Severity = "CRITICAL" },
    @{ DisplayName = "AgendaFrame collection delayed"; Metric = "agendaframe_collection_run_succeeded"; Kind = "absence"; Duration = "5400s"; Severity = "WARNING" },
    @{ DisplayName = "AgendaFrame active snapshot too old"; Metric = "agendaframe_active_snapshot_published"; Kind = "absence"; Duration = "9000s"; Severity = "CRITICAL" },
    @{ DisplayName = "AgendaFrame quality gate failed"; Metric = "agendaframe_quality_gate_failed"; Kind = "threshold"; Comparison = "COMPARISON_GT"; Threshold = 0; Duration = "900s"; Severity = "WARNING" }
)

function Resolve-CloudSdkCommand {
    param([Parameter(Mandatory)][string]$Name)

    $Installed = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Installed) { return $Installed }
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
    $Local = Join-Path $RepoRoot "tmp\google-cloud-sdk\bin\$Name.cmd"
    if (Test-Path -LiteralPath $Local) { return Get-Command $Local -ErrorAction Stop }
    throw "$Name was not found. Install the Google Cloud CLI or place it under tmp/google-cloud-sdk."
}

if ($ProjectId -ne $ExpectedProject) { throw "Refusing to target an unreviewed project: $ProjectId" }

if (-not $Apply) {
    Write-Host "Dry run only. No Pub/Sub, Secret Manager, Logging, or Monitoring resource will change." -ForegroundColor Yellow
    Write-Host "Pub/Sub: $TopicName + $SubscriptionName + $DeadLetterTopicName"
    Write-Host "Secrets: $($SecretDefinitions.Id -join ', ') (containers only; no values)"
    Write-Host "Alerts:  $($AlertDefinitions.DisplayName -join ', ')"
    Write-Host "Re-run with -Apply -SpendCapsConfirmed -NotificationChannel <full channel name>."
    exit 0
}

if (-not $SpendCapsConfirmed) {
    throw "Apply is blocked until Vertex AI and Cloud Run spend caps are confirmed."
}
if ($NotificationChannel -notmatch "^projects/$([regex]::Escape($ProjectId))/notificationChannels/[0-9]+$") {
    throw "NotificationChannel must be a full projects/$ProjectId/notificationChannels/<number> name."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"

function Invoke-Gcloud {
    param([Parameter(Mandatory)][string[]]$Arguments)

    & $Gcloud.Source @Arguments
    if ($LASTEXITCODE -ne 0) { throw "gcloud command failed: $($Arguments[0..1] -join ' ')" }
}

function Test-GcloudResource {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $PreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & $Gcloud.Source @Arguments *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $PreviousPreference
    }
}

function Ensure-PubSubTopic {
    param([Parameter(Mandatory)][string]$Name)

    if (-not (Test-GcloudResource -Arguments @("pubsub", "topics", "describe", $Name, "--project=$ProjectId"))) {
        Invoke-Gcloud -Arguments @("pubsub", "topics", "create", $Name, "--project=$ProjectId", "--message-retention-duration=1209600s")
    }
}

Ensure-PubSubTopic -Name $TopicName
Ensure-PubSubTopic -Name $DeadLetterTopicName

if (-not (Test-GcloudResource -Arguments @("pubsub", "subscriptions", "describe", $SubscriptionName, "--project=$ProjectId"))) {
    Invoke-Gcloud -Arguments @(
        "pubsub", "subscriptions", "create", $SubscriptionName,
        "--project=$ProjectId", "--topic=$TopicName", "--ack-deadline=600",
        "--min-retry-delay=10s", "--max-retry-delay=600s",
        "--dead-letter-topic=projects/$ProjectId/topics/$DeadLetterTopicName",
        "--max-delivery-attempts=5", "--enable-exactly-once-delivery",
        "--enable-message-ordering"
    )
}

$ProjectNumber = (& $Gcloud.Source projects describe $ProjectId --format="value(projectNumber)").Trim()
if (-not $ProjectNumber) { throw "Could not resolve the GCP project number." }
$PubSubServiceAgent = "service-$ProjectNumber@gcp-sa-pubsub.iam.gserviceaccount.com"

Invoke-Gcloud -Arguments @("pubsub", "topics", "add-iam-policy-binding", $TopicName, "--project=$ProjectId", "--member=serviceAccount:collector@$ProjectId.iam.gserviceaccount.com", "--role=roles/pubsub.publisher")
Invoke-Gcloud -Arguments @("pubsub", "subscriptions", "add-iam-policy-binding", $SubscriptionName, "--project=$ProjectId", "--member=serviceAccount:analyzer@$ProjectId.iam.gserviceaccount.com", "--role=roles/pubsub.subscriber")
Invoke-Gcloud -Arguments @("pubsub", "topics", "add-iam-policy-binding", $DeadLetterTopicName, "--project=$ProjectId", "--member=serviceAccount:$PubSubServiceAgent", "--role=roles/pubsub.publisher")
Invoke-Gcloud -Arguments @("pubsub", "subscriptions", "add-iam-policy-binding", $SubscriptionName, "--project=$ProjectId", "--member=serviceAccount:$PubSubServiceAgent", "--role=roles/pubsub.subscriber")

foreach ($Secret in $SecretDefinitions) {
    if (-not (Test-GcloudResource -Arguments @("secrets", "describe", $Secret.Id, "--project=$ProjectId"))) {
        Invoke-Gcloud -Arguments @("secrets", "create", $Secret.Id, "--project=$ProjectId", "--replication-policy=user-managed", "--locations=$Region")
    }
    Invoke-Gcloud -Arguments @(
        "secrets", "add-iam-policy-binding", $Secret.Id, "--project=$ProjectId",
        "--member=serviceAccount=$($Secret.Account)@$ProjectId.iam.gserviceaccount.com",
        "--role=roles/secretmanager.secretAccessor"
    )
}

foreach ($Metric in $MetricDefinitions) {
    if (-not (Test-GcloudResource -Arguments @("logging", "metrics", "describe", $Metric.Name, "--project=$ProjectId"))) {
        $MetricConfig = @{
            name = $Metric.Name
            description = "AgendaFrame $($Metric.Name)"
            filter = $Metric.Filter
            metricDescriptor = @{
                metricKind = $Metric.Kind
                valueType = $Metric.ValueType
                unit = $Metric.Unit
            }
        } | ConvertTo-Json -Depth 8
        $TempMetric = [IO.Path]::GetTempFileName()
        try {
            [IO.File]::WriteAllText($TempMetric, $MetricConfig, [Text.UTF8Encoding]::new($false))
            Invoke-Gcloud -Arguments @(
                "logging", "metrics", "create", $Metric.Name, "--project=$ProjectId",
                "--config-from-file=$TempMetric"
            )
        }
        finally {
            Remove-Item -LiteralPath $TempMetric -Force -ErrorAction SilentlyContinue
        }
    }
}

foreach ($Alert in $AlertDefinitions) {
    $DisplayFilter = 'displayName="{0}"' -f $Alert.DisplayName
    $Existing = (& $Gcloud.Source "monitoring" "policies" "list" "--project=$ProjectId" "--filter=$DisplayFilter" "--format=value(name)").Trim()
    $Condition = if ($Alert.Kind -eq "absence") {
        @{
            displayName = "$($Alert.DisplayName) absence"
            conditionAbsent = @{
                filter = 'metric.type="logging.googleapis.com/user/{0}" resource.type="global"' -f $Alert.Metric
                duration = $Alert.Duration
                trigger = @{ count = 1 }
            }
        }
    }
    else {
        @{
            displayName = "$($Alert.DisplayName) threshold"
            conditionThreshold = @{
                filter = 'metric.type="logging.googleapis.com/user/{0}" resource.type="global"' -f $Alert.Metric
                comparison = $Alert.Comparison
                thresholdValue = $Alert.Threshold
                duration = $Alert.Duration
                trigger = @{ count = 1 }
            }
        }
    }
    $Policy = @{
        displayName = $Alert.DisplayName
        combiner = "OR"
        enabled = $true
        notificationChannels = @($NotificationChannel)
        conditions = @($Condition)
    } | ConvertTo-Json -Depth 10
    $TempPolicy = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($TempPolicy, $Policy, [Text.UTF8Encoding]::new($false))
        if ($Existing) {
            Invoke-Gcloud -Arguments @("monitoring", "policies", "update", $Existing, "--project=$ProjectId", "--policy-from-file=$TempPolicy")
        }
        else {
            Invoke-Gcloud -Arguments @("monitoring", "policies", "create", "--project=$ProjectId", "--policy-from-file=$TempPolicy")
        }
    }
    finally {
        Remove-Item -LiteralPath $TempPolicy -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Recurring messaging, secret containers, log metrics, and alert policies are ready." -ForegroundColor Green
Write-Host "No secret versions were created; add approved values through Secret Manager separately."
