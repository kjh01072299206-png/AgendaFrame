[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [switch]$Apply,
    [switch]$SpendCapsConfirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$SchemaPath = Join-Path $RepoRoot "src\backend\sql\schema.sql"
$LifecyclePath = Join-Path $RepoRoot "config\gcp\storage-lifecycle.json"
$Bucket = "$ProjectId-agendaframe-private"

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

$Plan = @(
    "Enable only required APIs",
    "Create a regional Artifact Registry repository",
    "Create a private Cloud Storage bucket with automatic body deletion",
    "Create partitioned BigQuery tables with required partition filters",
    "Create separate collector, analyzer, and publisher service accounts",
    "Grant least-privilege roles"
)

if (-not $Apply) {
    Write-Host "Dry run only. No GCP resource will be changed." -ForegroundColor Yellow
    $Plan | ForEach-Object { Write-Host "- $_" }
    Write-Host "Re-run with -Apply -SpendCapsConfirmed after configuring spend caps."
    exit 0
}

if (-not $SpendCapsConfirmed) {
    throw "Apply is blocked until Vertex AI and Cloud Run spend caps are confirmed."
}

$Gcloud = Resolve-CloudSdkCommand -Name "gcloud"
$Bq = Resolve-CloudSdkCommand -Name "bq"

$Account = (& $Gcloud.Source auth list --filter=status:ACTIVE --format="value(account)").Trim()
if (-not $Account) {
    throw "No active gcloud account. Run gcloud auth login first."
}

& $Gcloud.Source config set project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Failed to select project." }

$Services = @(
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com"
)
& $Gcloud.Source services enable @Services --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Failed to enable required APIs." }

& $Gcloud.Source artifacts repositories describe agendaframe --location $Region --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Gcloud.Source artifacts repositories create agendaframe `
        --repository-format docker --location $Region --project $ProjectId `
        --description "AgendaFrame immutable batch images"
}

& $Gcloud.Source storage buckets describe "gs://$Bucket" --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Gcloud.Source storage buckets create "gs://$Bucket" `
        --project $ProjectId --location $Region `
        --uniform-bucket-level-access --public-access-prevention
}
& $Gcloud.Source storage buckets update "gs://$Bucket" --lifecycle-file $LifecyclePath

Get-Content -LiteralPath $SchemaPath -Raw | & $Bq.Source query `
    --project_id=$ProjectId --location=$Region --use_legacy_sql=false `
    --maximum_bytes_billed=1073741824
if ($LASTEXITCODE -ne 0) { throw "BigQuery schema creation failed." }

foreach ($Name in @("collector", "analyzer", "publisher")) {
    & $Gcloud.Source iam service-accounts describe `
        "$Name@$ProjectId.iam.gserviceaccount.com" --project $ProjectId 2>$null
    if ($LASTEXITCODE -ne 0) {
        & $Gcloud.Source iam service-accounts create $Name `
            --project $ProjectId --display-name "AgendaFrame $Name"
    }
}

$Bindings = @(
    @("collector", "roles/bigquery.dataEditor"),
    @("collector", "roles/bigquery.jobUser"),
    @("collector", "roles/storage.objectCreator"),
    @("analyzer", "roles/aiplatform.user"),
    @("analyzer", "roles/bigquery.dataEditor"),
    @("analyzer", "roles/bigquery.jobUser"),
    @("analyzer", "roles/storage.objectAdmin"),
    @("publisher", "roles/bigquery.dataViewer"),
    @("publisher", "roles/bigquery.jobUser"),
    @("publisher", "roles/secretmanager.secretAccessor")
)
foreach ($Binding in $Bindings) {
    $Member = "serviceAccount:$($Binding[0])@$ProjectId.iam.gserviceaccount.com"
    & $Gcloud.Source projects add-iam-policy-binding $ProjectId `
        --member $Member --role $Binding[1] --condition=None --quiet | Out-Null
}

Write-Host "GCP foundation provisioned for $ProjectId." -ForegroundColor Green
