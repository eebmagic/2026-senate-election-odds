#!/usr/bin/env python3
"""Capture a preview image of the live site's map (or any element) via headless Chrome.

Zero third-party deps: drives the locally-installed Chrome over the DevTools
Protocol using only the standard library (a ~120-line WebSocket client lives in
`_CDP` below). Intended to be run after `script.py` refreshes
`web/live-senate-data.json`, to regenerate the link-preview / OG image.

Examples
--------
    # Assume a server is already running on :8000, write web/preview.jpg
    python3 scripts/build_preview_image.py

    # Let the script serve web/ itself (for cron / CI)
    python3 scripts/build_preview_image.py --serve

    # Full page instead of just the map, as PNG
    python3 scripts/build_preview_image.py --selector '#page' --format png --out /tmp/full.png
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from http.client import HTTPConnection

# --- Chrome discovery ---------------------------------------------------------

_CHROME_CANDIDATES = [
    os.environ.get("CHROME_BIN", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
]


def find_chrome() -> str:
    for cand in _CHROME_CANDIDATES:
        if not cand:
            continue
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
        found = shutil.which(cand)
        if found:
            return found
    sys.exit(
        "Could not find Chrome. Set CHROME_BIN to the executable, e.g.\n"
        "  CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'"
    )


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_for_port(host: str, port: int, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with contextlib.suppress(OSError):
            with socket.create_connection((host, port), timeout=1):
                return
        time.sleep(0.1)
    raise TimeoutError(f"nothing listening on {host}:{port} after {timeout}s")


# --- Minimal DevTools-Protocol client (stdlib-only WebSocket) ----------------


class _CDP:
    """Just enough of RFC 6455 + CDP to navigate, evaluate JS, and screenshot."""

    def __init__(self, ws_url: str, timeout: float = 30.0):
        # ws://host:port/devtools/page/<id>
        assert ws_url.startswith("ws://"), ws_url
        host_port, _, path = ws_url[len("ws://"):].partition("/")
        host, _, port = host_port.partition(":")
        self._sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self._sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self._sock.sendall(
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {host_port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n".encode()
        )
        self._fp = self._sock.makefile("rb")
        line = self._fp.readline()
        if b"101" not in line:
            raise RuntimeError(f"WebSocket upgrade failed: {line!r}")
        while self._fp.readline() not in (b"\r\n", b"", b"\n"):
            pass
        self._id = 0
        self._events: list[dict] = []

    # framing ---------------------------------------------------------------
    def _send_text(self, text: str) -> None:
        payload = text.encode()
        header = bytearray([0x81])  # FIN + text
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._sock.sendall(bytes(header) + masked)

    def _read_exact(self, n: int) -> bytes:
        buf = self._fp.read(n)
        if not buf or len(buf) < n:
            raise ConnectionError("socket closed mid-frame")
        return buf

    def _recv_message(self) -> dict:
        """Return the next complete CDP JSON message (text frames only)."""
        chunks: list[bytes] = []
        while True:
            b1, b2 = self._read_exact(2)
            opcode = b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read_exact(8))[0]
            data = self._read_exact(length) if length else b""
            if opcode == 0x9:  # ping -> pong
                self._send_pong(data)
                continue
            if opcode == 0x8:  # close
                raise ConnectionError("server closed WebSocket")
            if opcode == 0xA:  # pong
                continue
            chunks.append(data)
            if b1 & 0x80:  # FIN
                return json.loads(b"".join(chunks).decode())

    def _send_pong(self, data: bytes) -> None:
        mask = os.urandom(4)
        header = bytes([0x8A, 0x80 | len(data)]) + mask
        self._sock.sendall(header + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    # CDP -----------------------------------------------------------------
    def call(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        self._id += 1
        mid = self._id
        self._send_text(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self._recv_message()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method} failed: {msg['error']}")
                return msg.get("result", {})
            if "method" in msg:
                self._events.append(msg)
        raise TimeoutError(f"no response to {method} within {timeout}s")

    def wait_event(self, method: str, timeout: float = 30.0) -> dict:
        for ev in self._events:
            if ev.get("method") == method:
                return ev
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self._recv_message()
            if msg.get("method") == method:
                return msg
            if "method" in msg:
                self._events.append(msg)
        raise TimeoutError(f"event {method} not seen within {timeout}s")

    def evaluate(self, expression: str, timeout: float = 30.0):
        res = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        if res.get("exceptionDetails"):
            raise RuntimeError(f"JS error: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._sock.close()


# --- readiness / geometry probes -------------------------------------------

_READY_JS = """
(function () {
  var app = document.getElementById('app');
  var status = document.getElementById('status');
  var paths = document.querySelectorAll('#map-svg g path');
  return !!app && getComputedStyle(app).display !== 'none'
      && (!status || getComputedStyle(status).display === 'none')
      && paths.length > 40;
})()
"""


def _rect_js(selector: str) -> str:
    sel = json.dumps(selector)
    return (
        "(function(){var el=document.querySelector(%s);if(!el)return null;"
        "var r=el.getBoundingClientRect();"
        "return {x:r.x,y:r.y,width:r.width,height:r.height,dpr:window.devicePixelRatio};})()"
        % sel
    )


# --- main -----------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8000", help="page to capture (default: %(default)s)")
    ap.add_argument("--selector", default="#map-wrap", help="element to clip to (default: %(default)s)")
    ap.add_argument("--out", default=os.path.join("web", "preview.jpg"), help="output path (default: %(default)s)")
    ap.add_argument("--format", choices=["jpeg", "png"], default="jpeg")
    ap.add_argument("--quality", type=int, default=90, help="JPEG quality 0-100 (default: %(default)s)")
    ap.add_argument("--width", type=int, default=1200, help="viewport width (default: %(default)s)")
    ap.add_argument("--height", type=int, default=900, help="viewport height (default: %(default)s)")
    ap.add_argument("--scale", type=float, default=2.0, help="device scale factor / pixel density (default: %(default)s)")
    ap.add_argument("--pad", type=int, default=0, help="pixels of padding to add around the element")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds to wait for the render (default: %(default)s)")
    ap.add_argument("--serve", action="store_true", help="serve --serve-dir over http first and capture that")
    ap.add_argument("--serve-dir", default="web", help="dir to serve when --serve (default: %(default)s)")
    ap.add_argument("--serve-port", type=int, default=8000, help="port for --serve (default: %(default)s)")
    ap.add_argument("--keep-chrome-log", action="store_true", help="print Chrome's stderr on exit")
    args = ap.parse_args()

    if args.format == "png" and args.out.endswith(".jpg"):
        args.out = args.out[:-4] + ".png"

    procs: list[subprocess.Popen] = []
    tmp_profile = tempfile.mkdtemp(prefix="preview-chrome-")
    chrome_log = tempfile.TemporaryFile()
    try:
        target_url = args.url
        if args.serve:
            server = subprocess.Popen(
                [sys.executable, "-m", "http.server", str(args.serve_port), "--bind", "127.0.0.1"],
                cwd=args.serve_dir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            procs.append(server)
            wait_for_port("127.0.0.1", args.serve_port, timeout=10)
            target_url = f"http://localhost:{args.serve_port}"

        dbg_port = free_port()
        chrome = subprocess.Popen(
            [
                find_chrome(),
                "--headless=new",
                f"--remote-debugging-port={dbg_port}",
                f"--user-data-dir={tmp_profile}",
                f"--window-size={args.width},{args.height}",
                f"--force-device-scale-factor={args.scale}",
                "--hide-scrollbars",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-gpu",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=chrome_log,
        )
        procs.append(chrome)

        # Grab the page target's WebSocket URL from the DevTools HTTP endpoint.
        deadline = time.time() + 15
        ws_url = None
        while time.time() < deadline and ws_url is None:
            with contextlib.suppress(Exception):
                conn = HTTPConnection("127.0.0.1", dbg_port, timeout=2)
                conn.request("GET", "/json/list")
                targets = json.loads(conn.getresponse().read())
                for t in targets:
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        ws_url = t["webSocketDebuggerUrl"]
                        break
            if ws_url is None:
                time.sleep(0.2)
        if ws_url is None:
            raise TimeoutError("Chrome DevTools endpoint never exposed a page target")

        cdp = _CDP(ws_url, timeout=args.timeout + 10)
        try:
            cdp.call("Page.enable")
            cdp.call("Runtime.enable")
            cdp.call("Page.navigate", {"url": target_url})
            with contextlib.suppress(TimeoutError):
                cdp.wait_event("Page.loadEventFired", timeout=args.timeout)

            deadline = time.time() + args.timeout
            while time.time() < deadline:
                if cdp.evaluate(_READY_JS):
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError(
                    f"page at {target_url} never reached a ready state "
                    f"(#app visible + map paths rendered) within {args.timeout}s"
                )
            with contextlib.suppress(Exception):
                cdp.evaluate("document.fonts ? document.fonts.ready.then(()=>1) : 1")
            time.sleep(0.35)  # settle: last layout / transition tick

            rect = cdp.evaluate(_rect_js(args.selector))
            if not rect or rect["width"] < 1 or rect["height"] < 1:
                raise RuntimeError(f"selector {args.selector!r} not found or has zero size: {rect}")

            pad = args.pad
            clip = {
                "x": max(rect["x"] - pad, 0),
                "y": max(rect["y"] - pad, 0),
                "width": rect["width"] + pad * 2,
                "height": rect["height"] + pad * 2,
                "scale": 1,
            }
            shot_params = {
                "format": args.format,
                "clip": clip,
                "captureBeyondViewport": True,
                "fromSurface": True,
            }
            if args.format == "jpeg":
                shot_params["quality"] = args.quality

            result = cdp.call("Page.captureScreenshot", shot_params, timeout=args.timeout)
            data = base64.b64decode(result["data"])
        finally:
            cdp.close()

        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "wb") as fh:
            fh.write(data)

        px_w = round(clip["width"] * args.scale)
        px_h = round(clip["height"] * args.scale)
        print(
            f"wrote {args.out}  ({len(data):,} bytes, ~{px_w}x{px_h}px, "
            f"{args.format}{f' q{args.quality}' if args.format == 'jpeg' else ''}, "
            f"selector {args.selector})"
        )
    finally:
        for p in reversed(procs):
            with contextlib.suppress(Exception):
                p.terminate()
                p.wait(timeout=5)
        if args.keep_chrome_log:
            chrome_log.seek(0)
            sys.stderr.write(chrome_log.read().decode(errors="replace"))
        chrome_log.close()
        shutil.rmtree(tmp_profile, ignore_errors=True)


if __name__ == "__main__":
    main()
