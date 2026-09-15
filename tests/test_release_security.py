from __future__ import annotations

import hashlib
import http.client
import socket
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts.build_release import build_python, build_standalone
from scripts.check_release import validate_member
from server import CONTENT_SECURITY_POLICY, make_server, validate_bind


class ReleaseSecurityTests(unittest.TestCase):
    def test_bind_is_loopback_by_default(self):
        self.assertEqual(validate_bind("127.0.0.1", 8123), ("127.0.0.1", 8123))
        with self.assertRaises(ValueError):
            validate_bind("0.0.0.0", 8123)
        self.assertEqual(validate_bind("0.0.0.0", 8123, allow_network=True)[0], "0.0.0.0")

    def test_server_adds_security_headers_and_serves_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "index.html").write_text("ok", encoding="utf-8")
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            server = make_server("127.0.0.1", port, root)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("GET", "/index.html")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b"ok")
                self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")
                self.assertEqual(response.getheader("Referrer-Policy"), "no-referrer")
                self.assertIn("object-src 'none'", response.getheader("Content-Security-Policy", ""))
                self.assertEqual(response.getheader("Cross-Origin-Resource-Policy"), "same-origin")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_standalone_build_is_deterministic_and_has_no_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            first = build_standalone(Path(temp) / "one", "10.1.0")
            second = build_standalone(Path(temp) / "two", "10.1.0")
            self.assertEqual(hashlib.sha256(first.read_bytes()).digest(), hashlib.sha256(second.read_bytes()).digest())
            with zipfile.ZipFile(first) as archive:
                names = set(archive.namelist())
                self.assertIn("preview-inline.html", names)
                self.assertNotIn("../", "\n".join(names))
        with self.assertRaises(SystemExit):
            validate_member("../outside.txt")

    def test_csp_does_not_allow_network_execution(self):
        self.assertIn("script-src 'self'", CONTENT_SECURITY_POLICY)
        self.assertNotIn("script-src *", CONTENT_SECURITY_POLICY)
        self.assertIn("connect-src 'self'", CONTENT_SECURITY_POLICY)

    def test_python_build_uses_uv_when_build_frontend_is_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            with (
                patch("scripts.build_release.importlib.util.find_spec", return_value=None),
                patch("scripts.build_release.shutil.which", return_value="/opt/tools/uv"),
                patch("scripts.build_release.subprocess.run") as run,
            ):
                build_python(Path(temp))
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["/opt/tools/uv", "build", "--sdist", "--wheel"])
        self.assertIn("--out-dir", command)

    def test_python_build_fails_closed_without_a_frontend(self):
        with (
            patch("scripts.build_release.importlib.util.find_spec", return_value=None),
            patch("scripts.build_release.shutil.which", return_value=None),
        ):
            with self.assertRaisesRegex(SystemExit, "build frontend unavailable"):
                build_python(Path("unused"))


if __name__ == "__main__":
    unittest.main()
