#!/bin/bash
# Build "SAT Practice.app" — a native window around the Vite build.
#
#   ./desktop/build.sh            build into desktop/build/
#   ./desktop/build.sh --install  also copy into /Applications
#
# No Electron: the whole app is a WKWebView plus the static build, so it comes
# out a few megabytes and launches instantly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/desktop/build"
APP="$BUILD/SAT Practice.app"
CONTENTS="$APP/Contents"

echo "==> Rebuilding the dataset"
cd "$ROOT"
python3 -m ingest.run

echo "==> Building the web app"
cd "$ROOT/app"
[ -d node_modules ] || npm install --silent
# Relative asset paths so the bundle works under the custom scheme.
npm run build

echo "==> Assembling the bundle"
rm -rf "$BUILD"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp -R "$ROOT/app/dist" "$CONTENTS/Resources/web"

echo "==> Compiling"
swiftc -O \
  -target arm64-apple-macos13.0 \
  -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
  -o "$CONTENTS/MacOS/SATPractice" \
  "$ROOT/desktop/SATPractice.swift"

echo "==> Icon"
ICONSET="$BUILD/icon.iconset"
mkdir -p "$ICONSET"
swiftc -O -framework AppKit -o "$BUILD/makeicon" "$ROOT/desktop/makeicon.swift" 2>/dev/null
"$BUILD/makeicon" "$BUILD" >/dev/null
for s in 16 32 128 256 512; do
  cp "$BUILD/icon_$s.png" "$ICONSET/icon_${s}x${s}.png"
  d=$((s * 2))
  [ -f "$BUILD/icon_$d.png" ] && cp "$BUILD/icon_$d.png" "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET" "$BUILD"/icon_*.png "$BUILD/makeicon"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>SAT Practice</string>
  <key>CFBundleDisplayName</key><string>SAT Practice</string>
  <key>CFBundleExecutable</key><string>SATPractice</string>
  <key>CFBundleIdentifier</key><string>local.satpractice</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticTermination</key><true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$CONTENTS/PkgInfo"

# Ad-hoc sign so Gatekeeper lets a locally built app run without a prompt.
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "   (codesign skipped)"

# Make sure Finder picks up the new icon rather than a cached one.
touch "$APP"

echo "==> Self-test"
RESULT=$("$CONTENTS/MacOS/SATPractice" --selftest 2>&1 | grep SELFTEST || true)
if [ -z "$RESULT" ] || echo "$RESULT" | grep -q FAILED; then
  echo "    BUNDLE IS BROKEN: ${RESULT:-no result}"
  exit 1
fi
echo "    $RESULT"

SIZE=$(du -sh "$APP" | cut -f1)
echo "==> Built: $APP  ($SIZE)"

if [ "${1:-}" = "--install" ]; then
  echo "==> Installing to /Applications"
  rm -rf "/Applications/SAT Practice.app"
  cp -R "$APP" /Applications/
  echo "==> Installed. Launch it from Spotlight: SAT Practice"
fi
