# m8-lean-check — FastAPI wrapper around a persistent Lean 4 REPL with Mathlib.
#
# Truth-tool contract (see ../../LEAN_INFRA_DESIGN.md):
#   POST /check  {code, timeout_s?}  ->  {verified, errors, sorries, elapsed_ms, ...}
#   verified=true ONLY if the code elaborates with zero errors AND zero sorries
#   AND passes the injection screen. A proof with `sorry` type-checks but proves
#   nothing — that is REJECTED, never verified.
#
# One REPL process, Mathlib imported once at startup (the expensive step — this
# is why the service exists instead of `lake env lean file.lean` per request).
# Concurrency=1 on Cloud Run; an asyncio lock is the in-process backstop.

import asyncio
import json
import os
import re
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MATHLIB_DIR = os.environ.get("MATHLIB_DIR", "/opt/mathlib4")
REPL_BIN = os.environ.get("REPL_BIN", "/opt/repl/.lake/build/bin/repl")
CHECK_TOKEN = os.environ.get("LEAN_CHECK_TOKEN", "")
IMPORT_TIMEOUT_S = int(os.environ.get("IMPORT_TIMEOUT_S", "240"))
MAX_CODE_LEN = int(os.environ.get("MAX_CODE_LEN", "20000"))

# The env already has Mathlib imported; user code must not smuggle anything in.
# `sorry`/`admit` are also caught structurally (REPL reports sorries) — the
# textual screen is belt-and-braces and gives a cleaner error message.
FORBIDDEN = [
    (re.compile(r"^\s*import\b", re.M), "import (Mathlib is pre-imported; no other imports allowed)"),
    (re.compile(r"\baxiom\b"), "axiom (would let any statement be 'proved')"),
    (re.compile(r"\bsorry\b"), "sorry (a sorried proof proves nothing)"),
    (re.compile(r"\badmit\b"), "admit (alias of sorry)"),
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

    async def start(self):
        if self.starting:
            return
        self.starting = True
        self.ready.clear()
        try:
            # `lake env` from the Mathlib project dir puts Mathlib's .oleans on
            # LEAN_PATH for the REPL binary.
            self.proc = await asyncio.create_subprocess_exec(
                "lake", "env", REPL_BIN,
                cwd=MATHLIB_DIR,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            resp = await self._send({"cmd": "import Mathlib"}, IMPORT_TIMEOUT_S)
            if "env" not in resp:
                raise ReplCrashed(f"Mathlib import failed: {resp}")
            self.base_env = resp["env"]
            self.ready.set()
        finally:
            self.starting = False

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
        asyncio.create_task(self.start())

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
    asyncio.create_task(repl.start())


def auth(authorization: str | None):
    if not CHECK_TOKEN:
        raise HTTPException(500, "LEAN_CHECK_TOKEN is not configured on the service")
    if authorization != f"Bearer {CHECK_TOKEN}":
        raise HTTPException(401, "bad or missing bearer token")


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "ready": repl.ready.is_set(),
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
        raise HTTPException(503, "Lean REPL is still importing Mathlib — retry in ~60s")
    result = await repl.check(req.code, req.timeout_s)
    result["toolchain"] = repl.toolchain
    result["mathlib"] = repl.mathlib_rev
    return result
