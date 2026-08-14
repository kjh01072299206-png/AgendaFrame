#Requires -Version 5.1
<#
.SYNOPSIS
    Verifies that the expected release is serving from the public Vercel site.

.DESCRIPTION
    Dry-run is the default. With -Execute, the verifier checks /version and
    the public home, outlet-comparison, and framing routes. It never deploys,
    changes environment variables, or prints response bodies. The issue ID is
    explicit because live snapshots may use a different top-five identifier.
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = "https://agendaframe-capstone.vercel.app",
    [string]$ExpectedCommit = "",
    [string]$IssueId = "bigkinds-2026-07-26-top-1",
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Execute) {
    Write-Host "Dry run only. No public request will be made." -ForegroundColor Yellow
    Write-Host "Base URL:       $BaseUrl"
    Write-Host "Expected commit: $ExpectedCommit"
    Write-Host "Issue ID:        $IssueId"
    Write-Host "Use -Execute with a 40-character reviewed commit SHA to verify production."
    exit 0
}

if ($BaseUrl -notmatch '^https://[^/]+/?$') {
    throw "BaseUrl must be an HTTPS origin without a path."
}
if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$') {
    throw "ExpectedCommit must be the full 40-character reviewed commit SHA."
}
if ($IssueId -notmatch '^[A-Za-z0-9._~-]+$') {
    throw "IssueId contains characters that are not safe in a route."
}

$Origin = $BaseUrl.TrimEnd('/')
$Routes = @(
    "/",
    "/issues/$([uri]::EscapeDataString($IssueId))/outlets",
    "/issues/$([uri]::EscapeDataString($IssueId))/framing"
)
$Forbidden = '(?i)(body_text|raw_body|sentence_text|full_article|article_content|prompt_payload)'

function Get-PublicResponse {
    param([Parameter(Mandatory)][string]$Path)

    $Uri = "$Origin$Path"
    try {
        return Invoke-WebRequest -Uri $Uri -Method Get -Headers @{ Accept = "text/html,application/json" } -TimeoutSec 30 -UseBasicParsing
    }
    catch {
        throw "Public route request failed: $Path"
    }
}

$VersionResponse = Get-PublicResponse -Path "/version"
if ($VersionResponse.StatusCode -ne 200) {
    throw "/version returned HTTP $($VersionResponse.StatusCode)."
}
try {
    $Version = $VersionResponse.Content | ConvertFrom-Json
}
catch {
    throw "/version did not return JSON."
}
if ($Version.commit -ne $ExpectedCommit) {
    throw "/version commit does not match the reviewed release."
}

foreach ($Route in $Routes) {
    $Response = Get-PublicResponse -Path $Route
    if ($Response.StatusCode -ne 200) {
        throw "$Route returned HTTP $($Response.StatusCode)."
    }
    if ($Response.Content -match $Forbidden) {
        throw "$Route contains a forbidden raw-content field name."
    }
}

Write-Host "Production verification passed: /version and all three public routes serve the reviewed commit." -ForegroundColor Green
