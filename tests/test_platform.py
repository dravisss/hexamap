from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path

from hexmap_cli import initial_map
from hexmap_export import ExportError, export_visual, publish_project, render_svg
from hexmap_mcp import dispatch
from hexmap_platform import HexMapError, audit_map, export_bundle, import_bundle, init_workspace, load_workspace, normalize_relations, render_project, save_workspace, scalable_compose, select_view
from migrations.registry import migrate_map

ROOT = Path(__file__).resolve().parents[1]


class PlatformTests(unittest.TestCase):
    def test_workspace_headless_roundtrip(self):
        data, context = load_workspace(ROOT / "examples/workspace")
        self.assertEqual(len(data["hexagons"]), 2)
        self.assertFalse(context["diagnostics"])
        with tempfile.TemporaryDirectory() as temp:
            bundle = export_bundle(ROOT / "examples/workspace", Path(temp) / "project.json")
            targets = import_bundle(bundle, Path(temp) / "imported")
            self.assertGreaterEqual(len(targets), 4)
            imported, _ = load_workspace(Path(temp) / "imported")
            self.assertEqual({item["id"] for item in imported["hexagons"]}, {item["id"] for item in data["hexagons"]})

    def test_workspace_can_be_created_without_database(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp) / "new-project"
            artifacts = init_workspace(project, "Novo Projeto")
            self.assertTrue((project / "hexmap.yaml").exists())
            self.assertTrue((project / ".hexmap/map.json").exists())
            loaded, _ = load_workspace(project)
            self.assertEqual(loaded["id"], "novo-projeto")
            self.assertGreaterEqual(len(artifacts), 2)

    def test_scalable_composer_is_stable_without_overlaps(self):
        data = initial_map("Scale test")
        for cluster_index in range(12):
            cluster_id = f"cluster-{cluster_index}"
            data["clusters"].append({"id": cluster_id, "title": cluster_id, "description": "", "bodyMarkdown": "", "tags": [], "fields": {}, "color": "#687b9b", "label": {"mode": "auto", "offsetX": 0, "offsetY": 0}})
            for item_index in range(25):
                data["hexagons"].append({"id": f"h-{cluster_index}-{item_index}", "title": "Item", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 0, "r": 0, "clusterId": cluster_id, "axisPosition": None})
        first = scalable_compose(data, "research", seed=42)
        second = scalable_compose(data, "research", seed=42)
        coordinates = [(item["q"], item["r"]) for item in first["hexagons"]]
        self.assertEqual(len(coordinates), len(set(coordinates)))
        self.assertEqual(coordinates, [(item["q"], item["r"]) for item in second["hexagons"]])
        self.assertEqual(audit_map(first)["verdict"], "ACCEPT_WITH_GAPS")

    def test_all_visual_presets_preserve_semantics(self):
        data, _ = load_workspace(ROOT / "examples/workspace")
        baseline_ids = {item["id"] for item in data["hexagons"]}
        for preset in ("editorial", "research", "ecosystem", "causal", "actors", "process", "roadmap", "comparison", "technical", "minimal"):
            composed = scalable_compose(data, preset)
            self.assertEqual({item["id"] for item in composed["hexagons"]}, baseline_ids)
            self.assertEqual(composed["styleRules"]["preset"], preset)

    def test_arbitrary_project_renders_standalone(self):
        data, _ = load_workspace(ROOT / "examples/workspace")
        with tempfile.TemporaryDirectory() as temp:
            output = render_project(data, Path(temp) / "preview.html")
            text = output.read_text(encoding="utf-8")
            self.assertIn("HexMapStudio.setMap", text)
            self.assertIn("exemplo-local-first", text)

    def test_mcp_lists_and_calls_tools(self):
        listed = dispatch({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = {item["name"] for item in listed["result"]["tools"]}
        self.assertIn("compose_project", names)
        called = dispatch({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "inspect_project", "arguments": {"project": str(ROOT / "examples/workspace")}}})
        self.assertFalse(called["result"]["isError"])
        self.assertEqual(called["result"]["structuredContent"]["data"]["map"]["id"], "exemplo-local-first")

    def test_mcp_publish_tool_is_read_only(self):
        called = dispatch({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "publish_project", "arguments": {"project": str(ROOT / "examples/workspace"), "output": "/tmp/hexmap-mcp-test", "formats": ["svg"]}}})
        self.assertFalse(called["result"]["isError"])
        self.assertTrue(called["result"]["structuredContent"]["data"]["readOnly"])

    def test_standalone_publication_preserves_metadata_and_is_read_only(self):
        data, _ = load_workspace(ROOT / "examples/workspace")
        data["metadata"] = {"author": "Ravi", "license": "MIT", "source": "local"}
        with tempfile.TemporaryDirectory() as temp:
            artifacts = publish_project(ROOT / "examples/workspace", Path(temp) / "publication", formats=("html", "svg"), metadata=data["metadata"])
            self.assertEqual({path.suffix for path in artifacts}, {".html", ".svg"})
            html = artifacts[0].read_text(encoding="utf-8")
            self.assertIn('meta name="author" content="Ravi"', html)
            self.assertIn("somente leitura", html)
            self.assertNotIn("showDirectoryPicker", html)
            svg = artifacts[1].read_text(encoding="utf-8")
            self.assertIn('role="img"', svg)
            self.assertIn("Ravi", svg)

    def test_zip_bundle_roundtrip_and_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            bundle = export_bundle(ROOT / "examples/workspace", Path(temp) / "project.zip")
            destination = Path(temp) / "imported"
            first = import_bundle(bundle, destination)
            self.assertTrue(any(path.name == "map.json" for path in first))
            (destination / "hexmap.yaml").write_text("changed\n", encoding="utf-8")
            second = import_bundle(bundle, destination)
            self.assertTrue(any("backups" in path.as_posix() for path in second))
            imported, _ = load_workspace(destination)
            self.assertEqual(imported["id"], "exemplo-local-first")

    def test_adversarial_bundle_paths_and_checksum_are_rejected_before_write(self):
        with tempfile.TemporaryDirectory() as temp:
            traversal = Path(temp) / "bad.json"
            traversal.write_text(json.dumps({"format": "hexmap-workspace", "version": "2.0.0", "files": {"../../escape.md": "x"}}), encoding="utf-8")
            with self.assertRaises(HexMapError): import_bundle(traversal, Path(temp) / "target")
            valid = Path(temp) / "valid.json"
            valid.write_text(json.dumps({"format": "hexmap-workspace", "version": "2.0.0", "files": {"note.md": "hello"}, "checksums": {"note.md": "0" * 64}}), encoding="utf-8")
            with self.assertRaises(HexMapError): import_bundle(valid, Path(temp) / "target")

    def test_migration_is_real_ordered_and_idempotent(self):
        legacy = {"schemaVersion": "0.9.0", "id": "legacy", "title": "Legacy", "entities": [{"id": "n1", "name": "Nota", "cluster": "c1"}], "edges": []}
        migrated, applied = migrate_map(legacy)
        self.assertEqual(applied, ["0.9.0->1.0.0"])
        self.assertEqual(migrated["schemaVersion"], "1.0.0")
        self.assertEqual(migrated["hexagons"][0]["title"], "Nota")
        again, no_steps = migrate_map(migrated)
        self.assertEqual(no_steps, [])
        self.assertEqual(again, migrated)

    def test_future_versions_fail_closed(self):
        with self.assertRaises(HexMapError) as context:
            save_workspace(Path(tempfile.mkdtemp()), {**initial_map("Future"), "schemaVersion": "9.0.0"})
        self.assertEqual(context.exception.code, "HEXMAP_VERSION_UNSUPPORTED")

    def test_universal_relations_support_hexagons_clusters_and_adjacent_edges(self):
        data = initial_map("Topology")
        data["hexagons"] = [
            {"id": "a", "title": "A", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 0, "r": 0, "clusterId": "c", "axisPosition": None},
            {"id": "b", "title": "B", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 1, "r": 0, "clusterId": None, "axisPosition": None},
        ]
        data["clusters"] = [{"id": "c", "title": "C", "description": "", "bodyMarkdown": "", "tags": [], "fields": {}, "color": "#687b9b", "label": {"mode": "auto", "offsetX": 0, "offsetY": 0}}]
        data["relations"] = [
            {"id": "path", "source": "a", "target": "b", "style": "edge", "label": "segue", "routing": {"mode": "auto", "offset": {"along": 0, "perpendicular": 0}}},
            {"id": "mixed", "source": "c", "target": "b", "style": "curve", "label": "inclui", "routing": {"mode": "auto", "offset": {"along": 0, "perpendicular": 0}}},
        ]
        normalized = normalize_relations(data)
        self.assertEqual((normalized[0]["sourceType"], normalized[0]["targetType"]), ("hexagon", "hexagon"))
        self.assertEqual((normalized[1]["sourceType"], normalized[1]["targetType"]), ("cluster", "hexagon"))
        data["hexagons"][1]["q"] = 3
        with self.assertRaises(HexMapError) as context:
            normalize_relations(data)
        self.assertEqual(context.exception.code, "HEXMAP_RELATION_NOT_ADJACENT")

    def test_named_views_roundtrip_without_duplicating_markdown(self):
        data = initial_map("Views")
        data["views"].append({"id": "mosaic", "title": "Mosaico", "mode": "mosaic", "showClusterHulls": False,
                              "layout": {**data["layout"], "mode": "mosaic", "showClusterHulls": False}})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            save_workspace(root, data)
            view_files = list((root / ".hexmap/views").glob("*.json"))
            self.assertEqual(len(view_files), 2)
            self.assertFalse(any(path.suffix == ".md" for path in (root / ".hexmap/views").iterdir()))
            loaded, _ = load_workspace(root)
            self.assertEqual({view["id"] for view in loaded["views"]}, {"main", "mosaic"})
            selected = select_view(loaded, "mosaic")
            self.assertEqual(selected["layout"]["mode"], "mosaic")
            self.assertFalse(selected["layout"]["showClusterHulls"])

    def test_publication_honors_selected_view_and_typed_endpoints(self):
        data = initial_map("Publish views")
        data["hexagons"] = [
            {"id": "a", "title": "A", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 0, "r": 0, "clusterId": None, "axisPosition": None, "sourcePath": "a.md"},
            {"id": "b", "title": "B", "summary": "", "bodyMarkdown": "", "tags": [], "fields": {}, "visual": {"mode": "text", "image": {}}, "q": 1, "r": 0, "clusterId": None, "axisPosition": None, "sourcePath": "b.md"},
        ]
        data["relations"] = [{"id": "path", "source": "a", "target": "b", "sourceType": "hexagon", "targetType": "hexagon", "style": "edge", "label": "segue", "routing": {"mode": "auto", "offset": {"along": 0, "perpendicular": 0}}}]
        data["views"].append({"id": "mosaic", "title": "Mosaico", "mode": "mosaic", "showClusterHulls": False,
                              "layout": {**data["layout"], "mode": "mosaic", "showClusterHulls": False}})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            save_workspace(root, data)
            artifacts = publish_project(root, Path(temp) / "published", formats=("svg",), view_id="mosaic")
            svg = artifacts[0].read_text(encoding="utf-8")
            self.assertIn('class="relation edge"', svg)
            self.assertNotIn('aria-label="Contornos dos clusters"', svg)
            with self.assertRaises(HexMapError):
                select_view(load_workspace(root)[0], "missing")


if __name__ == "__main__": unittest.main()
