#Requires -Version 5.1
<#
.SYNOPSIS
    Deploys the two one-shot Cloud Run Jobs for the reviewed 2026-07-26 framing
    pilot: agendaframe-frame-trial (analysis) and agendaframe-publish-trial
    (publication).

.DESCRIPTION
    deploy.ps1 only ever deploys agendaframe-config-check, which validates
    configuration and never analyzes an article. The pilot needs two further
    jobs. Defining them here instead of typing gcloud by hand keeps the same
    guards deploy.ps1 enforces:

      * the project ID is hard-pinned and refuses anything else,
      * nothing happens without -Apply (dry run is the default),
      * nothing happens without -FullGatePassed,
      * the tracked working tree must be clean,
      * the image tag must be a full 40-hex SHA equal to the checked-out commit.

    These jobs are deliberately one-shot. No Cloud Scheduler trigger is created
    and none should be: every configured news source is still metadata_only and
    the analysis input is a hand-reviewed authorization file, not a crawl.

.NOTES
    max-retries is pinned to 0, which differs from cloud_run.max_retries: 1 in
    config/gcp-runtime.yaml. That is intentional for a paid single-shot run. A
    retry of the publish job could re-import a cluster that already reached the
    site, and a retry of the analysis job could spend Vertex quota twice on the
    same seven articles. The recurring pipeline can keep the config default.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$CommitSha = "",

    # gs://<private bucket>/transient-inputs/... uploaded for this run only.
    [string]$InputGcsUri = "",
    [string]$AuthorizationGcsUri = "",

    # Publication settings. The approval file is read from inside the image, so
    # this stays a repository-relative path (WORKDIR is /app and config/ ships).
    [string]$ClusterApprovalPath = "config/analysis-approvals/2026-07-26-rank-1.json",
    [string]$TargetDate = "2026-07-26",
    [int]$PublishLimit = 7,
    [string]$SiteOrigin = "https://agendaframe-capstone.kjh01072299206.chatgpt.site",
    [string]$ImportTokenSecret = "CODEX_IMPORT_TOKEN",

    [ValidateSet("analysis", "publish", "both")]
    [string]$Job = "both",

    [switch]$Apply,
    [switch]$FullGatePassed,

    # Deploying is free; running the jobs is not. Executing is a separate,
    # explicit opt-in so the billed step never happens as a side effect.
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$Repository = "$Region-docker.pkg.dev/$ProjectId/agendaframe"
$Bucket = "$ProjectId-agendaframe-private"
$AnalysisJobName = "agendaframe-frame-trial"
$PublishJobName = "agendaframe-publish-trial"

function Resolve-CloudSdkCommand {
    param([Parameter(Mandatory)][string]$Name)

    # Prefer the native launcher over gcloud.ps1 on Windows.
    $Installed = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
    if (-not $Installed) { $Installed = Get-Command $Name -ErrorAction SilentlyContinue }
    if ($Installed) {
        return $Installed
    }
    $Local = Join-Path $RepoRoot "tmp\google-cloud-sdk\bin\$Name.cmd"
    if (Test-Path -LiteralPath $Local) {
        return Get-Command $Local -ErrorAction Stop
    }
    throw "$Name was not found. Install the Google Cloud CLI or place it under tmp/google-cloud-sdk."
}

function Assert-TransientInputUri {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$Label
    )

    # Mirrors backend.main._private_gcs_parts so a bad URI fails here rather
    # than inside a billed container.
    $Expected = "gs://$Bucket/transient-inputs/"
    if (-not $Uri.StartsWith($Expected, [StringComparison]::Ordinal)) {
        throw "$Label must start with $Expected"
    }
    if ($Uri.Length -le $Expected.Length) {
        throw "$Label is missing an object name under transient-inputs/."
    }
}

if ($ProjectId -ne $ExpectedProject) {
    throw "Refusing to target an unreviewed project: $ProjectId"
}
if (-not $CommitSha) {
    $CommitSha = (& git -C $RepoRoot rev-parse HEAD).Trim()
}
if ($CommitSha -notmatch "^[a-f0-9]{40}$") {
    throw "CommitSha must be a full immutable Git commit SHA."
}
$Image = "$Repository/runtime:$CommitSha"

$DeployAnalysis = $Job -in @("analysis", "both")
$DeployPublish = $Job -in @("publish", "both")

if ($DeployAnalysis) {
    if (-not $InputGcsUri -or -not $AuthorizationGcsUri) {
        throw "-InputGcsUri and -AuthorizationGcsUri are required to deploy $AnalysisJobName."
    }
    Assert-TransientInputUri -Uri $InputGcsUri -Label "-InputGcsUri"
    Assert-TransientInputUri -Uri $AuthorizationGcsUri -Label "-AuthorizationGcsUri"
}
if ($DeployPublish) {
    $ApprovalFullPath = Join-Path $RepoRoot $ClusterApprovalPath
    if (-not (Test-Path -LiteralPath $ApprovalFullPath)) {
        throw "Cluster approval file not found in the repository: $ClusterApprovalPath"
    }
    if (-not $ClusterApprovalPath.StartsWith("config/", [StringComparison]::Ordinal)) {
        throw "The approval file must live under config/ so .gcloudignore ships it in the image."
    }
}

