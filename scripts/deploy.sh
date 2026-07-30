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
#   scripts/deploy.sh              # debug APK, then build and start
#   scripts/deploy.sh --release    # release APK (signed if AL_KEYSTORE is set)
#   scripts/deploy.sh --no-apk     # skip the APK, reuse whatever is in mobile/dist
#
# The plain `docker compose up -d --build` still works. It just bundles whatever
# APK is already in mobile/dist/, or none at all.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BUILD_TYPE=debug
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
