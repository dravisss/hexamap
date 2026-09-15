"""Compatibility marker for the first real HexMap schema migration.

The implementation lives in :mod:`migrations.registry` so the CLI and library
share one registry.  This module is intentionally importable by tooling that
enumerates migration files in lexical order.
"""
from .registry import migrate_0_9_0_to_1_0_0

SOURCE_VERSION = "0.9.0"
TARGET_VERSION = "1.0.0"

__all__ = ["SOURCE_VERSION", "TARGET_VERSION", "migrate_0_9_0_to_1_0_0"]
