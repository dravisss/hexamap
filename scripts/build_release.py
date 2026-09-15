#!/usr/bin/env python3
"""Build wheel, sdist and a deterministic standalone ZIP.

This script only creates local artifacts. It never uploads to PyPI, creates a
GitHub release, or reads credentials. Use ``check_release.py`` afterwards.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import importlib.util
import shutil
import subprocess
import sys
import tarfile
import zipfile
import re
from datetime import datetime, timezone
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback
    tomllib = None

ROOT = Path(__file__).resolve().parents[1]
STANDALONE_FILES = (
    "index.html", "preview-inline.html", "styles.css", "app.js", "data.js", "three-view.bundle.js",
    "hex.js", "router.js", "markdown.js", "frontmatter.js", "workspace.js",
    "LICENSE", "README.md", "SECURITY.md", "CHANGELOG.md",
)
STANDALONE_DIRS = ("schemas", "docs", "assets")
FORBIDDEN_NAMES = {".env", ".env.local", ".env.production", ".DS_Store", "id_rsa", "id_ed25519"}


def version() -> str:
    if tomllib is None:
        match = re.search(r"^version\s*=\s*['\"]([^'\"]+)['\"]", (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE)
        value = match.group(1) if match else None
    else:
        with (ROOT / "pyproject.toml").open("rb") as handle:
            value = tomllib.load(handle).get("project", {}).get("version")
    if not isinstance(value, str) or not value:
        raise SystemExit("pyproject.toml has no project.version")
    return value


def safe_rel(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    if relative.startswith("../") or "/../" in relative or relative in {".", ""}:
        raise SystemExit(f"unsafe release path: {relative}")
    return relative


def standalone_paths() -> list[Path]:
    paths = [ROOT / item for item in STANDALONE_FILES]
    for directory in STANDALONE_DIRS:
        paths.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())
    missing = [safe_rel(path) for path in paths if not path.is_file()]
    if missing:
        raise SystemExit(f"standalone input missing: {missing}")
    selected = []
    for path in sorted(set(paths), key=safe_rel):
        relative = safe_rel(path)
        if path.is_symlink() or any(part in {"__pycache__", ".git"} for part in path.parts):
            raise SystemExit(f"refusing symlink/cache in standalone: {relative}")
        if path.name in FORBIDDEN_NAMES or path.name.lower().endswith((".pem", ".key")):
            raise SystemExit(f"refusing secret-looking standalone file: {relative}")
        selected.append(path)
    return selected


def zip_timestamp() -> tuple[int, int, int, int, int, int]:
    raw = os.environ.get("SOURCE_DATE_EPOCH", "0")
    try:
        epoch = max(0, int(raw))
    except ValueError as exc:
        raise SystemExit("SOURCE_DATE_EPOCH must be an integer") from exc
    stamp = datetime.fromtimestamp(epoch, tz=timezone.utc)
    # ZIP timestamps cannot represent dates before 1980.
    stamp = max(stamp, datetime(1980, 1, 1, tzinfo=timezone.utc))
    return stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second - stamp.second % 2


def build_standalone(out: Path, release_version: str) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"hexmap-studio-{release_version}-standalone.zip"
    files = standalone_paths()
    manifest = {
        "format": "hexmap-standalone",
        "version": release_version,
        "files": [safe_rel(path) for path in files],
    }
    timestamp = zip_timestamp()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            relative = safe_rel(path)
            info = zipfile.ZipInfo(relative, date_time=timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
        info = zipfile.ZipInfo("standalone-manifest.json", date_time=timestamp)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return target


def build_python(out: Path) -> None:
    try:
        python_build_available = importlib.util.find_spec("build.__main__") is not None
    except ModuleNotFoundError:
        python_build_available = False
    if python_build_available:
        command = [sys.executable, "-m", "build", "--sdist", "--wheel", "--outdir", str(out)]
    elif uv := shutil.which("uv"):
        command = [uv, "build", "--sdist", "--wheel", "--out-dir", str(out), str(ROOT)]
    else:
        raise SystemExit(
            "Python package build frontend unavailable; install 'build' in the build environment "
            "or provide the uv executable"
        )
    environment = {**os.environ, "SOURCE_DATE_EPOCH": os.environ.get("SOURCE_DATE_EPOCH", "0")}
    try:
        subprocess.run(command, cwd=ROOT, check=True, env=environment)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"Python package build failed with exit code {exc.returncode}") from exc


def normalise_sdist(path: Path) -> None:
    """Remove filesystem owner/timestamp variance from setuptools' sdist."""
    with tarfile.open(path, "r:gz") as source:
        entries = []
        for member in source.getmembers():
            payload = source.extractfile(member).read() if member.isfile() else None
            info = tarfile.TarInfo(member.name)
            info.size = len(payload or b"")
            info.mode = member.mode
            info.type = member.type
            info.linkname = member.linkname
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.pax_headers = {}
            entries.append((info, payload))
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as target:
                for info, payload in entries:
                    target.addfile(info, io.BytesIO(payload) if payload is not None else None)
    os.replace(temporary, path)


def write_checksums(out: Path) -> Path:
    artifacts = sorted(
        path for path in out.iterdir()
        if path.is_file() and path.name != "SHA256SUMS.txt" and path.suffix in {".whl", ".gz", ".zip"}
    )
    if not artifacts:
        raise SystemExit("no release artifacts found")
    target = out / "SHA256SUMS.txt"
    lines = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}" for path in artifacts]
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--standalone-only", action="store_true", help="skip the Python wheel/sdist build")
    parser.add_argument("--clean", action="store_true", help="remove known release artifacts in the output directory first")
    args = parser.parse_args(argv)
    release_version = version()
    out = args.output_dir.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.clean:
        for path in out.iterdir():
            if path.is_file() and (path.name == "SHA256SUMS.txt" or path.suffix in {".whl", ".gz", ".zip"}):
                path.unlink()
    if not args.standalone_only:
        build_python(out)
        sdists = sorted(out.glob("*.tar.gz"))
        if len(sdists) != 1:
            raise SystemExit("expected exactly one sdist after build")
        normalise_sdist(sdists[0])
    standalone = build_standalone(out, release_version)
    checksums = write_checksums(out)
    print(f"built {standalone.name}")
    print(f"wrote {checksums}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
