[CmdletBinding()]
param(
    [switch]$Offline,
    [switch]$SkipFrontend,
    [switch]$SkipInstall,
    [switch]$SkipCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONUTF8 = "1"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$VenvRoot = Join-Path $RepoRoot ".venv"
$LockFile = Join-Path $RepoRoot "requirements.lock"
$PipTempRoot = Join-Path $RepoRoot "tmp\pip"

function Get-VenvPython {
    foreach ($Candidate in @(
        (Join-Path $VenvRoot "Scripts\python.exe"),
        (Join-Path $VenvRoot "bin/python")
    )) {
        if (Test-Path -LiteralPath $Candidate) {
            return $Candidate
        }
    }
    return $null
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

Push-Location $RepoRoot
try {
    if (-not (Test-Path -LiteralPath $PipTempRoot)) {
        New-Item -ItemType Directory -Path $PipTempRoot | Out-Null
    }
    $env:TMP = $PipTempRoot
    $env:TEMP = $PipTempRoot

    if ($SkipFrontend) {
        Write-Warning "-SkipFrontend is retained only for compatibility; no frontend is installed by this Python harness."
    }

    $VenvPython = Get-VenvPython
    if ($null -eq $VenvPython) {
        $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($null -ne $PythonCommand) {
            Invoke-External "Create Python virtual environment" $PythonCommand.Source @(
                "-m", "venv", $VenvRoot
            )
        }
        else {
            $PyLauncher = Get-Command py -ErrorAction Stop
            Invoke-External "Create Python virtual environment" $PyLauncher.Source @(
                "-3", "-m", "venv", $VenvRoot
            )
        }
        $VenvPython = Get-VenvPython
        if ($null -eq $VenvPython) {
            throw "Virtual environment was created but its Python executable was not found."
        }
    }

    if (-not $SkipInstall) {
        if (-not (Test-Path -LiteralPath $LockFile)) {
            throw "Missing requirements.lock. Regenerate it from pyproject.toml before bootstrapping."
        }

        $LockArguments = @(
            "-m", "pip", "install", "--disable-pip-version-check",
            "--require-hashes", "--requirement", $LockFile
        )
        if ($Offline) {
            $LockArguments += "--no-index"
        }
        Invoke-External "Install locked Python dependencies" $VenvPython $LockArguments

        Invoke-External "Install AgendaFrame tooling package" $VenvPython @(
            "-m", "pip", "install", "--disable-pip-version-check",
            "--no-deps", "--no-build-isolation", "--editable", $RepoRoot
        )
    }

    if (-not $SkipCheck) {
        & (Join-Path $PSScriptRoot "check.ps1") -Mode quick
    }

    Write-Host "AgendaFrame development environment is ready." -ForegroundColor Green
}
finally {
    Pop-Location
}
