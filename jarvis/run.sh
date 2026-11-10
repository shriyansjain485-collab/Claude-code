#!/bin/sh
# Start Jarvis:   ./run.sh            (add --dry-run to preview changes only)
# Never needs sudo. Never touches anything outside this folder.
set -eu
cd "$(dirname "$0")"

# Tell Ollama to listen on this computer only, and to stay off the internet.
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NO_CLOUD=1
export DO_NOT_TRACK=1

if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "Jarvis needs Python 3.11 or newer. See 'Setup' in README.md."
  exit 1
fi

# If no model server is answering on localhost, start Ollama (if installed).
if ! "$PY" -c 'import socket; socket.create_connection(("127.0.0.1", 11434), 1).close()' 2>/dev/null; then
  if command -v ollama >/dev/null 2>&1; then
    echo "Starting the local model server (Ollama) on 127.0.0.1 ..."
    mkdir -p data
    ollama serve >data/ollama-server.log 2>&1 &
    i=0
    while [ $i -lt 40 ]; do
      "$PY" -c 'import socket; socket.create_connection(("127.0.0.1", 11434), 1).close()' 2>/dev/null && break
      i=$((i + 1)); sleep 0.25
    done
  else
    echo "Ollama is not installed or not running. See 'Setup' in README.md."
    exit 1
  fi
fi

PYTHONPATH=src exec "$PY" -m jarvis "$@"
