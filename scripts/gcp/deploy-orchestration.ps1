#Requires -Version 5.1
<#
.SYNOPSIS
    Deploys the reviewed Workflows source and, only when requested, its
    four-times-per-day Cloud Scheduler trigger.

.DESCRIPTION
    Dry-run is the default. The workflow source invokes the existing
    body-free Cloud Run Job and derives the KST basis date from the workflow
    clock. Scheduler creation is a separate explicit switch because it starts
    recurring billed work and transfers ownership from the current schedule.
    This script never disables the Cloudflare cron implicitly; cutover and
    rollback remain an explicit migration-ownership operation.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$CommitSha = "",
    [switch]$Apply,
    [switch]$FullGatePassed,
    [switch]$CreateScheduler
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$WorkflowName = "agendaframe-collection-analysis"
$SchedulerJobName = "agendaframe-collection-4x-kst"
$WorkflowSource = Join-Path $RepoRoot "infra\gcp\workflow-runtime.yaml"
$Schedule = "0 3,9,15,21 * * *"
$Timezone = "Etc/UTC"
$WorkflowServiceAccount = "workflow@$ProjectId.iam.gserviceaccount.com"
$SchedulerServiceAccount = "scheduler@$ProjectId.iam.gserviceaccount.com"

function Resolve-CloudSdkCommand {
    param([Parameter(Mandatory)][string]$Name)

    # Prefer the native launcher over gcloud.ps1 on Windows.
    $Installed = Get-Command "$Name.cmd" -ErrorAction SilentlyContinue
    if (-not $Installed) { $Installed = Get-Command $Name -ErrorAction SilentlyContinue }
    if ($Installed) { return $Installed }
    $Local = Join-Path $RepoRoot "tmp\google-cloud-sdk\bin\$Name.cmd"
    if (Test-Path -LiteralPath $Local) { return Get-Command $Local -ErrorAction Stop }
    throw "$Name was not found. Install the Google Cloud CLI or place it under tmp/google-cloud-sdk."
}

if ($ProjectId -ne $ExpectedProject) { throw "Refusing to target an unreviewed project: $ProjectId" }
if (-not (Test-Path -LiteralPath $WorkflowSource -PathType Leaf)) {
    throw "Deployable Workflows source is missing: $WorkflowSource"
}
if (-not $CommitSha) { $CommitSha = (& git -C $RepoRoot rev-parse HEAD).Trim() }
if ($CommitSha -notmatch "^[a-f0-9]{40}$") { throw "CommitSha must be a full immutable Git commit SHA." }

if (-not $Apply) {
    Write-Host "Dry run only. No workflow or scheduler resource will be changed." -ForegroundColor Yellow
    Write-Host "Workflow source: $WorkflowSource"
    Write-Host "Workflow:       $WorkflowName ($Region)"
    Write-Host "Workflow SA:    $WorkflowServiceAccount"
    Write-Host "Schedule:       $Schedule ($Timezone)"
    Write-Host "Scheduler SA:   $SchedulerServiceAccount"
    Write-Host "Scheduler job is created only with -Apply -FullGatePassed -CreateScheduler."
    exit 0
}

if (-not $FullGatePassed) { throw "Deployment is blocked until the full offline gate has passed." }
$TrackedChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=no)
if ($TrackedChanges.Count -gt 0) { throw "Deployment requires no tracked changes for the immutable workflow source." }
if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $CommitSha) {
    throw "CommitSha must match the checked-out commit."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"
& $Gcloud.Source workflows deploy $WorkflowName `
    --project $ProjectId --location $Region --source $WorkflowSource `
    --service-account $WorkflowServiceAccount --call-log-level log-errors-only --quiet
if ($LASTEXITCODE -ne 0) { throw "Workflows deployment failed." }

if (-not $CreateScheduler) {
    Write-Host "Workflow deployed; recurring Scheduler trigger was not created." -ForegroundColor Yellow
    exit 0
}

$ExecutionUri = "https://workflowexecutions.googleapis.com/v1/projects/$ProjectId/locations/$Region/workflows/$WorkflowName/executions"
$MessageBodyFile = Join-Path $RepoRoot "infra\gcp\scheduler-execution-body.json"
if (-not (Test-Path -LiteralPath $MessageBodyFile -PathType Leaf)) {
    throw "Scheduler execution body is missing: $MessageBodyFile"
}
$SchedulerArgs = @(
    "--location", $Region,
    "--schedule", $Schedule,
    "--time-zone", $Timezone,
    "--uri", $ExecutionUri,
    "--http-method", "POST",
    "--message-body-from-file", $MessageBodyFile,
    "--oauth-service-account-email", $SchedulerServiceAccount,
    "--quiet"
)

$Existing = $false
$PreviousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "SilentlyContinue"
    & $Gcloud.Source scheduler jobs describe $SchedulerJobName --location $Region --project $ProjectId *> $null
    $Existing = $LASTEXITCODE -eq 0
}
finally {
    $ErrorActionPreference = $PreviousPreference
}

if ($Existing) {
    & $Gcloud.Source scheduler jobs update http $SchedulerJobName --project $ProjectId @SchedulerArgs --update-headers "Content-Type=application/json"
}
else {
    & $Gcloud.Source scheduler jobs create http $SchedulerJobName --project $ProjectId @SchedulerArgs --headers "Content-Type=application/json"
}
if ($LASTEXITCODE -ne 0) { throw "Cloud Scheduler deployment failed." }

Write-Host "Workflow and four-times-per-day Scheduler trigger deployed." -ForegroundColor Green
Write-Host "Cloudflare ownership is unchanged; perform the explicit cutover only after canary verification."
