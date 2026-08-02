[CmdletBinding()]
param(
    [ValidateSet("preflight", "status", "resume")]
    [string]$Mode = "preflight",
    [Parameter(Mandatory = $true)][string]$InputJsonl,
    [string]$Config = "config/gcp-runtime.yaml",
    [string]$SourcePolicy = "config/source-policies.yaml",
    [string]$ApprovalDirectory = "config/analysis-approvals"
)

<#
.SYNOPSIS
    Validate or resume the bounded 2026-07-26 initial-five framing pilot.

.DESCRIPTION
    The runner is deliberately limited to five reviewed approval manifests and
    25 articles. `preflight` is local-only. `status` and `resume` are the only
    modes that contact GCP, and both require the explicit live-test opt-in.
    Output is a summary only; article bodies, credentials, and model prompts
    are never written to the console.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TargetDate = "2026-07-26"
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$ConfigPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $Config)).Path
$SourcePolicyPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $SourcePolicy)).Path
$ApprovalDirectoryPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $ApprovalDirectory)).Path
$InputPath = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $InputJsonl)).Path

function Resolve-Python {
    $venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }
    $command = Get-Command python -ErrorAction Stop
    return $command.Source
}

function Invoke-LocalJson {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    # Capture the child output and intentionally discard it on failure. A
    # traceback can contain provider request context; the runner's contract is
    # to expose only a safe summary and a generic failure message.
    $captured = @(& $script:Python @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed. Inspect the bounded run logs separately."
    }
    try {
        return ($captured -join "`n") | ConvertFrom-Json
    }
    catch {
        throw "$Label returned an invalid summary. No model output was printed."
    }
}

function Assert-LiveOptIn {
    if ($env:AGENDAFRAME_LIVE_TESTS -ne "1") {
        throw "status/resume require AGENDAFRAME_LIVE_TESTS=1 before any external call."
    }
    if ([string]::IsNullOrWhiteSpace($env:GOOGLE_CLOUD_PROJECT)) {
        throw "status/resume require GOOGLE_CLOUD_PROJECT to be set before any external call."
    }
}

function Invoke-PilotValidation {
    $arguments = @(
        "-m", "backend.main",
        "--config=$ConfigPath",
        "--source-policy=$SourcePolicyPath",
        "validate-pilot",
        "--input-jsonl=$InputPath",
        "--approval-directory=$ApprovalDirectoryPath"
    )
    return Invoke-LocalJson -Label "Pilot preflight" -Arguments $arguments
}

function Get-SafeRankSummary {
    param(
        [Parameter(Mandatory = $true)]$Rank,
        [Parameter(Mandatory = $true)]$Run
    )
    return [pscustomobject]@{
        rank = [int]$Rank.rank
        received = [int]$Run.received
        analyzed = [int]$Run.analyzed
        redriven = [int]$Run.redriven
        skipped_duplicate = [int]$Run.skipped_duplicate
        skipped_in_progress = [int]$Run.skipped_in_progress
        skipped_dead_letter = [int]$Run.skipped_dead_letter
        result_states = @($Run.results | ForEach-Object { $_.analysis_state } | Group-Object | ForEach-Object {
                [pscustomobject]@{ state = $_.Name; count = $_.Count }
            })
    }
}

$script:Python = Resolve-Python
$oldPythonPath = $env:PYTHONPATH
if ([string]::IsNullOrWhiteSpace($oldPythonPath)) {
    $env:PYTHONPATH = Join-Path $RepoRoot "src"
}
else {
    $env:PYTHONPATH = (Join-Path $RepoRoot "src") + [IO.Path]::PathSeparator + $oldPythonPath
}

$preflight = Invoke-PilotValidation
if ($Mode -eq "preflight") {
    [pscustomobject]@{
        mode = "preflight"
        target_date = $preflight.target_date
        agenda_count = [int]$preflight.agenda_count
        article_count = [int]$preflight.article_count
        ranks = @($preflight.ranks | ForEach-Object {
                [pscustomobject]@{ rank = [int]$_.rank; article_count = [int]$_.article_count }
            })
        external_calls = "blocked; use status or resume with explicit live opt-in"
    } | ConvertTo-Json -Depth 5
    exit 0
}

Assert-LiveOptIn
$reports = @()
foreach ($rank in @($preflight.ranks)) {
    $rankIds = @($rank.article_ids | ForEach-Object { [string]$_ })
    if ($Mode -eq "status") {
        $statusArguments = @(
            "-m", "backend.main",
            "--config=$ConfigPath",
            "--source-policy=$SourcePolicyPath",
            "status",
            "--date=$TargetDate"
        )
        foreach ($articleId in $rankIds) {
            $statusArguments += "--article-id=$articleId"
        }
        $status = Invoke-LocalJson -Label "Pilot status rank $($rank.rank)" -Arguments $statusArguments
        $reports += [pscustomobject]@{
            rank = [int]$rank.rank
            article_count = [int]$rank.article_count
            states = $status.states
        }
        continue
    }

    $approvalPath = Join-Path $ApprovalDirectoryPath "2026-07-26-rank-$($rank.rank)-pilot.json"
    $runArguments = @(
        "-m", "backend.main",
        "--config=$ConfigPath",
        "--source-policy=$SourcePolicyPath",
        "live-run",
        "--input-jsonl=$InputPath",
        "--authorization-json=$approvalPath",
        "--resume"
    )
    $run = Invoke-LocalJson -Label "Pilot resume rank $($rank.rank)" -Arguments $runArguments
    $reports += Get-SafeRankSummary -Rank $rank -Run $run
}

[pscustomobject]@{
    mode = $Mode
    target_date = $TargetDate
    agenda_count = [int]$preflight.agenda_count
    article_count = [int]$preflight.article_count
    ranks = $reports
} | ConvertTo-Json -Depth 8
