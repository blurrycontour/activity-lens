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
#   AL_KEYSTORE        path to a PKCS#12 keystore (.p12); release builds are
#                      signed with it. A legacy .jks is detected by extension.
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

# Build-time settings (version stamp, Android signing) live in .env.build, which
# is separate from the runtime .env the server reads. Loaded here rather than
# required on the command line so a keystore password never has to be typed into
# a shell — and never lands in shell history.
#
# The file fills in blanks; it never overrides. `AL_VERSION=x scripts/apk.sh`
# has to mean what it says, and sourcing the file wholesale made it silently not
# — the file won, and the argument was discarded.
load_build_env() {
  local file="$REPO_ROOT/.env.build" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    value=${line#*=}
    # Trim whitespace around the name, and one layer of quotes off the value.
    key=$(printf '%s' "$key" | tr -d '[:space:]')
    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      "'"*"'") value=${value#"'"}; value=${value%"'"} ;;
    esac
    # A leading ~ is expanded, because a path is the most likely thing in here
    # and "~/keys/app.p12" is how a person writes one. Sourcing the file used to
    # do this for free; reading it line by line does not.
    case "$value" in
      "~") value="$HOME" ;;
      "~/"*) value="$HOME/${value#\~/}" ;;
    esac
    [ -n "$key" ] || continue
    # Only when the caller has not already said otherwise.
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}
load_build_env

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
# A node_modules built somewhere else — on the host, by scripts/build-apk.sh's
# caller — records a store path this environment does not have, and pnpm stops to
# ask before rebuilding it. There is no terminal to ask, so it aborts. Answering
# in advance is right for a build: the tree is disposable and the lockfile is the
# thing being trusted. Passed per command rather than set in either
# pnpm-workspace.yaml, because it is the container crossing a bind mount that
# makes it necessary, and a developer deleting their own node_modules by hand
# should still be asked first.
PNPM_INSTALL=(pnpm install --frozen-lockfile --config.confirmModulesPurge=false)
# Only the container sets this; a dev machine keeps its own global store.
if [ -n "${PNPM_STORE_DIR:-}" ]; then
  PNPM_INSTALL+=(--config.storeDir="$PNPM_STORE_DIR")
fi

cd "$REPO_ROOT/frontend"
"${PNPM_INSTALL[@]}"
VITE_APP_VERSION="$AL_VERSION" pnpm build

# --- 2. Copy it into the Android project -------------------------------------
echo "==> Syncing Capacitor"
cd "$REPO_ROOT/mobile"
# pnpm here too, not npm: one package manager for the repository. Both workspaces
# are locked by a pnpm-lock.yaml, and a stray `npm ci` would need a
# package-lock.json that no longer exists.
"${PNPM_INSTALL[@]}"
# Refuses to continue if the Capacitor JavaScript in the bundle and the native
# code about to be compiled came from different versions.
pnpm run --silent check-versions
pnpm exec cap sync android

# --- 3. Compile ---------------------------------------------------------------
#
# Gradle properties are passed as ORG_GRADLE_PROJECT_* rather than -P: a
# keystore password on a command line is visible to every process on the machine
# and lands in CI logs on failure.
echo "==> Gradle assemble$BUILD_TYPE"
export ORG_GRADLE_PROJECT_alVersionName="$AL_VERSION"
export ORG_GRADLE_PROJECT_alVersionCode="$AL_VERSION_CODE"
# Installs alongside the real app rather than replacing it. Set in .env.build for
# a workstation and absent in CI, so a build from your tree can never take over
# the copy you actually use — including a locally signed release build, which is
# otherwise indistinguishable from the published one.
export ORG_GRADLE_PROJECT_alAppIdSuffix="${AL_APP_ID_SUFFIX:-}"
SIGNED=0
if [ -n "${AL_KEYSTORE:-}" ]; then
  # Absolute, because Gradle resolves relative paths against the module dir.
  export ORG_GRADLE_PROJECT_alKeystore="$(cd "$(dirname "$AL_KEYSTORE")" && pwd)/$(basename "$AL_KEYSTORE")"
  export ORG_GRADLE_PROJECT_alKeystorePassword="${AL_KEYSTORE_PASSWORD:-}"
  export ORG_GRADLE_PROJECT_alKeyAlias="${AL_KEY_ALIAS:-}"
  # A PKCS#12 keystore keeps one password for the store and the key, and keytool
  # sets them together. Left empty, the Android plugin treats the signing config
  # as incomplete and quietly produces an *unsigned* release APK, so defaulting
  # it is what makes the common setup work rather than half-work.
  export ORG_GRADLE_PROJECT_alKeyPassword="${AL_KEY_PASSWORD:-${AL_KEYSTORE_PASSWORD:-}}"
  SIGNED=1
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

