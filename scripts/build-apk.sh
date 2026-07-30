#!/usr/bin/env bash
#
# Builds the Android APK in a container, so the only thing you need installed is
# Docker — no JDK, no Android SDK, no Node.
#
# Usage:
#   scripts/build-apk.sh [debug|release]
#
# The APK lands in mobile/dist/. Everything the build does is in scripts/apk.sh;
# this script only supplies the toolchain to run it with, which is why a local
# build and a CI build cannot drift apart.
#
# If you do have the Android SDK (via Android Studio, say), run scripts/apk.sh
# directly instead — it is the same build without the container.

set -euo pipefail

BUILD_TYPE="${1:-debug}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="activity-lens-android:latest"

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

# One named volume holding the builder's home directory: the Gradle cache, the
# npm cache, and whatever corepack downloads. Gradle alone pulls several hundred
# megabytes on a cold build, and without this every build would pull it again.
# It is the only state that survives a build, so `docker volume rm` on it is a
# complete reset.
CACHE_VOLUME="activity-lens-android-home"

echo "==> Preparing the build image (cached after the first run)"
docker build -f "$REPO_ROOT/Dockerfile.android" -t "$IMAGE" "$REPO_ROOT"

docker volume create "$CACHE_VOLUME" >/dev/null

# Signing material is passed through by value, never mounted from a path the
# container might keep: the keystore is copied into the build context directory
# only for the length of the run.
signing_env=()
mounts=()
if [ -n "${AL_KEYSTORE:-}" ]; then
  if [ ! -f "$AL_KEYSTORE" ]; then
    echo "AL_KEYSTORE is set but $AL_KEYSTORE does not exist" >&2
    exit 1
  fi
  mounts+=(-v "$(cd "$(dirname "$AL_KEYSTORE")" && pwd)/$(basename "$AL_KEYSTORE")":/keystore.p12:ro)
  signing_env+=(-e AL_KEYSTORE=/keystore.p12)
  signing_env+=(-e "AL_KEYSTORE_PASSWORD=${AL_KEYSTORE_PASSWORD:-}")
  signing_env+=(-e "AL_KEY_ALIAS=${AL_KEY_ALIAS:-}")
  signing_env+=(-e "AL_KEY_PASSWORD=${AL_KEY_PASSWORD:-}")
fi

echo "==> Building ($BUILD_TYPE)"
# -t only when there is a terminal, so this works unchanged from a script or CI.
tty_flag=()
[ -t 1 ] && tty_flag=(-t)

docker run --rm "${tty_flag[@]}" \
  --user "$(id -u):$(id -g)" \
  -v "$REPO_ROOT":/repo \
  -v "$CACHE_VOLUME":/home/builder \
  "${mounts[@]}" \
  -e "AL_VERSION=${AL_VERSION:-}" \
  -e "AL_VERSION_CODE=${AL_VERSION_CODE:-}" \
  "${signing_env[@]}" \
  "$IMAGE" -lc "scripts/apk.sh $BUILD_TYPE"
