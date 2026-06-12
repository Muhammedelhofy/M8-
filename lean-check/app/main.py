# m8-lean-check — FastAPI wrapper around a persistent Lean 4 REPL with Mathlib.
#
# Truth-tool contract (see ../../LEAN_INFRA_DESIGN.md):
#   POST /check  {code, timeout_s?}  ->  {verified, errors, sorries, elapsed_ms, ...}
#   THREE-STATE (S4 2026-06-12): verified=true ONLY with zero errors AND zero
#   sorries. Code containing `sorry` is allowed THROUGH the screen so the REPL
#   can elaborate the STATEMENT and report sorries[] — the caller maps that to
#   lean_stated ("statement type-checks, proof open"). A sorried proof is still
#   NEVER verified=true; it is reported, not rejected. (The old textual sorry
#   ban made the caller's lean_stated state unreachable — found by the S4
#   golden-corpus validation.)
#
# One REPL process, Mathlib imported once at startup (the expensive step — this
# is why the service exists instead of `lake env lean file.lean` per request).
# Concurrency=1 on Cloud Run; an asyncio lock is the in-process backstop.
#
# Deploy lessons baked in (Session-9, 2026-06-11):
#  - Google's front-end swallows /healthz on *.run.app — the route is /health.
#  - The service MUST run with --no-cpu-throttling: the import runs outside a
#    request, and request-based billing throttles background CPU to ~zero.
#  - 4 GiB OOMs on `import Mathlib` (peaked 4137 MiB) — run with 8 GiB.
#  - Startup failures must be LOUD and retried: v1 swallowed the asyncio task
#    exception and 503'd forever.

import asyncio
import json
import os
import re
import sys
import time
import traceback

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MATHLIB_DIR = os.environ.get("MATHLIB_DIR", "/opt/mathlib4")
REPL_BIN = os.environ.get("REPL_BIN", "/opt/repl/.lake/build/bin/repl")
CHECK_TOKEN = os.environ.get("LEAN_CHECK_TOKEN", "")
IMPORT_TIMEOUT_S = int(os.environ.get("IMPORT_TIMEOUT_S", "600"))
STARTUP_RETRY_S = int(os.environ.get("STARTUP_RETRY_S", "30"))
MAX_CODE_LEN = int(os.environ.get("MAX_CODE_LEN", "20000"))


def log(msg):
    print(f"[lean-check] {msg}", flush=True)


# The env already has Mathlib imported; user code must not smuggle anything in.
# `sorry`/`admit` are deliberately NOT screened: the REPL reports them in
# sorries[] and `verified` stays false — that structural path is what makes the
# caller's lean_stated ("statement verified, proof open") state possible.
FORBIDDEN = [
    (re.compile(r"^\s*import\b", re.M), "import (Mathlib is pre-imported; no other imports allowed)"),
    (re.compile(r"\baxiom\b"), "axiom (would let any statement be 'proved')"),
    (re.compile(r"\bunsafe\b"), "unsafe"),
    (re.compile(r"#eval\b|#exit\b|#print\s+axioms"), "side-effecting command"),
    (re.compile(r"\bset_option\b"), "set_option (heartbeat/recursion limits stay at defaults)"),
    (re.compile(r"\bopaque\b"), "opaque"),
    (re.compile(r"\bextern\b"), "extern/FFI"),
]


class CheckRequest(BaseModel):
    code: str = Field(..., description="Lean 4 declaration(s), e.g. a theorem with proof")
    timeout_s: int = Field(60, ge=1, le=240)


class ReplCrashed(Exception):
    pass


