from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.e2e


def _file_state(root: Path) -> dict[str, tuple[int, int]]:
    return {
        str(path.relative_to(root)): (path.stat().st_size, path.stat().st_mtime_ns)
        for path in root.rglob("*")
        if path.is_file()
    }


def _run(*arguments: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PYTHONUTF8"] = "1"
    return subprocess.run(
        [sys.executable, *arguments],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
    )


def test_png_to_docx_submission_workflow_is_offline_and_non_destructive() -> None:
    reviewed_before = {
        "docs": _file_state(ROOT / "docs"),
        "outputs": _file_state(ROOT / "outputs"),
    }

    scratch_root = ROOT / "tmp"
    scratch_root.mkdir(exist_ok=True)
    temporary_root = scratch_root / f"agendaframe-e2e-{uuid4().hex}"
    asset_dir = temporary_root / "assets"
    report_path = temporary_root / "AgendaFrame-report.docx"

    try:
        render = _run(
            "scripts/render_agendaframe_outputs.py",
            "--output-dir",
            str(asset_dir),
        )
        assert render.returncode == 0, (render.stdout or "") + (render.stderr or "")

        build = _run(
            "scripts/build_agendaframe_submission.py",
            "--asset-dir",
            str(asset_dir),
            "--docx-output",
            str(report_path),
        )
        assert build.returncode == 0, (build.stdout or "") + (build.stderr or "")

        pngs = sorted(asset_dir.glob("*.png"))
        assert len(pngs) >= 8
        for image_path in pngs:
            with Image.open(image_path) as image:
                image.verify()

        assert report_path.is_file()
        with zipfile.ZipFile(report_path) as report_archive:
            assert report_archive.testzip() is None
            assert "word/document.xml" in report_archive.namelist()
    finally:
        resolved_temporary_root = temporary_root.resolve()
        if (
            resolved_temporary_root.parent == scratch_root.resolve()
            and resolved_temporary_root.name.startswith("agendaframe-e2e-")
        ):
            shutil.rmtree(resolved_temporary_root, ignore_errors=True)

    reviewed_after = {
        "docs": _file_state(ROOT / "docs"),
        "outputs": _file_state(ROOT / "outputs"),
    }
    assert reviewed_after == reviewed_before
