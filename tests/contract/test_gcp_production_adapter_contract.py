from __future__ import annotations

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "src" / "backend" / "gcp_production_adapters.py"


class GcpProductionAdapterContractTests(unittest.TestCase):
    def test_module_has_no_top_level_google_sdk_import(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        imports = [
            node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))
        ]
        for node in imports:
            names = [alias.name for alias in node.names]
            module = getattr(node, "module", "") or ""
            self.assertFalse(any(name == "google" or name.startswith("google.") for name in names))
            self.assertFalse(module == "google" or module.startswith("google."))

    def test_production_factory_is_explicit_and_missing_sdk_is_named(self) -> None:
        text = MODULE.read_text(encoding="utf-8")
        self.assertIn("def production_adapter_factory", text)
        self.assertIn("def load_google_sdk", text)
        self.assertIn("RuntimeAdapterUnavailable", text)
        self.assertIn("AGENDAFRAME_STAGE_ADAPTER_FACTORY", text)
        self.assertNotIn("bigquery.Client(", text)
        self.assertNotIn("storage.Client(", text)
        self.assertNotIn("genai.Client(", text)


if __name__ == "__main__":
    unittest.main()
