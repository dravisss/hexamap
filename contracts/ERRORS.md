# Stable error codes

| Code | Meaning |
|---|---|
| `HEXMAP_INPUT_INVALID` | Input JSON, YAML or Markdown cannot be parsed. |
| `HEXMAP_SCHEMA_INVALID` | A map violates the current schema. |
| `HEXMAP_VERSION_UNSUPPORTED` | The project requires an unsupported major version. |
| `HEXMAP_WORKSPACE_INVALID` | Required workspace paths or identities are invalid. |
| `HEXMAP_DUPLICATE_ID` | Two notes or objects use the same stable ID. |
| `HEXMAP_SOURCE_MISSING` | A manifest entry has no source note. |
| `HEXMAP_DEPENDENCY_MISSING` | An optional render or browser dependency is unavailable. |
| `HEXMAP_RENDER_FAILED` | HTML or screenshot rendering failed. |
| `HEXMAP_AUDIT_REJECTED` | One or more release gates failed. |
| `HEXMAP_OPERATION_FAILED` | Unexpected operation failure. |
