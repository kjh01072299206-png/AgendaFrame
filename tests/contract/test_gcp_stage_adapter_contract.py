from __future__ import annotations

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "src" / "backend" / "gcp_stage_adapters.py"


class GcpStageAdapterContractTests(unittest.TestCase):
    def test_stage_module_has_no_network_or_google_sdk_imports(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertFalse(any(alias.name.startswith("google") for alias in node.names))
                self.assertFalse(
                    any(alias.name in {"requests", "httpx", "urllib3"} for alias in node.names)
                )
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                self.assertFalse(module.startswith("google"))
                self.assertFalse(module in {"urllib.request", "requests", "httpx"})

    def test_stage_contract_mentions_injected_io_and_public_safety(self) -> None:
        text = MODULE.read_text(encoding="utf-8")
        for expected in (
            "FeedFetcher",
            "ArticleParser",
            "PrivateArticleVault",
            "MetadataPersistenceSink",
            "StageDependencies",
            "AGENDAFRAME_STAGE_DEPENDENCIES_FACTORY",
            "privateBodyObjects",
            "sentence_sha256",
            "assert_body_safe",
        ):
            self.assertIn(expected, text)


if __name__ == "__main__":
    unittest.main()
