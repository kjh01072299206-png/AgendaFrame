from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_vercel_verifier_is_explicit_dry_run_and_sha_bound() -> None:
    script = (ROOT / "scripts" / "verify-vercel-production.ps1").read_text(encoding="utf-8")
    assert "[switch]$Execute" in script
    assert "if (-not $Execute)" in script
    assert "ExpectedCommit -notmatch '^[a-f0-9]{40}$'" in script
    assert '"/version"' in script
    assert "/outlets" in script
    assert "/framing" in script
    assert "Invoke-WebRequest" in script
    assert "body_text|raw_body|sentence_text" in script
    assert "VERCEL_TOKEN" not in script


def test_vercel_verifier_requires_https_and_does_not_print_response_bodies() -> None:
    script = (ROOT / "scripts" / "verify-vercel-production.ps1").read_text(encoding="utf-8")
    assert "^https://[^/]+/?$" in script
    assert "Write-Host $Response.Content" not in script
    assert "Write-Output $Response.Content" not in script
