#!/bin/sh
# Stop a running Jarvis immediately, from any terminal:   ./stop.sh
set -eu
cd "$(dirname "$0")"
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
PYTHONPATH=src exec "$PY" -m jarvis stop
