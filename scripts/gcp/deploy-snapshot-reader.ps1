#Requires -Version 5.1
<#
.SYNOPSIS
    Builds and deploys the body-free active snapshot reader as a Cloud Run service.

.DESCRIPTION
    Dry-run is the default. The service is separate from the recurring Cloud
    Run Job: it reads only validated immutable public snapshot objects with a
    read-only service account. Applying requires a reviewed full SHA, a clean
    tracked tree, the offline full gate, and explicit public-endpoint consent.
    Traffic stays disabled unless -Promote is also supplied.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [string]$CommitSha = "",
    [string]$Bucket = "project-40bc06fc-fb4b-46b6-a10-agendaframe-private",
    [switch]$Apply,
    [switch]$FullGatePassed,
    [switch]$AllowUnauthenticated,
    [switch]$Promote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$ExpectedBucket = "$ExpectedProject-agendaframe-private"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$Repository = "$Region-docker.pkg.dev/$ProjectId/agendaframe"
$ServiceName = "agendaframe-snapshot-reader"
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
if ($Bucket -ne $ExpectedBucket) { throw "Refusing to target an unreviewed private bucket: $Bucket" }
if (-not $CommitSha) { $CommitSha = (& git -C $RepoRoot rev-parse HEAD).Trim() }
if ($CommitSha -notmatch "^[a-f0-9]{40}$") { throw "CommitSha must be a full immutable Git commit SHA." }
$Image = "$Repository/snapshot-reader:$CommitSha"

if (-not $Apply) {
    Write-Host "Dry run only. No image will be built or deployed." -ForegroundColor Yellow
    Write-Host "Image:   $Image"
    Write-Host "Service: $ServiceName"
    Write-Host "Command: python -m backend.gcp_snapshot_reader_service"
    Write-Host "Bucket:  $Bucket (read-only)"
    Write-Host "Traffic: disabled unless -Promote is explicitly supplied"
    exit 0
}
if (-not $FullGatePassed) { throw "Deployment is blocked until the full offline gate has passed." }
if (-not $AllowUnauthenticated) {
    throw "The Vercel server fetch requires explicit -AllowUnauthenticated consent for this public read-only boundary."
}
if ($Promote -and -not $AllowUnauthenticated) {
    throw "-Promote requires the explicit public endpoint consent."
}
$TrackedChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=no)
if ($TrackedChanges.Count -gt 0) { throw "Deployment requires no tracked changes for the immutable image." }
if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $CommitSha) { throw "CommitSha must match the checked-out commit." }

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"
& $Gcloud.Source builds submit $RepoRoot `
    --project $ProjectId --region $Region --config $BuildConfig `
    --substitutions "_IMAGE=$Image" --quiet
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed." }

$EnvVars = @(
    "GOOGLE_CLOUD_PROJECT=$ProjectId",
    "AGENDAFRAME_PRIVATE_BUCKET=$Bucket"
)
$TrafficArgs = @("--no-traffic")
if ($Promote) { $TrafficArgs = @("--allow-unauthenticated") }
# Current Cloud SDK exposes service deployment as `gcloud run deploy`; the
# `run services deploy` alias is not available on all Windows installations.
& $Gcloud.Source run deploy $ServiceName `
    --project $ProjectId --region $Region --image $Image `
    --service-account "reader@$ProjectId.iam.gserviceaccount.com" `
    --command python "--args=-m,backend.gcp_snapshot_reader_service" `
    --cpu 1 --memory 256Mi --min 0 --max 2 `
    --set-env-vars ($EnvVars -join ",") @TrafficArgs --quiet
if ($LASTEXITCODE -ne 0) { throw "Snapshot-reader Cloud Run deployment failed." }

if (-not $Promote) {
    Write-Host "Snapshot-reader revision deployed with no traffic. Verify /healthz and /active before promotion." -ForegroundColor Yellow
    exit 0
}

Write-Host "Snapshot-reader promoted with public read-only traffic: $ServiceName" -ForegroundColor Green
