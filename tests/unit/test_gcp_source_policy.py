from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.gcp_source_policy import DiscoveryPolicyError, GcpDiscoveryPolicy

ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "site" / "data" / "discovery-sources.json"


class GcpSourcePolicyTests(unittest.TestCase):
    def test_repository_policy_is_the_twelve_source_four_run_contract(self) -> None:
        policy = GcpDiscoveryPolicy.from_path(POLICY_PATH)
        self.assertEqual(policy.policy_version, "2026-08-13.1")
        self.assertEqual(policy.source_count, 12)
        self.assertEqual(policy.general_daily_count, 10)
        self.assertEqual(policy.broadcaster_count, 2)
        self.assertEqual(policy.scheduled_hours_kst, (0, 6, 12, 18))
        self.assertEqual(policy.interval_minutes, 360)
        self.assertEqual(policy.max_records_per_source_per_run, 120)
        self.assertEqual(policy.collection_start, "2026-08-13")
        self.assertEqual(policy.collection_end, "2026-10-31")
        self.assertEqual(policy.raw_content_delete_after, "2026-10-31T23:59:59+09:00")

    def test_policy_rejects_wrong_source_count_or_schedule(self) -> None:
        payload = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        payload["sources"] = payload["sources"][:-1]
        with self.assertRaises(DiscoveryPolicyError):
            GcpDiscoveryPolicy.from_payload(payload)

        payload = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        payload["polling"]["scheduledHoursKst"] = [1, 7, 13, 19]
        with self.assertRaises(DiscoveryPolicyError):
            GcpDiscoveryPolicy.from_payload(payload)


if __name__ == "__main__":
    unittest.main()
