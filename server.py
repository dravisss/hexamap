#!/usr/bin/env python3
"""Small, loopback-only static server for the HexMap preview.

The server deliberately has no application endpoints, uploads, authentication,
or network discovery. Use ``--allow-network`` only behind an operator-owned
firewall or authenticated reverse proxy.
"""
from __future__ import annotations

import argparse
import ipaddress
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PORT = 8123
HOST = "127.0.0.1"


def default_root() -> Path:
    module_root = Path(__file__).resolve().parent
    if (module_root / "index.html").exists():
        return module_root
    installed = module_root / "share" / "hexmap-studio"
    if (installed / "preview-inline.html").exists():
        return installed
    return module_root


ROOT = default_root()

# preview-inline.html contains the intentionally inline standalone bundle. A
# nonce cannot be injected into an arbitrary static file, so this CSP documents
# the narrow compatibility exception while blocking all remote execution.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
    "form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'"
)
SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def is_loopback_host(host: str) -> bool:
    """Return whether *host* is syntactically a loopback address."""
    value = host.strip().lower().strip("[]")
    if value == "localhost":
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def validate_bind(host: str, port: int, *, allow_network: bool = False) -> tuple[str, int]:
    """Validate a bind before opening a listening socket."""
    if not host or any(char in host for char in "\r\n\x00"):
        raise ValueError("host inválido")
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("porta deve estar entre 0 e 65535")
    if not allow_network and not is_loopback_host(host):
        raise ValueError("bind externo exige --allow-network")
    return host, port


class SecureRequestHandler(SimpleHTTPRequestHandler):
    """Static handler with security headers and symlink escape protection."""

    server_version = "HexMapStudio/10.1"

    def __init__(self, *args, directory: str | None = None, **kwargs):
        self.root = Path(directory or ROOT).resolve()
        super().__init__(*args, directory=str(self.root), **kwargs)

    def _inside_root(self, candidate: Path) -> bool:
        return candidate == self.root or self.root in candidate.parents

    def translate_path(self, path: str) -> str:
        # SimpleHTTPRequestHandler normalises .. segments, but a symlink inside
        # the served tree could still point outside it. Resolve before serving.
        translated = Path(super().translate_path(path)).resolve(strict=False)
        if not self._inside_root(translated):
            self._path_rejected = True
            return str(self.root / ".hexmap-forbidden")
        self._path_rejected = False
        return str(translated)

    def end_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # There are no write endpoints; avoid echoing query strings/cookies.
        path = unquote(urlsplit(self.path).path)
        print(f"{self.address_string()} {self.command} {path}")


class HexMapHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(host: str = HOST, port: int = PORT, directory: Path | str = ROOT, *, allow_network: bool = False) -> HexMapHTTPServer:
    host, port = validate_bind(host, port, allow_network=allow_network)
    root = Path(directory).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"diretório não encontrado: {root}")
    handler = lambda *args, **kwargs: SecureRequestHandler(*args, directory=str(root), **kwargs)
    return HexMapHTTPServer((host, port), handler)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve o preview estático do HexMap em loopback")
    parser.add_argument("--host", default=HOST, help="endereço de bind (padrão: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=PORT, help=f"porta TCP (padrão: {PORT})")
    parser.add_argument("--directory", type=Path, default=ROOT, help="raiz estática a servir")
    parser.add_argument("--allow-network", action="store_true", help="permite bind fora do loopback; não adiciona autenticação")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        server = make_server(args.host, args.port, args.directory, allow_network=args.allow_network)
    except ValueError as exc:
        raise SystemExit(f"erro: {exc}") from exc
    print(f"HexaMap Studio V10: http://{args.host}:{args.port} (raiz: {Path(args.directory).resolve()})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nservidor encerrado")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
