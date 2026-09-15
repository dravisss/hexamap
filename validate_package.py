#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import os
import py_compile
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(list(args), cwd=cwd, check=True)


def require(paths: list[str]) -> None:
    missing = [path for path in paths if not (ROOT / path).exists()]
    if missing:
        raise SystemExit(f"FAIL missing files: {missing}")


require([
    'index.html', 'preview-inline.html', 'styles.css', 'app.js', 'data.js', 'hex.js', 'renderers/three-view.js', 'three-view.bundle.js', 'three-view.inline.js',
    'router.js', 'markdown.js', 'frontmatter.js', 'workspace.js', 'README.md', 'WORKSPACE.md', 'ARCHITECTURE.md', 'ROUTING.md',
    'LLM_INTEGRATION.md', 'AUDIT_LOOP.md', 'VALIDATION.md', 'package.json',
    'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md', 'MANIFEST.in',
    'docs/INSTALLATION.md', 'docs/PRIVACY.md', 'docs/BROWSER-COMPATIBILITY.md', 'docs/RELEASE.md',
    'docs/PLATFORM-HARDENING-REQUIREMENTS.md', 'scripts/build_release.py', 'scripts/check_release.py',
    'server.py', 'start.sh', 'start.command', 'build_inline.py', 'browser_smoke.py',
    'hexmap_cli.py', 'schemas/hexmap.schema.json',
    'hexmap_platform.py', 'hexmap_mcp.py', 'pyproject.toml', 'LICENSE',
    'schemas/project.schema.json', 'schemas/bundle.schema.json', 'schemas/operation-result.schema.json',
    'contracts/CONTRACT.md', 'contracts/ERRORS.md', 'UNIVERSAL-AGENT-PLATFORM.md',
    'examples/organizational-system.json', 'examples/minimal-map.json', 'examples/axes-map.json',
])
print('PASS package structure')

for script in ['app.js', 'data.js', 'hex.js', 'router.js', 'markdown.js', 'frontmatter.js', 'workspace.js', 'renderers/three-view.js']:
    run('node', '--check', str(ROOT / script))
print('PASS JavaScript syntax')

for script in ['hexmap_cli.py', 'hexmap_platform.py', 'hexmap_mcp.py', 'certify_harnesses.py', 'build_inline.py', 'browser_smoke.py', 'server.py', 'scripts/build_release.py', 'scripts/check_release.py']:
    py_compile.compile(str(ROOT / script), doraise=True)
if (ROOT / 'hexmap_export.py').exists():
    py_compile.compile(str(ROOT / 'hexmap_export.py'), doraise=True)
print('PASS Python compilation')

run('npm', 'test')
run(sys.executable, '-m', 'unittest', 'tests/test_platform.py', 'tests/test_release_security.py', '-v')
print('PASS unit tests')

for example in sorted((ROOT / 'examples').glob('*.json')):
    payload = json.loads(example.read_text(encoding='utf-8'))
    if payload.get('format') == 'hexmap-workspace':
        continue
    assert payload.get('$schema') == '../schemas/hexmap.schema.json', f'{example.name}: missing relative $schema'
    run(sys.executable, str(ROOT / 'hexmap_cli.py'), 'validate', str(example))
    run(sys.executable, str(ROOT / 'hexmap_cli.py'), 'audit', str(example))
print('PASS JSON Schema and structural audits')

skill_expectations = {
    'build-hexmap': ['references/schema-reference.md', 'references/modeling-guide.md', 'scripts/new_map.py', 'scripts/validate_map.py'],
    'compose-hexmap': ['references/layout-grammar.md', 'references/routing-guide.md', 'scripts/layout_map.py', 'scripts/reset_routes.py'],
    'audit-hexmap': ['references/quality-gates.md', 'references/roast-checklist.md', 'scripts/audit_map.py', 'scripts/quick_validate.py'],
    'orchestrate-hexmap': ['references/handoff-contract.md', 'scripts/run_pipeline.py'],
}
for skill_name, children in skill_expectations.items():
    skill_root = ROOT / 'skills' / skill_name
    skill_md = skill_root / 'SKILL.md'
    require([str(skill_md.relative_to(ROOT)), *[str((skill_root / child).relative_to(ROOT)) for child in children]])
    text = skill_md.read_text(encoding='utf-8')
    frontmatter = re.match(r'^---\n(.*?)\n---\n', text, flags=re.S)
    assert frontmatter, f'{skill_name}: invalid YAML frontmatter'
    lines = [line for line in frontmatter.group(1).splitlines() if line.strip()]
    keys = [line.split(':', 1)[0].strip() for line in lines]
    assert keys == ['name', 'description'], f'{skill_name}: expected only name and description, got {keys}'
    assert f'name: {skill_name}' in frontmatter.group(1)
    assert len(text.splitlines()) < 120, f'{skill_name}: SKILL.md should remain concise'
    for script in (skill_root / 'scripts').glob('*.py'):
        py_compile.compile(str(script), doraise=True)
