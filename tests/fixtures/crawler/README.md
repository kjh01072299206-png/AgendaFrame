# Crawler fixtures

Every saved HTML fixture must have adjacent `*.metadata.json` with a fixed source
URL, capture timestamp, selector version, provenance, and sanitization flag.
Fixtures in this directory are synthetic and must never be refreshed by an
ordinary test or used to claim production crawler coverage.