class Repl:
    """Owns the REPL subprocess. Protocol: one JSON command per line + blank
    line; the REPL answers with a (possibly multi-line) JSON object followed by
    a blank line. On timeout the process is killed and respawned (Mathlib
    re-import) in the background — callers get an honest 'pending' meanwhile."""

    def __init__(self):
        self.proc: asyncio.subprocess.Process | None = None
        self.base_env: int | None = None
        self.lock = asyncio.Lock()
        self.ready = asyncio.Event()
        self.starting = False
        self.last_error = ""
        self.toolchain = self._read(os.path.join(MATHLIB_DIR, "lean-toolchain"))
        self.mathlib_rev = self._git_rev(MATHLIB_DIR)

    @staticmethod
    def _read(path):
        try:
            with open(path) as f:
                return f.read().strip()
        except OSError:
            return "unknown"

    @staticmethod
    def _git_rev(path):
        head = Repl._read(os.path.join(path, ".git", "HEAD"))
        if head.startswith("ref:"):
            return Repl._read(os.path.join(path, ".git", head.split(" ", 1)[1]))[:12]
        return head[:12] or "unknown"

    async def _drain_stderr(self, proc):
        # Never leave stderr unread: a full 64KB pipe buffer blocks the child
        # (this can present as an import that "never finishes").
        try:
            while True:
                line = await proc.stderr.readline()
                if not line:
                    return
                log(f"repl stderr: {line.decode(errors='replace').rstrip()}")
        except Exception:
            return

    async def supervise(self):
        """Keep trying to bring the REPL up. Failures are logged with full
        traceback and retried — the service must never wedge silently."""
        attempt = 0
        while not self.ready.is_set():
            attempt += 1
            try:
                await self._start_once(attempt)
                return
            except Exception as e:
                self.last_error = f"{type(e).__name__}: {e}"
                log(f"startup attempt {attempt} FAILED: {self.last_error}")
                traceback.print_exc(file=sys.stdout)
                sys.stdout.flush()
                if self.proc is not None:
                    try:
                        self.proc.kill()
                    except ProcessLookupError:
                        pass
                    self.proc = None
                await asyncio.sleep(STARTUP_RETRY_S)

    async def _start_once(self, attempt):
        log(f"startup attempt {attempt}: spawning `lake env {REPL_BIN}` in {MATHLIB_DIR}")
        t0 = time.monotonic()
        self.proc = await asyncio.create_subprocess_exec(
            "lake", "env", REPL_BIN,
            cwd=MATHLIB_DIR,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.create_task(self._drain_stderr(self.proc))
        log(f"repl pid={self.proc.pid}; importing Mathlib (budget {IMPORT_TIMEOUT_S}s)…")
        resp = await self._send({"cmd": "import Mathlib"}, IMPORT_TIMEOUT_S)
        if "env" not in resp:
            raise ReplCrashed(f"Mathlib import failed: {resp}")
        self.base_env = resp["env"]
        self.last_error = ""
        self.ready.set()
        log(f"READY — Mathlib imported in {time.monotonic() - t0:.1f}s (env {self.base_env})")

    async def _send(self, obj: dict, timeout_s: float) -> dict:
        if self.proc is None or self.proc.returncode is not None:
            raise ReplCrashed("REPL process is not running")
        payload = json.dumps(obj) + "\n\n"
        self.proc.stdin.write(payload.encode())
        await self.proc.stdin.drain()

        async def read_response():
            lines = []
            while True:
                line = await self.proc.stdout.readline()
                if not line:
                    raise ReplCrashed("REPL closed stdout")
                text = line.decode()
                if text.strip() == "" and lines:
                    break
                if text.strip() != "":
                    lines.append(text)
            return json.loads("".join(lines))

        return await asyncio.wait_for(read_response(), timeout=timeout_s)

    async def kill_and_respawn(self):
        self.ready.clear()
        self.base_env = None
        if self.proc is not None:
            try:
                self.proc.kill()
            except ProcessLookupError:
                pass
            self.proc = None
        asyncio.create_task(self.supervise())

    async def check(self, code: str, timeout_s: int) -> dict:
        async with self.lock:
            t0 = time.monotonic()
            try:
                resp = await self._send({"cmd": code, "env": self.base_env}, timeout_s)
            except asyncio.TimeoutError:
                await self.kill_and_respawn()
                return {
                    "verified": False, "pending": True,
                    "errors": [f"check exceeded {timeout_s}s — REPL restarting (Mathlib re-import ~1-2 min); retry shortly"],
                    "sorries": [], "elapsed_ms": int((time.monotonic() - t0) * 1000),
                }
            except ReplCrashed as e:
                await self.kill_and_respawn()
                return {
                    "verified": False, "pending": True,
                    "errors": [f"REPL crashed: {e} — restarting; retry shortly"],
                    "sorries": [], "elapsed_ms": int((time.monotonic() - t0) * 1000),
                }
            msgs = resp.get("messages", []) or []
            sorries = resp.get("sorries", []) or []
            errors = [m.get("data", "") for m in msgs if m.get("severity") == "error"]
            return {
                "verified": len(errors) == 0 and len(sorries) == 0,
                "pending": False,
                "errors": errors,
                "sorries": [s.get("goal", "") for s in sorries],
                "warnings": [m.get("data", "") for m in msgs if m.get("severity") == "warning"],
                "elapsed_ms": int((time.monotonic() - t0) * 1000),
            }


repl = Repl()
app = FastAPI(title="m8-lean-check")


@app.on_event("startup")
async def startup():
    asyncio.create_task(repl.supervise())


def auth(authorization: str | None):
    if not CHECK_TOKEN:
        raise HTTPException(500, "LEAN_CHECK_TOKEN is not configured on the service")
    if authorization != f"Bearer {CHECK_TOKEN}":
        raise HTTPException(401, "bad or missing bearer token")


# NOTE: /healthz is intercepted by Google's front-end on *.run.app and never
# reaches the container — hence /health.
@app.get("/health")
async def health():
    return {
        "ok": True,
        "ready": repl.ready.is_set(),
        "last_error": repl.last_error,
        "toolchain": repl.toolchain,
        "mathlib": repl.mathlib_rev,
    }


@app.post("/check")
async def check(req: CheckRequest, authorization: str | None = Header(None)):
    auth(authorization)
    if len(req.code) > MAX_CODE_LEN:
        raise HTTPException(413, f"code exceeds {MAX_CODE_LEN} chars")
    for pattern, why in FORBIDDEN:
        if pattern.search(req.code):
            return {
                "verified": False, "pending": False,
                "errors": [f"rejected by injection screen: {why}"],
                "sorries": [], "elapsed_ms": 0,
                "toolchain": repl.toolchain, "mathlib": repl.mathlib_rev,
            }
    if not repl.ready.is_set():
        # Cold start / respawn in progress. 503 + Retry-After keeps the caller's
        # contract simple: M8 logs lean_pending and answers honestly this turn.
        detail = "Lean REPL is still importing Mathlib — retry in ~60s"
        if repl.last_error:
            detail += f" (last startup error: {repl.last_error})"
        raise HTTPException(503, detail)
    result = await repl.check(req.code, req.timeout_s)
    result["toolchain"] = repl.toolchain
    result["mathlib"] = repl.mathlib_rev
    return result
