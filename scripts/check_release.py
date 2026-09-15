#!/usr/bin/env python3
"""Verify release artifacts, checksums and package contents without installing."""
from __future__ import annotations

import argparse
import hashlib
import re
import tarfile
import zipfile
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback
    tomllib = None

ROOT = Path(__file__).resolve().parents[1]
SECRET_RE = re.compile(r"(?:^|/)(?:\.env(?:\.|$)|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12))", re.IGNORECASE)
REQUIRED_STANDALONE = {"index.html", "preview-inline.html", "styles.css", "app.js", "LICENSE", "standalone-manifest.json"}


def expected_version() -> str:
    if tomllib is None:
        match = re.search(r"^version\s*=\s*['\"]([^'\"]+)['\"]", (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE)
        value = match.group(1) if match else None
    else:
        with (ROOT / "pyproject.toml").open("rb") as handle:
            value = tomllib.load(handle).get("project", {}).get("version")
    if not isinstance(value, str) or not value:
        raise SystemExit("missing project version")
    return value


def validate_member(name: str) -> None:
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise SystemExit(f"unsafe archive member: {name}")
    if SECRET_RE.search(name) or ".DS_Store" in path.parts or "__pycache__" in path.parts or name.endswith((".pyc", ".pyo")):
        raise SystemExit(f"secret/cache in release artifact: {name}")


def inspect_zip(path: Path, release_version: str) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for name in names:
            validate_member(name)
        if "standalone" in path.name:
            missing = REQUIRED_STANDALONE - set(names)
            if missing:
                raise SystemExit(f"standalone missing: {sorted(missing)}")
            manifest = archive.read("standalone-manifest.json").decode("utf-8")
            if f'"version": "{release_version}"' not in manifest:
                raise SystemExit("standalone manifest version mismatch")
        else:
            required = {"hexmap_cli.py", "hexmap_platform.py", "hexmap_mcp.py", "server.py"}
            if (ROOT / "hexmap_export.py").is_file():
                required.add("hexmap_export.py")
            if not required.issubset(names) or not any(name.endswith("/preview-inline.html") for name in names):
                missing = sorted(required - set(names))
                if not any(name.endswith("/preview-inline.html") for name in names):
                    missing.append("preview-inline.html")
                if (ROOT / "migrations").is_dir() and not any(name.startswith("migrations/") for name in names):
                    missing.append("migrations/")
                raise SystemExit(f"wheel missing runtime files: {missing}")
            if (ROOT / "migrations").is_dir() and not any(name.startswith("migrations/") for name in names):
                raise SystemExit("wheel missing migrations package")
            metadata = next((name for name in names if name.endswith(".dist-info/METADATA")), None)
            if not metadata or f"Version: {release_version}" not in archive.read(metadata).decode("utf-8"):
                raise SystemExit("wheel metadata version mismatch")


def inspect_sdist(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            validate_member(member.name)
            if member.issym() or member.islnk():
                raise SystemExit(f"link in source archive: {member.name}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--standalone-only", action="store_true", help="verify only the standalone ZIP")
    args = parser.parse_args(argv)
    dist = args.dist.expanduser().resolve()
    if not dist.is_dir():
        raise SystemExit(f"distribution directory not found: {dist}")
    release_version = expected_version()
    sums_path = dist / "SHA256SUMS.txt"
    if not sums_path.is_file():
        raise SystemExit("missing SHA256SUMS.txt")
    expected: dict[str, str] = {}
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) != 2 or len(parts[0]) != 64 or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
            raise SystemExit(f"invalid checksum line: {line!r}")
        expected[parts[1]] = parts[0].lower()
    artifacts = [path for path in dist.iterdir() if path.is_file() and path.suffix in {".whl", ".gz", ".zip"}]
    if not artifacts:
        raise SystemExit("no wheel/sdist/standalone artifacts")
    required_suffixes = {".zip"} if args.standalone_only else {".whl", ".gz", ".zip"}
    if {path.suffix for path in artifacts} != required_suffixes:
        raise SystemExit("expected wheel, sdist (.tar.gz) and standalone (.zip)")
    for suffix in required_suffixes:
        if sum(path.suffix == suffix for path in artifacts) != 1:
            raise SystemExit(f"expected exactly one {suffix} artifact")
    for path in sorted(artifacts):
        if path.name not in expected:
            raise SystemExit(f"artifact absent from checksum manifest: {path.name}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected[path.name]:
            raise SystemExit(f"checksum mismatch: {path.name}")
        if release_version not in path.name:
            raise SystemExit(f"artifact version mismatch: {path.name}")
        if path.suffix == ".zip":
            inspect_zip(path, release_version)
        elif path.suffix == ".whl":
            inspect_zip(path, release_version)
        else:
            inspect_sdist(path)
    print(f"PASS release artifacts ({len(artifacts)}) and SHA-256 manifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
