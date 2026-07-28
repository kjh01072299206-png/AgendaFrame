# Offline end-to-end tests

These tests exercise complete repository workflows in temporary directories.
They may be slower than integration tests, but they must remain deterministic,
network-free, and must not overwrite reviewed files under `docs/` or `outputs/`.
