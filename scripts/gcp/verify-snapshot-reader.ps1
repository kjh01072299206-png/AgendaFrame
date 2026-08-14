#Requires -Version 5.1
<#[
.SYNOPSIS
    Verifies a deployed body-free snapshot-reader canary.

.DESCRIPTION
    Dry-run is the default and never contacts a URL. With -Execute, the script
    performs only GET /healthz and GET /active against an explicitly supplied
    HTTPS reader URL. It validates the public envelope without printing it,
    including snapshot identity, exactly five issues, quality-gate metadata,
    and recursive raw-body field absence.
#>
[CmdletBinding()]
param(
    [string]$ReaderUrl = "",
    [string]$ExpectedSnapshotId = "",
    [string]$BearerToken = "",
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ForbiddenKeys = @(
    "body_text", "bodytext", "raw_body", "rawbody", "html", "sentence_text",
    "sentencetext", "full_article", "fullarticle", "article_content",
    "articlecontent", "full_content", "fullcontent", "prompt_payload",
    "promptpayload", "evidence_text", "evidencetext"
)

function Join-ReaderPath {
    param([Parameter(Mandatory)][string]$Base, [Parameter(Mandatory)][string]$Path)

    return ($Base.TrimEnd("/") + $Path)
}

function Assert-NoForbiddenKeys {
    param(
        [AllowNull()][object]$Value,
        [string]$Path = "root"
    )

    if ($null -eq $Value) { return }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($Entry in $Value.GetEnumerator()) {
            $Key = [string]$Entry.Key
            if ($ForbiddenKeys -contains $Key.ToLowerInvariant()) {
                throw "Forbidden public field found at $Path.$Key"
            }
            Assert-NoForbiddenKeys -Value $Entry.Value -Path "$Path.$Key"
        }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($Property in $Value.PSObject.Properties) {
            $Key = [string]$Property.Name
            if ($ForbiddenKeys -contains $Key.ToLowerInvariant()) {
                throw "Forbidden public field found at $Path.$Key"
            }
            Assert-NoForbiddenKeys -Value $Property.Value -Path "$Path.$Key"
        }
        return
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $Index = 0
        foreach ($Item in $Value) {
            Assert-NoForbiddenKeys -Value $Item -Path "$Path[$Index]"
            $Index++
        }
    }
}

function Get-Json {
    param([Parameter(Mandatory)][string]$Url)

    try {
        $Headers = @{ Accept = "application/json" }
        if ($BearerToken) { $Headers.Authorization = "Bearer $BearerToken" }
        $Response = Invoke-WebRequest -Uri $Url -Method Get -Headers $Headers -TimeoutSec 30 -UseBasicParsing
    }
    catch {
        throw "Snapshot-reader request failed: $Url"
    }
    if ([int]$Response.StatusCode -ne 200) {
        throw "Snapshot-reader returned HTTP $($Response.StatusCode): $Url"
    }
    try {
        return ($Response.Content | ConvertFrom-Json -Depth 100)
    }
    catch {
        throw "Snapshot-reader returned invalid JSON: $Url"
    }
}

if (-not $Execute) {
    Write-Host "Dry run only. No snapshot-reader URL will be contacted." -ForegroundColor Yellow
    Write-Host "Expected endpoints: <reader>/healthz and <reader>/active"
    Write-Host "Checks: HTTPS URL, health status, 32-hex snapshot ID, exactly five issues,"
    Write-Host "        passed quality gate, evidence lineage, and no forbidden body fields."
    exit 0
}

if (-not $ReaderUrl) { throw "-ReaderUrl is required with -Execute." }
try {
    $Uri = [Uri]$ReaderUrl
}
catch {
    throw "-ReaderUrl must be a valid HTTPS URL."
}
if ($Uri.Scheme -ne "https" -or -not $Uri.Host) {
    throw "-ReaderUrl must use HTTPS and include a host."
}
if ($Uri.Query -or $Uri.Fragment) { throw "-ReaderUrl must not contain a query or fragment." }

$Health = Get-Json -Url (Join-ReaderPath -Base $ReaderUrl -Path "/healthz")
if ($Health.status -ne "ok") { throw "Snapshot-reader health check did not return status=ok." }

$Active = Get-Json -Url (Join-ReaderPath -Base $ReaderUrl -Path "/active")
Assert-NoForbiddenKeys -Value $Active
if ($Active.schemaVersion -ne "agenda.frame.active-snapshot.v1") {
    throw "Active snapshot schema is not agenda.frame.active-snapshot.v1."
}
if ([string]$Active.snapshotId -notmatch "^[0-9a-f]{32}$") {
    throw "Active snapshot ID is not a 32-character lowercase hex value."
}
if ($ExpectedSnapshotId -and [string]$Active.snapshotId -ne $ExpectedSnapshotId) {
    throw "Active snapshot ID does not match -ExpectedSnapshotId."
}
$Manifest = $Active.manifest
if ($null -eq $Manifest -or $Manifest.issueCount -ne 5 -or @($Manifest.issues).Count -ne 5) {
    throw "Active snapshot manifest does not contain exactly five issues."
}
if ($Manifest.qualityGate.status -ne "pass" -or
    $Manifest.qualityGate.rawBodyAbsent -ne $true -or
    $Manifest.qualityGate.evidenceLineageComplete -ne $true) {
    throw "Active snapshot quality gate is not publishable."
}
$BundleNames = @($Active.bundles.PSObject.Properties.Name)
if ($BundleNames.Count -ne 5) { throw "Active snapshot does not contain exactly five issue bundles." }

Write-Host ("Snapshot-reader verified: snapshot {0}, five issues, body-free envelope." -f $Active.snapshotId) -ForegroundColor Green
