#!/usr/bin/env bash
#
# Build and start Activity Lens locally, with the Android app inside the image.
#
# This is what `docker compose up -d --build` became once the server started
# carrying the APK. It is two steps rather than one because building the APK
# means the Android SDK and a Gradle run — putting that inside the server image
# build would make every backend change cost minutes, so the APK is built once,
# beside the image, and copied in.
#
# Usage:
#   scripts/deploy.sh              # build the APK, then build and start
#   scripts/deploy.sh --release    # force a release APK
#   scripts/deploy.sh --debug      # force a debug APK
#   scripts/deploy.sh --no-apk     # skip the APK, reuse whatever is in mobile/dist
#
# The build type follows AL_KEYSTORE from .env.build: release when a signing key
# is configured, debug when there is none. Debug APKs are blocked by Play Protect
# on install, so configuring a key is worth the five minutes.
#
# The plain `docker compose up -d --build` still works. It just bundles whatever
# APK is already in mobile/dist/, or none at all.

set -euo pipefail

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

# Release when a signing key is configured, debug otherwise.
#
# Not a stylistic default. A debug APK is signed with a throwaway key and carries
# android:debuggable, and Android Play Protect blocks exactly that combination
# with "unsafe app blocked" — the user has to dig into "install anyway" every
# time. A release build signed with your own key installs with the ordinary
# sideloading prompt and nothing more. Set AL_KEYSTORE in .env.build to get one;
# see mobile/README.md.
BUILD_TYPE=debug
if [ -n "${AL_KEYSTORE:-}" ]; then
  BUILD_TYPE=release
fi
BUILD_APK=1
for arg in "$@"; do
  case "$arg" in
    --release) BUILD_TYPE=release ;;
    --debug)   BUILD_TYPE=debug ;;
    --no-apk)  BUILD_APK=0 ;;
    # Prints the header block above, stopping at the first line that is not a
    # comment, so the help cannot drift from the file it is in.
    -h|--help) awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/, ""); print}' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ "$BUILD_APK" = 1 ]; then
  echo "==> Step 1/2: Android APK"
  scripts/build-apk.sh "$BUILD_TYPE"
else
  echo "==> Step 1/2: skipped (--no-apk)"
fi

if [ -f mobile/dist/apk.json ]; then
  echo "==> Bundling $(sed -n 's/.*"file": "\(.*\)".*/\1/p' mobile/dist/apk.json)"
else
  echo "==> No APK in mobile/dist/; the server will not offer the Android app"
fi

echo "==> Step 2/2: server image"
docker compose down && docker compose up -d --build

echo
echo "==> Running on http://localhost:9090"
if [ -f mobile/dist/apk.json ]; then
  echo "    The app download is on the login page, and at /api/app/android/download"
fi