$AnalysisArgs = @(
    "live-run",
    "--input-gcs-uri=$InputGcsUri",
    "--authorization-gcs-uri=$AuthorizationGcsUri"
)
$PublishArgs = @(
    "publish",
    "--limit=$PublishLimit",
    "--date=$TargetDate",
    "--analyze-date=$TargetDate",
    "--cluster-approval-json=$ClusterApprovalPath"
)

if (-not $Apply) {
    Write-Host "Dry run only. No Cloud Run Job will be deployed or executed." -ForegroundColor Yellow
    Write-Host "Image: $Image"
    if ($DeployAnalysis) {
        Write-Host "Job:   $AnalysisJobName (analyzer service account)"
        Write-Host "Args:  $($AnalysisArgs -join ' ')"
    }
    if ($DeployPublish) {
        Write-Host "Job:   $PublishJobName (publisher service account)"
        Write-Host "Args:  $($PublishArgs -join ' ')"
        # Braces are required: "$ImportTokenSecret:latest" would parse as a
        # scope-qualified variable and print an empty secret name.
        Write-Host "Secret: AGENDAFRAME_IMPORT_TOKEN <- ${ImportTokenSecret}:latest"
    }
    Write-Host "Re-run with -Apply -FullGatePassed to deploy. Add -Execute to run them."
    exit 0
}
if (-not $FullGatePassed) {
    throw "Deployment is blocked until the full offline gate has passed."
}
$TrackedChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=no)
if ($TrackedChanges.Count -gt 0) {
    throw "Deployment requires no tracked changes so the image matches the reviewed commit."
}
if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $CommitSha) {
    throw "CommitSha must match the checked-out commit."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"

if (-not (& $Gcloud.Source artifacts docker images describe $Image `
        --project $ProjectId --format="value(image_summary.digest)" 2>$null)) {
    throw "Image not found in Artifact Registry: $Image. Run deploy.ps1 first."
}

function Deploy-TrialJob {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ServiceAccount,
        [Parameter(Mandatory)][string[]]$JobArgs,
        [string[]]$ExtraFlags = @()
    )

    $CommonFlags = @(
        "--project", $ProjectId,
        "--region", $Region,
        "--image", $Image,
        "--service-account", $ServiceAccount,
        "--cpu", "1",
        "--memory", "512Mi",
        "--tasks", "1",
        "--max-retries", "0",
        "--task-timeout", "900s",
        "--args", ($JobArgs -join ","),
        "--quiet"
    )
    & $Gcloud.Source run jobs deploy $Name @CommonFlags @ExtraFlags
    if ($LASTEXITCODE -ne 0) { throw "Cloud Run Job deployment failed: $Name" }
    Write-Host "Deployed $Name from $Image" -ForegroundColor Green
}

if ($DeployAnalysis) {
    Deploy-TrialJob -Name $AnalysisJobName `
        -ServiceAccount "analyzer@$ProjectId.iam.gserviceaccount.com" `
        -JobArgs $AnalysisArgs `
        -ExtraFlags @(
            "--set-env-vars",
            "GOOGLE_CLOUD_PROJECT=$ProjectId,AGENDAFRAME_LIVE_TESTS=1"
        )
}

if ($DeployPublish) {
    Deploy-TrialJob -Name $PublishJobName `
        -ServiceAccount "publisher@$ProjectId.iam.gserviceaccount.com" `
        -JobArgs $PublishArgs `
        -ExtraFlags @(
            "--set-env-vars",
            "GOOGLE_CLOUD_PROJECT=$ProjectId,AGENDAFRAME_LIVE_TESTS=1,AGENDAFRAME_SITE_ORIGIN=$SiteOrigin",
            "--set-secrets",
            "AGENDAFRAME_IMPORT_TOKEN=${ImportTokenSecret}:latest"
        )
}

if (-not $Execute) {
    Write-Host "Deployment complete. Re-run with -Execute to start a billed run." -ForegroundColor Yellow
    exit 0
}

# Execution order is not interchangeable. The analysis job must finish and land
# rows in BigQuery before the publish job has anything approved to publish.
$ExecutionOrder = @()
if ($DeployAnalysis) { $ExecutionOrder += $AnalysisJobName }
if ($DeployPublish) { $ExecutionOrder += $PublishJobName }

foreach ($Name in $ExecutionOrder) {
    Write-Host "Executing $Name ..." -ForegroundColor Cyan
    & $Gcloud.Source run jobs execute $Name `
        --project $ProjectId --region $Region --wait --quiet
    if ($LASTEXITCODE -ne 0) { throw "Cloud Run Job execution failed: $Name" }
    Write-Host "Completed $Name" -ForegroundColor Green
}
