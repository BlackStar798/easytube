#!/usr/bin/env bash
# Builds the Windows installer and the release zip on Linux (no Wine needed).
# Needs: node/npm, python3, and electron-builder's NSIS cache (created on its first run:
#        ~/.cache/electron-builder/nsis-*/ and nsis-resources-*/).
set -euo pipefail
cd "$(dirname "$0")/.."

npm run fetch-binaries
rm -rf dist/win-unpacked
npx electron-builder --win --x64 --dir

NS=$(ls -d "$HOME"/.cache/electron-builder/nsis-3*/nsis-3*/ 2>/dev/null | head -1)
RES=$(ls -d "$HOME"/.cache/electron-builder/nsis-resources-*/nsis-resources-*/plugins/x86-unicode 2>/dev/null | head -1)
if [ -z "$NS" ] || [ -z "$RES" ]; then
  echo "NSIS cache not found in ~/.cache/electron-builder (run 'npx electron-builder --win --x64' once so it downloads NSIS)." >&2
  exit 1
fi
NS=${NS%/}
NSISDIR=$NS NSISCONFDIR=$NS "$NS/linux/makensis" -V2 -DRESDIR="$RES" installer.nsi

python3 release/make_release.py
