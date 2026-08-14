from __future__ import annotations

import unittest
from pathlib import Path

import yaml


class GcpSnapshotReaderContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[2]
        self.contract = yaml.safe_load(
            (self.root / "infra" / "gcp" / "snapshot-reader-service.yaml").read_text(
                encoding="utf-8"
            )
        )

    def test_reader_is_a_read_only_body_free_boundary(self) -> None:
        spec = self.contract["spec"]
        self.assertEqual(self.contract["metadata"]["implementationStatus"], "contract_only")
        self.assertFalse(self.contract["metadata"]["externalCalls"])
        self.assertEqual(spec["storage"]["currentPointer"], "snapshots/current.json")
        self.assertTrue(spec["storage"]["immutableObjectReadOnly"])
        self.assertTrue(spec["storage"]["requiredManifestSha256"])
        self.assertTrue(spec["validation"]["rawBodyAbsent"])
        self.assertTrue(spec["validation"]["manifestAndPointerMustConverge"])
        self.assertTrue(spec["failClosedOnInvalidSnapshot"])

    def test_reader_route_is_explicit(self) -> None:
        routes = {
            (row["method"], row["path"]): row["response"] for row in self.contract["spec"]["routes"]
        }
        self.assertEqual(routes[("GET", "/healthz")], "status_only")
        self.assertEqual(routes[("GET", "/active")], "body_free_public_snapshot_envelope")


if __name__ == "__main__":
    unittest.main()
