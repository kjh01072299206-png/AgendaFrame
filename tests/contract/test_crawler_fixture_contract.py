from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "crawler"


class CrawlerFixtureContractTests(unittest.TestCase):
    def test_each_html_fixture_has_sanitized_provenance_metadata(self) -> None:
        html_fixtures = sorted(FIXTURE_ROOT.glob("*.html"))
        self.assertGreater(len(html_fixtures), 0, "at least one crawler fixture is required")

        for html_path in html_fixtures:
            with self.subTest(fixture=html_path.name):
                metadata_path = html_path.with_suffix(".metadata.json")
                self.assertTrue(metadata_path.is_file())
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                self.assertEqual(metadata["fixture_version"], 1)
                self.assertTrue(metadata["source_url"].startswith("https://"))
                self.assertIn(".invalid", metadata["source_url"])
                self.assertEqual(metadata["content_kind"], "synthetic")
                self.assertIs(metadata["sanitized"], True)
                self.assertTrue(metadata["selector_version"])
                captured_at = metadata["captured_at"].replace("Z", "+00:00")
                self.assertIsNotNone(datetime.fromisoformat(captured_at).tzinfo)

                html = html_path.read_text(encoding="utf-8")
                self.assertIn(
                    f'data-selector-version="{metadata["selector_version"]}"',
                    html,
                )
                self.assertNotIn("<script", html.lower())


if __name__ == "__main__":
    unittest.main()
