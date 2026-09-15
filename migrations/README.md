# Migrations

Migrations are pure, ordered transformations in `registry.py` and are tested
as a registry rather than inferred from a version number. `hexmap migrate`
creates a timestamped `.hexmap/backups/` snapshot unless `--no-backup` is
explicitly selected. Version `1.0.0` is the current baseline; unknown or future
versions fail closed. The compatibility marker `001_legacy_0_9_to_1_0.py`
exists so release tooling can enumerate the real `0.9.0 -> 1.0.0` step.