print('PASS Agent Skills structure')

with tempfile.TemporaryDirectory() as temp:
    temp_root = Path(temp)
    new_map = temp_root / 'new.json'
    laid_out = temp_root / 'layout.json'
    routed = temp_root / 'routed.json'
    run(sys.executable, str(ROOT / 'skills/build-hexmap/scripts/new_map.py'), '--title', 'Skill smoke', '-o', str(new_map))
    run(sys.executable, str(ROOT / 'skills/build-hexmap/scripts/validate_map.py'), str(new_map))
    run(sys.executable, str(ROOT / 'skills/compose-hexmap/scripts/layout_map.py'), str(ROOT / 'examples/minimal-map.json'), '--template', 'free', '-o', str(laid_out))
    run(sys.executable, str(ROOT / 'skills/compose-hexmap/scripts/reset_routes.py'), str(laid_out), '-o', str(routed))
    run(sys.executable, str(ROOT / 'skills/audit-hexmap/scripts/quick_validate.py'), str(routed))
print('PASS Agent Skills scripts')

for skill_script in (ROOT / 'skills').glob('*/scripts/*.py'):
    source = skill_script.read_text(encoding='utf-8')
    assert '/Users/' not in source and '.hermes/profiles' not in source and '.codex/' not in source, f'non-portable skill path: {skill_script}'
print('PASS harness-agnostic skill paths')

with tempfile.TemporaryDirectory() as temp:
    temp_root = Path(temp)
    site = temp_root / 'site'
    run(sys.executable, '-m', 'pip', 'install', '--no-deps', '--target', str(site), str(ROOT), cwd=temp_root)
    env = {**os.environ, 'PYTHONPATH': str(site)}
    subprocess.run([sys.executable, '-m', 'hexmap_cli', 'doctor', '--json'], cwd=temp_root, env=env, check=True)
    optional_modules = []
    if (ROOT / 'hexmap_export.py').exists():
        optional_modules.append('hexmap_export')
    if (ROOT / 'migrations').is_dir():
        optional_modules.append('migrations')
    if optional_modules:
        subprocess.run([sys.executable, '-c', f"import {', '.join(optional_modules)}"], cwd=temp_root, env=env, check=True)
    rendered = temp_root / 'installed-preview.html'
    subprocess.run([sys.executable, '-m', 'hexmap_cli', 'render', str(ROOT / 'examples/workspace'), '-o', str(rendered), '--json'], cwd=temp_root, env=env, check=True)
    assert rendered.stat().st_size > 100_000
print('PASS clean package installation')

run(sys.executable, str(ROOT / 'certify_harnesses.py'))
certification = json.loads((ROOT / 'harnesses/certification.json').read_text(encoding='utf-8'))
assert certification['verdict'] == 'PASS' and len(certification['protocol']['tools']) >= 9
print('PASS MCP and harness protocol certification')

run(sys.executable, str(ROOT / 'build_inline.py'))
inline = (ROOT / 'preview-inline.html').read_text(encoding='utf-8')
assert '<script type="module" src="./app.js"></script>' not in inline
assert '<style>' in inline and 'window.HexMapStudio' in inline
print('PASS inline standalone build')

browser_report_path = ROOT / 'previews/browser-report.json'
if os.environ.get('HEXMAP_RUN_BROWSER') == '1':
    subprocess.run([sys.executable, str(ROOT / 'browser_smoke.py')], cwd=ROOT, check=True, timeout=240)
if not browser_report_path.exists():
    raise SystemExit('FAIL missing browser report; run python3 browser_smoke.py')
core_mtime = max((ROOT / name).stat().st_mtime for name in ['app.js', 'styles.css', 'router.js', 'markdown.js', 'data.js', 'renderers/three-view.js', 'three-view.bundle.js'])
if browser_report_path.stat().st_mtime < core_mtime:
    raise SystemExit('FAIL browser report is stale; run python3 browser_smoke.py')
