# Standalone publication contract

`hexmap publish PROJECT -o OUTPUT` emits a read-only, dependency-free HTML
publication and an SVG by default. The artifact contains the map, accessible
labels, title/description, author, license, source and generation metadata; it
does not include editor controls or a write API.

Use `--formats html,svg,png,pdf` to request additional formats. SVG/HTML are
always available. PNG/PDF use optional Playwright/Chromium and fail with
`HEXMAP_DEPENDENCY_MISSING` (without replacing the successful HTML/SVG) when
that optional renderer is unavailable. External images are not fetched during
publication, preserving local-first privacy.
