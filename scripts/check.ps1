[CmdletBinding()]
param(
    [ValidateSet("quick", "full", "live")]
    [string]$Mode = "quick",
    [switch]$SkipFrontend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONUTF8 = "1"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function Get-HarnessPython {
    $Candidates = @(
        (Join-Path $RepoRoot ".venv\Scripts\python.exe"),
        (Join-Path $RepoRoot ".venv/bin/python")
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate) {
            return $Candidate
        }
    }

    $PythonCommand = Get-Command python -ErrorAction Stop
    return $PythonCommand.Source
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )

    Write-Host "==> $Label" -ForegroundColor Cyan
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Assert-TestSuite {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $SuitePath = Join-Path $RepoRoot $RelativePath
    $TestFiles = @(Get-ChildItem -LiteralPath $SuitePath -Filter "test_*.py" -File -Recurse)
    if ($TestFiles.Count -eq 0) {
        throw "Required test suite has no test files: $RelativePath"
    }
}

$Python = Get-HarnessPython

Push-Location $RepoRoot
try {
    Write-Host "AgendaFrame check mode: $Mode" -ForegroundColor White
    if ($SkipFrontend) {
        Write-Warning "-SkipFrontend is retained only for compatibility; this harness validates the current Python repository."
    }

    foreach ($Suite in @("tests/unit", "tests/contract")) {
        Assert-TestSuite $Suite
    }

    Invoke-External "Lint Python" $Python @(
        "-m", "ruff", "check", "--no-cache", "scripts", "src", "tests"
    )
    Invoke-External "Check harness formatting" $Python @(
        "-m", "ruff", "format", "--check",
        "src/agendaframe_tooling", "tests", "scripts/run_evals.py"
    )
    Invoke-External "Run unit and contract tests" $Python @(
        "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/unit", "tests/contract"
    )

    if ($Mode -in @("full", "live")) {
        foreach ($Suite in @("tests/integration", "tests/e2e")) {
            Assert-TestSuite $Suite
        }

        Invoke-External "Verify installed dependency graph" $Python @(
            "-m", "pip", "check"
        )
        Invoke-External "Verify document-generation dependencies" $Python @(
            "-c", "import docx, openpyxl, PIL, yaml"
        )
        Invoke-External "Run integration and offline end-to-end tests" $Python @(
            "-m", "pytest", "-q", "-p", "no:cacheprovider",
            "tests/integration", "tests/e2e"
        )
        Invoke-External "Validate evaluation assets" $Python @(
            "scripts/run_evals.py"
        )
    }

    if ($Mode -eq "live") {
        if ($env:AGENDAFRAME_LIVE_TESTS -ne "1") {
            throw "Live tests require AGENDAFRAME_LIVE_TESTS=1 and an authorized staging project."
        }
        Assert-TestSuite "tests/live"
        Invoke-External "Run explicitly enabled live tests" $Python @(
            "-m", "pytest", "-q", "-p", "no:cacheprovider", "-m", "live", "tests/live"
        )
    }

    Write-Host "All $Mode checks passed." -ForegroundColor Green
}
finally {
    Pop-Location
}
