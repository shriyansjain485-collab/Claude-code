#!/bin/sh
# Checks that what you downloaded came from the official sources. macOS.
# Read-only: changes nothing, needs no admin password.
#   ./scripts/verify_downloads.sh
set -u
status=0

echo "1) Ollama app signature (should be signed by 'Ollama Inc.' and notarised by Apple)"
APP=/Applications/Ollama.app
[ -d "$APP" ] || APP="$HOME/Applications/Ollama.app"
if [ -d "$APP" ]; then
  codesign --verify --deep --strict "$APP" && echo "   signature: valid" || { echo "   signature: INVALID"; status=1; }
  codesign -dv "$APP" 2>&1 | grep -E "Authority=Developer ID|TeamIdentifier" | sed 's/^/   /'
  spctl --assess --type execute "$APP" 2>&1 | sed 's/^/   Gatekeeper: /' || status=1
else
  echo "   Ollama.app not found in Applications (skip if you installed it another way)"
fi

echo "2) Downloaded models (each file is named after its SHA-256 and re-checked here)"
MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"
if [ -d "$MODELS/blobs" ]; then
  for blob in "$MODELS"/blobs/sha256-*; do
    [ -f "$blob" ] || continue
    expected=$(basename "$blob" | sed 's/^sha256-//')
    actual=$(shasum -a 256 "$blob" | cut -d' ' -f1)
    if [ "$expected" = "$actual" ]; then echo "   ok       $(basename "$blob" | cut -c1-19)…"
    else echo "   MISMATCH $(basename "$blob")"; status=1; fi
  done
  echo "   Compare the model digest shown by 'ollama list' with the one on"
  echo "   https://ollama.com/library/<model>/tags to confirm it is the official build."
else
  echo "   no models downloaded yet"
fi

[ $status -eq 0 ] && echo "All checks passed." || echo "SOMETHING DID NOT VERIFY. Do not use it; re-download from the official site."
exit $status
