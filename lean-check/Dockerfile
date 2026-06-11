# m8-lean-check — Lean 4 + Mathlib verification service for Cloud Run.
# Stage 1 downloads the Mathlib .olean cache (never compiles Mathlib) and builds
# the leanprover-community REPL at Mathlib's pinned toolchain. Stage 2 is the
# Python/FastAPI runtime that drives the REPL. Final image ~8-10 GB.
#
# Build (Cloud Build needs a long timeout — cache download alone is GBs):
#   gcloud builds submit --timeout=3600s --tag <region>-docker.pkg.dev/<proj>/m8/lean-check .

FROM debian:bookworm-slim AS lean-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates unzip && rm -rf /var/lib/apt/lists/*
ENV ELAN_HOME=/opt/elan
ENV PATH=/opt/elan/bin:$PATH
RUN curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
      | sh -s -- -y --no-modify-path --default-toolchain none

# Pin MATHLIB_REV to a release tag for reproducible verdicts (master = latest;
# fine for v1, pin before relying on it for real conjectures).
ARG MATHLIB_REV=master
WORKDIR /opt
RUN git clone --depth 1 --branch ${MATHLIB_REV} \
      https://github.com/leanprover-community/mathlib4 mathlib4
WORKDIR /opt/mathlib4
# elan reads lean-toolchain and auto-installs the matching Lean; cache get
# downloads prebuilt .olean files instead of compiling Mathlib (hours -> minutes).
RUN lake exe cache get

# REPL built against the SAME toolchain as Mathlib (toolchain mismatch = the
# classic failure mode here; copying mathlib's lean-toolchain is the documented fix).
WORKDIR /opt
RUN git clone --depth 1 https://github.com/leanprover-community/repl repl
WORKDIR /opt/repl
RUN cp /opt/mathlib4/lean-toolchain ./lean-toolchain && lake build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=lean-build /opt/elan /opt/elan
COPY --from=lean-build /opt/mathlib4 /opt/mathlib4
COPY --from=lean-build /opt/repl /opt/repl
ENV ELAN_HOME=/opt/elan
ENV PATH=/opt/elan/bin:$PATH
ENV MATHLIB_DIR=/opt/mathlib4
ENV REPL_BIN=/opt/repl/.lake/build/bin/repl

WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .

# Cloud Run injects PORT; default 8080 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