report = json.loads(browser_report_path.read_text(encoding='utf-8'))
expected = {
    'version': '0.1.10',
    'initial_nodes': 48,
    'initial_clusters': 6,
    'initial_relations': 6,
    'initial_annotations': 0,
    'auto_route_hard_collisions': 0,
    'auto_route_crossings': 0,
    'tooltip_visible': True,
    'entity_drawer': True,
    'markdown_preview': True,
    'focus_reading': True,
    'custom_field_created': True,
    'custom_field_value': 'alta',
    'tags_updated': True,
    'field_color_rule': 'status',
    'image_uploaded': True,
    'image_mode': 'icon',
    'relation_drawer': True,
    'routing_handle': True,
    'manual_curve_flip': True,
    'routing_mode_after_flip': 'assisted',
    'routing_reset_auto': 'auto',
    'cluster_drag_changed': True,
    'cluster_drag_member_count': 7,
    'annotation_created': True,
    'axes_layout': 'axes',
    'axis_main': 1,
    'axes_cluster_keys': 6,
    'axes_hulls_hidden': 0,
    'new_relation_count': 7,
    'export_schema_version': '1.0.0',
    'export_has_positions': True,
    'export_has_routing': True,
    'export_has_fields': True,
    'export_has_visuals': True,
    'export_has_viewport': True,
    'import_roundtrip': True,
    'workspace_panel': True,
    'search_result_count': 1,
    'search_dims_nonmatches': True,
    'workspace_bundle_nodes': 2,
    'workspace_bundle_title': 'Exemplo Local-first',
    'workspace_bundle_connected': True,
    'workspace_export_format': 'hexmap-workspace',
    'workspace_export_markdown': True,
    'responsive_all_inside': True,
    'zoom_200_layout_equivalent': True,
    'keyboard_help': True,
    'closed_drawer_hidden': True,
    'tablet_overflow_menu': True,
    'presentation_read_only': True,
    'presentation_chrome_clean': True,
    'errors': [],
}
for key, value in expected.items():
    assert report.get(key) == value, f'browser report {key}: expected {value!r}, got {report.get(key)!r}'
assert report.get('style_color_inputs', 0) >= 1
assert report.get('clusters_grouped_by_field', 0) >= 2
print('PASS browser smoke')

preview_names = [
    'default.png', 'reading-focus.png', 'fields-and-style.png',
    'relation-routing.png', 'canvas-text.png', 'axes.png',
]
missing_previews = [name for name in preview_names if not (ROOT / 'previews' / name).exists()]
if missing_previews:
    raise SystemExit(f'FAIL missing previews: {missing_previews}')
for name in preview_names:
    assert (ROOT / 'previews' / name).stat().st_size > 10_000, f'preview too small: {name}'
for name in ['viewport-320.png', 'viewport-375.png', 'viewport-768.png', 'viewport-1440.png', 'presentation-tablet.png']:
    path = ROOT / 'previews' / 'audit' / name
    assert path.exists() and path.stat().st_size > 10_000, f'audit preview missing or too small: {name}'
print('PASS preview evidence')

html = (ROOT / 'index.html').read_text(encoding='utf-8')
app = (ROOT / 'app.js').read_text(encoding='utf-8')
styles = (ROOT / 'styles.css').read_text(encoding='utf-8')
router = (ROOT / 'router.js').read_text(encoding='utf-8')
schema = json.loads((ROOT / 'schemas/hexmap.schema.json').read_text(encoding='utf-8'))
for expected_text in ['data-tool="move"', 'data-tool="connect"', 'data-tool="add"', 'data-tool="text"', 'id="layoutSelect"']:
    assert expected_text in html
for expected_text in ['renderMarkdown', 'focusReadingHtml', 'groupByField', 'addTextAt', 'exportMap', 'importMap', 'renderWorkspaceDrawer', 'toggleSearch', 'window.HexMapStudio']:
    assert expected_text in app
for expected_text in ['routeRelation', 'outwardPenalty', 'mapInteriorPenalty', 'hardCollisions', 'crossings']:
    assert expected_text in router
for expected_text in ['.hex-border', '.cluster-contour', '.cluster-label', '.drawer.focus', '.focus-document', '.hex-image']:
    assert expected_text in styles
assert schema['$schema'] == 'https://json-schema.org/draft/2020-12/schema'
print('PASS feature gates')

workspace_example = ROOT / 'examples' / 'workspace'
assert (workspace_example / 'hexmap.yaml').exists()
assert len(list((workspace_example / 'notas').glob('*.md'))) >= 2
assert (workspace_example / '.hexmap' / 'map.json').exists()
bundle = json.loads((ROOT / 'examples' / 'workspace-bundle.json').read_text(encoding='utf-8'))
assert bundle.get('format') == 'hexmap-workspace' and bundle.get('files')
print('PASS local-first workspace fixtures')
print('PASS')
