# Compatibility and fail-closed policy

HexMap 10.3.x reads schema/workspace `1.0.0` only. Version strings are strict
`MAJOR.MINOR.PATCH` values. A malformed, future, unknown minor, or downgrade
request returns `HEXMAP_VERSION_UNSUPPORTED`; no normalisation or write occurs.

The only registered upgrade is `0.9.0 -> 1.0.0`, implemented as a pure,
idempotent transformation in `migrations/registry.py`. Run `hexmap migrate`
before opening a legacy workspace. Unknown legacy versions remain blocked so a
mistyped field cannot be mistaken for a supported contract.

`schemaVersion` describes `.hexmap/map.json`; `workspaceVersion` describes the
directory projection. Markdown frontmatter fields not owned by the core are
preserved under `fields`. JSON extensions must use an `x-<vendor>-*` key.

The universal presentation fields (`layout.mode`, hull visibility, typed
relation endpoints and named views) are backwards-compatible additions within
schema `1.0.0`. Readers normalize omitted fields to the historical Territories
view. Writers always persist the explicit form. View files not declared by the
manifest are ignored, so removing a view cannot resurrect stale state.