# Which application this APK installs as.
#
# Read back out of the built file rather than assembled from the base id and
# AL_APP_ID_SUFFIX, so it cannot disagree with what Gradle actually produced.
#
# The client needs it to tell an update from a different app. Android will not
# replace an app with one whose id differs — it installs a second copy — so a
# server bundling the published APK has nothing to offer a locally built `.dev`
# install, and saying so is the difference between "no update" and an update
# prompt that reappears forever because installing it never changes anything.
#
# Empty if aapt2 is not around. Consumers treat that as "unknown" and fall back
# to the version comparison alone, which is how this behaved before.
APP_ID=""
AAPT2="$(command -v aapt2 || ls "${ANDROID_HOME:-/opt/android-sdk}"/build-tools/*/aapt2 2>/dev/null | tail -1)"
if [ -n "$AAPT2" ]; then
  APP_ID="$("$AAPT2" dump packagename "$OUT_DIR/$NAME" 2>/dev/null | tr -d '\r\n' || true)"
fi

cat > "$OUT_DIR/apk.json" <<JSON
{
  "version": "${AL_VERSION}",
  "versionCode": ${AL_VERSION_CODE},
  "buildType": "${BUILD_TYPE}",
  "applicationId": "${APP_ID}",
  "file": "${NAME}",
  "sha256": "${SHA}"
}
JSON

# A signing config the Android plugin considers incomplete does not fail the
# build — it drops the signature and carries on. An unsigned release APK looks
# entirely normal until a phone refuses to install it, so the claim is checked
# rather than assumed.
if [ "$SIGNED" = 1 ]; then
  APKSIGNER="$(command -v apksigner || ls "${ANDROID_HOME:-/opt/android-sdk}"/build-tools/*/apksigner 2>/dev/null | tail -1)"
  if [ -n "$APKSIGNER" ]; then
    if "$APKSIGNER" verify "$OUT_DIR/$NAME" >/dev/null 2>&1; then
      echo "    signature: verified"
    else
      echo "A keystore was configured but the APK is not signed." >&2
      echo "Check AL_KEYSTORE_PASSWORD, AL_KEY_ALIAS and AL_KEY_PASSWORD." >&2
      "$APKSIGNER" verify "$OUT_DIR/$NAME" >&2 2>&1 || true
      exit 1
    fi
  fi
fi

# Said once, at the end, where it will actually be read. A debug APK is fine for
# a quick check but is not what you want on a phone you use: it is signed with a
# generated key and marked debuggable, which is the combination Play Protect
# blocks with "unsafe app blocked".
if [ "$BUILD_TYPE" = "debug" ]; then
  echo
  echo "    Note: this is a debug build. Android will warn on install and make"
  echo "    you choose \"install anyway\". Configure AL_KEYSTORE in .env.build"
  echo "    and build a release APK to avoid that; see mobile/README.md."
fi

echo
echo "==> $OUT_DIR/$NAME"
ls -lh "$OUT_DIR/$NAME" | awk '{print "    size:   " $5}'
echo "    sha256: $SHA"
