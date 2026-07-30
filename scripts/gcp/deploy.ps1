[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$CommitSha = "",
    [switch]$Apply,
    [switch]$FullGatePassed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$Repository = "$Region-docker.pkg.dev/$ProjectId/agendaframe"
$JobName = "agendaframe-config-check"
$BuildConfig = Join-Path $RepoRoot "scripts\gcp\cloudbuild.yaml"

function Resolve-CloudSdkCommand {
    param([Parameter(Mandatory)][string]$Name)

    $Installed = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Installed) {
        return $Installed
    }
    $Local = Join-Path $RepoRoot "tmp\google-cloud-sdk\bin\$Name.cmd"
    if (Test-Path -LiteralPath $Local) {
        return Get-Command $Local -ErrorAction Stop
    }
    throw "$Name was not found. Install the Google Cloud CLI or place it under tmp/google-cloud-sdk."
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

if (-not $Apply) {
    Write-Host "Dry run only. No image will be built or deployed." -ForegroundColor Yellow
    Write-Host "Image: $Image"
    Write-Host "Cloud Run Job: $JobName"
    Write-Host "Entrypoint: configuration validation only"
    exit 0
}
if (-not $FullGatePassed) {
    throw "Deployment is blocked until the full offline gate has passed."
}
if ((& git -C $RepoRoot status --porcelain --untracked-files=no).Count -gt 0) {
    throw "Deployment requires no tracked changes so the image matches the reviewed commit."
}
if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $CommitSha) {
    throw "CommitSha must match the checked-out commit."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"
& $Gcloud.Source builds submit $RepoRoot `
    --project $ProjectId `
    --region $Region `
    --config $BuildConfig `
    --substitutions "_IMAGE=$Image" `
    --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed." }

& $Gcloud.Source run jobs deploy $JobName `
    --project $ProjectId `
    --region $Region `
    --image $Image `
    --service-account "analyzer@$ProjectId.iam.gserviceaccount.com" `
    --cpu 1 `
    --memory 512Mi `
    --tasks 1 `
    --max-retries 1 `
    --task-timeout 900s `
    --set-env-vars "GOOGLE_CLOUD_PROJECT=$ProjectId,AGENDAFRAME_LIVE_TESTS=0" `
    --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Run Job deployment failed." }

& $Gcloud.Source run jobs execute $JobName `
    --project $ProjectId `
    --region $Region `
    --wait `
    --quiet
if ($LASTEXITCODE -ne 0) { throw "Staging configuration health check failed." }

Write-Host "Validated immutable image deployed: $Image" -ForegroundColor Green
