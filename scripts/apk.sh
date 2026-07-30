#!/usr/bin/env bash
#
# Builds the Activity Lens Android APK from the current working tree.
#
# This is the build itself, and the only definition of it. It assumes a JDK, the
# Android SDK and Node are already on PATH, which is true in three places:
# scripts/build-apk.sh (which supplies them in a container), the GitHub Actions
# runner, and a machine with Android Studio installed. Having one script rather
# than three keeps a CI-only build failure from being a thing that can happen.
#
# Usage:
#   scripts/apk.sh [debug|release]
#
# Environment:
#   AL_VERSION         version name, e.g. 1.4.0   (default: git describe)
#   AL_VERSION_CODE    integer, must increase     (default: commit count)
#   AL_KEYSTORE        path to a keystore; release builds are signed with it
#   AL_KEYSTORE_PASSWORD, AL_KEY_ALIAS, AL_KEY_PASSWORD
#
# Without a keystore, a release build still succeeds and produces an unsigned
# APK. That is the right outcome for someone building their own copy, and CI
# supplies the keystore when it has one.

set -euo pipefail

BUILD_TYPE="${1:-debug}"
case "$BUILD_TYPE" in
  debug|release) ;;
  *) echo "usage: $0 [debug|release]" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Version defaults come from git so a local build is labelled with what it was
# built from instead of a placeholder. versionCode must be a monotonically
# increasing integer for Android to accept an upgrade, and the commit count is
# the one number in a git repository that always is.
if [ -z "${AL_VERSION:-}" ]; then
  AL_VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo 0.0.0-dev)"
fi
if [ -z "${AL_VERSION_CODE:-}" ]; then
  AL_VERSION_CODE="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
fi

echo "==> Activity Lens APK: $BUILD_TYPE $AL_VERSION (code $AL_VERSION_CODE)"

# --- 1. The web app ----------------------------------------------------------
#
# The APK ships the same bundle the PWA does; mobile/capacitor.config.ts points
# at this output directory rather than building anything of its own.
echo "==> Building the web app"
# A dev machine typically gets pnpm from corepack; the build image and CI both
# have it installed already, so this is a convenience rather than a requirement.
corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null; then
  echo "pnpm not found. Install it (npm install -g pnpm), or run scripts/build-apk.sh" >&2
  echo "to build in a container that already has the whole toolchain." >&2
  exit 1
fi
cd "$REPO_ROOT/frontend"
pnpm install --frozen-lockfile
VITE_APP_VERSION="$AL_VERSION" pnpm build

# --- 2. Copy it into the Android project -------------------------------------
echo "==> Syncing Capacitor"
cd "$REPO_ROOT/mobile"
npm ci
# Refuses to continue if the Capacitor JavaScript in the bundle and the native
# code about to be compiled came from different versions.
npm run --silent check-versions
npx cap sync android

# --- 3. Compile ---------------------------------------------------------------
#
# Gradle properties are passed as ORG_GRADLE_PROJECT_* rather than -P: a
# keystore password on a command line is visible to every process on the machine
# and lands in CI logs on failure.
echo "==> Gradle assemble$BUILD_TYPE"
export ORG_GRADLE_PROJECT_alVersionName="$AL_VERSION"
export ORG_GRADLE_PROJECT_alVersionCode="$AL_VERSION_CODE"
if [ -n "${AL_KEYSTORE:-}" ]; then
  # Absolute, because Gradle resolves relative paths against the module dir.
  export ORG_GRADLE_PROJECT_alKeystore="$(cd "$(dirname "$AL_KEYSTORE")" && pwd)/$(basename "$AL_KEYSTORE")"
  export ORG_GRADLE_PROJECT_alKeystorePassword="${AL_KEYSTORE_PASSWORD:-}"
  export ORG_GRADLE_PROJECT_alKeyAlias="${AL_KEY_ALIAS:-}"
  export ORG_GRADLE_PROJECT_alKeyPassword="${AL_KEY_PASSWORD:-}"
  echo "    signing with $ORG_GRADLE_PROJECT_alKeystore"
fi

cd "$REPO_ROOT/mobile/android"
# --no-daemon: a background daemon that outlives the build is wasted memory on a
# workstation and a source of stale state in a container that is about to exit.
GRADLE_TASK="assemble$(tr '[:lower:]' '[:upper:]' <<< "${BUILD_TYPE:0:1}")${BUILD_TYPE:1}"
./gradlew --no-daemon "$GRADLE_TASK"

# --- 4. Collect ---------------------------------------------------------------
#
# mobile/dist/ holds exactly one APK: the last one built. The server image copies
# whatever is here, so leaving an older build alongside would make "which APK is
# in the image" ambiguous — and that question has to have one answer.
OUT_DIR="$REPO_ROOT/mobile/dist"
mkdir -p "$OUT_DIR"
APK="$(find "$REPO_ROOT/mobile/android/app/build/outputs/apk/$BUILD_TYPE" -name '*.apk' -print -quit)"
if [ -z "$APK" ]; then
  echo "Gradle reported success but produced no APK" >&2
  exit 1
fi
rm -f "$OUT_DIR"/*.apk "$OUT_DIR"/apk.json
NAME="activity-lens-${AL_VERSION}-${BUILD_TYPE}.apk"
cp "$APK" "$OUT_DIR/$NAME"

# Metadata the server reads at startup, so it reports the version of the APK it
# is actually serving rather than assuming it matches its own. The checksum is
# what CI uses to prove the image and the release carry the same bytes.
SHA="$(sha256sum "$OUT_DIR/$NAME" | cut -d" " -f1)"
cat > "$OUT_DIR/apk.json" <<JSON
{
  "version": "${AL_VERSION}",
  "versionCode": ${AL_VERSION_CODE},
  "buildType": "${BUILD_TYPE}",
  "file": "${NAME}",
  "sha256": "${SHA}"
}
JSON

echo
echo "==> $OUT_DIR/$NAME"
ls -lh "$OUT_DIR/$NAME" | awk '{print "    size:   " $5}'
echo "    sha256: $SHA"
