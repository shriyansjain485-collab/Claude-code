#!/bin/sh
# macOS: run Jarvis's tests inside Apple's sandbox with ALL non-local
# networking denied by the operating system. No admin password needed.
#   ./scripts/offline_check.sh
set -eu
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
PROFILE='(version 1)(allow default)(deny network*)(allow network* (local ip "localhost:*"))(allow network* (remote ip "localhost:*"))(allow network* (remote unix-socket))'
exec sandbox-exec -p "$PROFILE" "$PY" -m pytest -q
