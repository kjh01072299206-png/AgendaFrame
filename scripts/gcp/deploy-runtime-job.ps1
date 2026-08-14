#Requires -Version 5.1
<#
.SYNOPSIS
    Builds and deploys the reviewed six-stage GCP runtime Cloud Run Job.

.DESCRIPTION
    This is the recurring-pipeline deployment path. It is deliberately
    separate from deploy.ps1 (configuration check) and deploy-trial-jobs.ps1
    (the historical 2026-07-26 one-shot importer). Dry-run is the default.
    The job command is the real gcp_job_entrypoint and will fail closed unless
    the workflow supplies a unique scheduled time/run ID and GCP owns the
    schedule.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$CommitSha = "",
    [switch]$Apply,
    [switch]$FullGatePassed,
    [switch]$Execute,
    [string]$RunId = "",
    [string]$ScheduledTime = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$Repository = "$Region-docker.pkg.dev/$ProjectId/agendaframe"
$JobName = "agendaframe-collection-analysis"
$BuildConfig = Join-Path $RepoRoot "scripts\gcp\cloudbuild.yaml"

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
if (-not $CommitSha) { $CommitSha = (& git -C $RepoRoot rev-parse HEAD).Trim() }
if ($CommitSha -notmatch "^[a-f0-9]{40}$") { throw "CommitSha must be a full immutable Git commit SHA." }
$Image = "$Repository/runtime:$CommitSha"

if (-not $Apply) {
    Write-Host "Dry run only. No image will be built or deployed." -ForegroundColor Yellow
    Write-Host "Image: $Image"
    Write-Host "Job:   $JobName"
    Write-Host "Command: python -m backend.gcp_job_entrypoint"
    Write-Host "Owner: GCP only (Cloudflare and legacy schedules false)"
    Write-Host "Execution requires workflow-injected AGENDAFRAME_RUN_ID/SCHEDULED_TIME."
    exit 0
}
if (-not $FullGatePassed) { throw "Deployment is blocked until the full offline gate has passed." }
$TrackedChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=no)
if ($TrackedChanges.Count -gt 0) { throw "Deployment requires no tracked changes for the immutable image." }
if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $CommitSha) { throw "CommitSha must match the checked-out commit." }
if ($Execute -and (-not $RunId -or -not $ScheduledTime)) {
    throw "-RunId and -ScheduledTime are required when -Execute is used."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"
& $Gcloud.Source builds submit $RepoRoot `
    --project $ProjectId --region $Region --config $BuildConfig `
    --substitutions "_IMAGE=$Image" --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed." }

$EnvVars = @(
    "GOOGLE_CLOUD_PROJECT=$ProjectId",
    "AGENDAFRAME_ADAPTER_MODE=gcp",
    "AGENDAFRAME_ADAPTER_FACTORY=backend.gcp_production_adapters:production_adapter_factory",
    "AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY=backend.gcp_live_dependencies:build_stage_dependencies",
    "AGENDAFRAME_PIPELINE_OWNER=gcp",
    "AGENDAFRAME_CLOUDFLARE_CRON_ENABLED=false",
    "AGENDAFRAME_LEGACY_SCHEDULE_ENABLED=false",
    "AGENDAFRAME_SCHEDULED_TIME=workflow_injected"
)
& $Gcloud.Source run jobs deploy $JobName `
    --project $ProjectId --region $Region --image $Image `
    --service-account "analyzer@$ProjectId.iam.gserviceaccount.com" `
    --command python "--args=-m,backend.gcp_job_entrypoint" `
    --cpu 1 --memory 512Mi --tasks 1 --max-retries 1 --task-timeout 900s `
    --set-env-vars ($EnvVars -join ",") --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Run runtime job deployment failed." }

if (-not $Execute) {
    Write-Host "Runtime job deployed; no billed execution started." -ForegroundColor Yellow
    exit 0
}

& $Gcloud.Source run jobs execute $JobName --project $ProjectId --region $Region `
    --update-env-vars "AGENDAFRAME_RUN_ID=$RunId,AGENDAFRAME_SCHEDULED_TIME=$ScheduledTime" `
    --wait --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Run runtime job execution failed." }
Write-Host "Runtime canary completed: $RunId" -ForegroundColor Green
