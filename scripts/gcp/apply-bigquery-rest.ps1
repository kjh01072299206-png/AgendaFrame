#Requires -Version 5.1
<#
.SYNOPSIS
    Applies the metadata-only BigQuery schema and table-scoped grants through
    the official REST endpoint.

.DESCRIPTION
    The normal bq CLI is still the preferred path in provision.ps1. This
    guarded fallback exists for Windows environments where the bundled bq
    Python process cannot resolve bigquery.googleapis.com while PowerShell can
    reach www.googleapis.com. It never writes article bodies or secret values.
    Dry-run is the default and live use requires AGENDAFRAME_LIVE_TESTS=1.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "project-40bc06fc-fb4b-46b6-a10",
    [string]$Location = "asia-northeast3",
    [string]$SchemaPath = "src\backend\sql\schema.sql",
    [string]$GrantsPath = "src\backend\sql\grants.sql",
    [switch]$Apply,
    [switch]$SpendCapsConfirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProject = "project-40bc06fc-fb4b-46b6-a10"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$SchemaPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $SchemaPath)).Path
$GrantsPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $GrantsPath)).Path

if ($ProjectId -ne $ExpectedProject) {
    throw "Refusing to target an unreviewed project: $ProjectId"
}

if (-not $Apply) {
    Write-Host "Dry run only. No BigQuery schema or grant will change." -ForegroundColor Yellow
    Write-Host "Schema: $SchemaPath"
    Write-Host "Grants: $GrantsPath"
    Write-Host "Re-run with -Apply -SpendCapsConfirmed and AGENDAFRAME_LIVE_TESTS=1."
    exit 0
}

if (-not $SpendCapsConfirmed) {
    throw "Apply is blocked until Vertex AI and Cloud Run spend caps are confirmed."
}
if ($env:AGENDAFRAME_LIVE_TESTS -ne "1") {
    throw "Live BigQuery apply requires AGENDAFRAME_LIVE_TESTS=1."
}

$Gcloud = Get-Command "gcloud.cmd" -ErrorAction SilentlyContinue
if (-not $Gcloud) { $Gcloud = Get-Command gcloud -ErrorAction SilentlyContinue }
if (-not $Gcloud) { throw "gcloud.cmd was not found." }

$Account = (& $Gcloud.Source auth list --filter=status:ACTIVE --format="value(account)").Trim()
if (-not $Account) { throw "No active gcloud account. Run gcloud auth login first." }
$Token = (& $Gcloud.Source auth print-access-token).Trim()
if (-not $Token) { throw "Could not obtain a short-lived Google access token." }

function Invoke-BigQueryScript {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Path
    )

    $Sql = [IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($Sql)) { throw "$Label SQL is empty." }
    $Request = @{
        query = [string]$Sql
        useLegacySql = $false
        location = $Location
        maximumBytesBilled = "1073741824"
    } | ConvertTo-Json -Depth 5
    $Headers = @{ Authorization = "Bearer $Token" }
    $Uri = "https://www.googleapis.com/bigquery/v2/projects/$ProjectId/queries"
    try {
        $Result = Invoke-RestMethod -Method Post -Uri $Uri -Headers $Headers `
            -ContentType "application/json" -Body $Request -TimeoutSec 90
    }
    catch {
        throw "$Label BigQuery REST request failed: $($_.Exception.GetType().Name)"
    }
    $ErrorProperty = $Result.PSObject.Properties["errors"]
    if ($ErrorProperty -and $ErrorProperty.Value) {
        throw "$Label BigQuery job returned errors."
    }
    Write-Host "$Label applied through BigQuery REST." -ForegroundColor Green
}

Invoke-BigQueryScript -Label "Schema" -Path $SchemaPath
Invoke-BigQueryScript -Label "Grants" -Path $GrantsPath
Write-Host "BigQuery metadata schema and publisher grant are ready for $ProjectId." -ForegroundColor Green
