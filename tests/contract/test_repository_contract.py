from __future__ import annotations

import struct
import tomllib
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RepositoryContractTests(unittest.TestCase):
    def test_required_harness_layout_exists(self) -> None:
        required_files = (
            "AGENTS.md",
            "pyproject.toml",
            "requirements.lock",
            "scripts/bootstrap.ps1",
            "scripts/check.ps1",
            "scripts/run_evals.py",
            "tests/unit",
            "tests/contract",
            "tests/integration",
            "tests/fixtures/crawler",
            "tests/e2e",
            "evals/clustering/gold.jsonl",
            "evals/framing/gold.jsonl",
            "evals/report/rubric.yaml",
            "evals/prompts/manifest.yaml",
            "evals/thresholds.yaml",
            ".github/workflows/ci.yml",
        )

        for relative_path in required_files:
            with self.subTest(path=relative_path):
                self.assertTrue((ROOT / relative_path).exists())

    def test_pyproject_declares_supported_python_and_harness(self) -> None:
        with (ROOT / "pyproject.toml").open("rb") as handle:
            project = tomllib.load(handle)

        self.assertEqual(project["project"]["name"], "agendaframe-tooling")
        self.assertEqual(project["project"]["requires-python"], ">=3.11")
        self.assertIn("dev", project["project"]["optional-dependencies"])
        self.assertTrue(
            any(
                dependency.startswith("PyYAML") for dependency in project["project"]["dependencies"]
            )
        )

    def test_lockfile_is_hashed_and_covers_direct_dependencies(self) -> None:
        lock_text = (ROOT / "requirements.lock").read_text(encoding="utf-8")
        self.assertIn("--hash=sha256:", lock_text)
        for package_name in (
            "openpyxl",
            "pillow",
            "pip-tools",
            "pytest",
            "python-docx",
            "pyyaml",
            "ruff",
            "setuptools",
        ):
            self.assertRegex(lock_text, rf"(?m)^{package_name}==[^\s]+")

    def test_generated_package_metadata_is_ignored(self) -> None:
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("*.egg-info/", gitignore)

    def test_ci_runs_the_full_offline_gate(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("scripts\\check.ps1 -Mode full", workflow)
        self.assertNotIn("AGENDAFRAME_LIVE_TESTS", workflow)

    def test_secret_examples_do_not_contain_secret_values(self) -> None:
        secret_suffixes = ("_KEY", "_SECRET", "_TOKEN", "_PASSWORD")
        example = ROOT / ".env.example"
        self.assertTrue(example.is_file())

        for line_number, raw_line in enumerate(example.read_text(encoding="utf-8").splitlines(), 1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            self.assertIn("=", line, f"line {line_number} is not an assignment")
            key, value = line.split("=", 1)
            if key.endswith(secret_suffixes):
                self.assertEqual(value, "", f"{key} must be empty in .env.example")

    def test_generated_pngs_have_valid_headers_and_reviewable_size(self) -> None:
        images = sorted((ROOT / "outputs").glob("*.png"))
        self.assertGreater(len(images), 0, "at least one reviewed diagram is required")

        for path in images:
            with self.subTest(path=path.name), path.open("rb") as handle:
                header = handle.read(24)
                self.assertEqual(header[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(header[12:16], b"IHDR")
                width, height = struct.unpack(">II", header[16:24])
                self.assertGreaterEqual(width, 320)
                self.assertGreaterEqual(height, 200)

    def test_committed_office_artifacts_are_valid_zip_containers(self) -> None:
        artifacts = [
            ROOT / "docs" / "specs" / "feature-spec.xlsx",
            ROOT / "docs" / "submission" / "final-report.docx",
        ]
        for path in artifacts:
            with self.subTest(path=path.name):
                self.assertTrue(path.is_file())
                with zipfile.ZipFile(path) as archive:
                    self.assertIsNone(archive.testzip())


if __name__ == "__main__":
    unittest.main()
