#!/bin/sh
# Adaptive-memory launcher for hosts that start the server directly
# (`node dist/index.js`) instead of through scripts/start-with-diagnostics.mjs.
#
# Node derives its default heap ceiling from the *host's* physical RAM, so inside
# a container or a small VPS the heap can grow past the real memory limit until
# the kernel OOM-kills the process. This launcher reads the real cgroup/host
# limit, pins the V8 heap inside it, and then `exec`s Node, so no extra resident
# supervisor process is left behind (important on a 256 MB server).
#
# The sizing lives in scripts/memory-limit.mjs so the wrapper and this launcher
# can never disagree.
#
# Usage: scripts/run-server.sh [node args...]   e.g. scripts/run-server.sh dist/index.js
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
NODE_BIN=${NODE_BIN:-node}

# memory-limit.mjs reads NODE_OPTIONS from the environment and returns it with
# the adaptive heap/semi-space bounds merged in, so unrelated options survive.
NODE_OPTIONS=$("$NODE_BIN" "$SCRIPT_DIR/memory-limit.mjs" --node-options)
export NODE_OPTIONS
export NODE_ENV=${NODE_ENV:-production}

cd "$ROOT"
exec "$NODE_BIN" "$@"
