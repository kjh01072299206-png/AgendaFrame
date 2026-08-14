[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Region = "asia-northeast3",
    [switch]$Apply,
    [switch]$SpendCapsConfirmed,
    [switch]$DeferStorageLifecycle,
    [switch]$DeferBigQuerySchema
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$SchemaPath = Join-Path $RepoRoot "src\backend\sql\schema.sql"
$GrantsPath = Join-Path $RepoRoot "src\backend\sql\grants.sql"
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
    "Create separate collector, analyzer, publisher, reader, workflow, and scheduler service accounts",
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
$CloudSdkBin = Split-Path -Parent $Gcloud.Source
if (($env:PATH -split [IO.Path]::PathSeparator) -notcontains $CloudSdkBin) {
    $env:PATH = "$CloudSdkBin$([IO.Path]::PathSeparator)$env:PATH"
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
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "workflows.googleapis.com"
)
& $Gcloud.Source services enable @Services --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Failed to enable required APIs." }

if (-not (Test-GcloudResource -Arguments @(
    "artifacts", "repositories", "describe", "agendaframe",
    "--location", $Region, "--project", $ProjectId
))) {
    & $Gcloud.Source artifacts repositories create agendaframe `
        --repository-format docker --location $Region --project $ProjectId `
        --description "AgendaFrame immutable batch images"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Artifact Registry repository." }
}

if (-not (Test-GcloudResource -Arguments @(
    "storage", "buckets", "describe", "gs://$Bucket", "--project", $ProjectId
))) {
    & $Gcloud.Source storage buckets create "gs://$Bucket" `
        --project $ProjectId --location $Region `
        --uniform-bucket-level-access --public-access-prevention
    if ($LASTEXITCODE -ne 0) { throw "Failed to create private body bucket." }
}
if ($DeferStorageLifecycle) {
    Write-Warning (
        "Storage lifecycle update deferred. Do not enable body collection or analysis " +
        "until the lifecycle rule is applied and verified."
    )
}
else {
    & $Gcloud.Source storage buckets update "gs://$Bucket" --lifecycle-file $LifecyclePath
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply the private body retention policy." }
}

if ($DeferBigQuerySchema) {
    Write-Warning (
        "BigQuery schema creation deferred. Do not deploy collection, analysis, " +
        "or publication jobs until the schema is applied and verified."
    )
}
else {
    Get-Content -LiteralPath $SchemaPath -Raw | & $Bq.Source query `
        --project_id=$ProjectId --location=$Region --use_legacy_sql=false `
        --maximum_bytes_billed=1073741824
    if ($LASTEXITCODE -ne 0) { throw "BigQuery schema creation failed." }
}

foreach ($Name in @("builder", "collector", "analyzer", "publisher", "reader", "workflow", "scheduler")) {
    if (-not (Test-GcloudResource -Arguments @(
        "iam", "service-accounts", "describe",
        "$Name@$ProjectId.iam.gserviceaccount.com", "--project", $ProjectId
    ))) {
        & $Gcloud.Source iam service-accounts create $Name `
            --project $ProjectId --display-name "AgendaFrame $Name"
        if ($LASTEXITCODE -ne 0) { throw "Failed to create $Name service account." }
    }
}

$Bindings = @(
    @("builder", "roles/artifactregistry.writer"),
    @("builder", "roles/logging.logWriter"),
    @("builder", "roles/storage.objectViewer"),
    @("collector", "roles/bigquery.dataEditor"),
    @("collector", "roles/bigquery.jobUser"),
    @("collector", "roles/storage.objectCreator"),
    @("analyzer", "roles/aiplatform.user"),
    @("analyzer", "roles/bigquery.dataEditor"),
    @("analyzer", "roles/bigquery.jobUser"),
    @("analyzer", "roles/storage.objectAdmin"),
    @("publisher", "roles/bigquery.dataViewer"),
    @("publisher", "roles/bigquery.jobUser"),
    @("publisher", "roles/secretmanager.secretAccessor"),
    @("reader", "roles/storage.objectViewer"),
    @("workflow", "roles/run.admin"),
    @("scheduler", "roles/workflows.invoker")
)
foreach ($Binding in $Bindings) {
    $Member = "serviceAccount:$($Binding[0])@$ProjectId.iam.gserviceaccount.com"
    & $Gcloud.Source projects add-iam-policy-binding $ProjectId `
        --member $Member --role $Binding[1] --condition=None --quiet | Out-Null
}

# Table-scoped grants run last: a GRANT fails unless both the table and the
# grantee service account already exist. The publisher's project-level role is
# read-only on purpose, so this is what lets mark_published() run its UPDATE.
if ($DeferBigQuerySchema) {
    Write-Warning (
        "Table-scoped BigQuery grants skipped because the schema was deferred. " +
        "The publisher cannot mark rows as published until grants.sql is applied."
    )
}
else {
    Get-Content -LiteralPath $GrantsPath -Raw | & $Bq.Source query `
        --project_id=$ProjectId --location=$Region --use_legacy_sql=false `
        --maximum_bytes_billed=1073741824
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply table-scoped BigQuery grants." }
}

Write-Host "GCP foundation provisioned for $ProjectId." -ForegroundColor Green
