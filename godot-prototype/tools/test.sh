#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GODOT_BIN="${GODOT_BIN:-godot}"
# All temporary engine caches stay within a disposable directory, not HOME.
RUNTIME="$(mktemp -d "${TMPDIR:-/tmp}/banish-godot-test.XXXXXX")"
trap 'rm -rf "$RUNTIME"' EXIT
export XDG_CACHE_HOME="$RUNTIME/cache"
export XDG_CONFIG_HOME="$RUNTIME/config"
export XDG_DATA_HOME="$RUNTIME/data"
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"
python3 "$ROOT/tools/verify_assets.py"
"$GODOT_BIN" --headless --path "$ROOT" --editor --import --quit > "$RUNTIME/import.log" 2>&1
cat "$RUNTIME/import.log"
if grep -Eq '(^| )(ERROR:|SCRIPT ERROR:)' "$RUNTIME/import.log"; then exit 1; fi
"$GODOT_BIN" --headless --path "$ROOT" --script tests/smoke.gd
"$GODOT_BIN" --headless --path "$ROOT" --quit-after 180 > "$RUNTIME/run.log" 2>&1
cat "$RUNTIME/run.log"
if grep -Eq '(^| )(ERROR:|SCRIPT ERROR:)' "$RUNTIME/run.log"; then exit 1; fi
