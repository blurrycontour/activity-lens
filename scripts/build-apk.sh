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
# The toolchain is identified by a hash of the file that defines it, which is the
# same tag CI computes in .github/workflows/android.yml. Two consequences worth
# stating: changing Dockerfile.android automatically means a different image
# rather than a stale one under a `latest` tag, and the tag this build wants is
# the tag CI already published — so it can be pulled rather than rebuilt.
#
# Pulling is what makes "the same tools as CI" exact rather than approximate.
# Rebuilding from the Dockerfile gets the same *recipe*, but its base images
# (`eclipse-temurin:21-jdk-noble`, `node:22.21.1-bookworm-slim`) are tags, not
# digests, so a rebuild months later can quietly resolve to a different JDK patch
# than the image CI is using. Pulling gets the bytes.
IMAGE_TAG="$(sha256sum "$REPO_ROOT/Dockerfile.android" | cut -c1-12)"
IMAGE="activity-lens-android:${IMAGE_TAG}"
# Override to point at a fork's registry; unset AL_ANDROID_REGISTRY to skip the
# pull entirely and always build locally.
REGISTRY_IMAGE="${AL_ANDROID_REGISTRY-ghcr.io/blurrycontour/activity-lens-android}"

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
# package caches, and whatever corepack downloads. Gradle alone pulls several
# hundred megabytes on a cold build, and without this every build would pull it
# again.
#
# pnpm's store has to be pointed at it explicitly — see PNPM_STORE_DIR on the
# run below. pnpm otherwise picks a store on the same filesystem as the project,
# so that it can hardlink into node_modules; here the project is a bind mount of
# the working tree and this volume is not, so it wrote a 58 MB .pnpm-store into
# the checkout instead. In the wrong place and not in the cache.
# It is the only state that survives a build, so `docker volume rm` on it is a
# complete reset.
CACHE_VOLUME="activity-lens-android-home"

# Already here from a previous run: nothing to do. The tag is content-addressed,
# so this can never be a stale toolchain.
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Toolchain $IMAGE (already present)"
elif [ -n "$REGISTRY_IMAGE" ] && docker pull "$REGISTRY_IMAGE:$IMAGE_TAG" 2>/dev/null; then
  # Byte-identical to what CI builds with.
  echo "==> Toolchain $IMAGE (pulled from $REGISTRY_IMAGE)"
  docker tag "$REGISTRY_IMAGE:$IMAGE_TAG" "$IMAGE"
else
  # No published image for this Dockerfile — an unpushed local edit to it, a
  # fork, or no network. Building it gives the same recipe, which is the right
  # answer here even though it is not the same bytes.
  echo "==> Toolchain $IMAGE (building; not published for this Dockerfile.android)"
  docker build -f "$REPO_ROOT/Dockerfile.android" -t "$IMAGE" "$REPO_ROOT"
fi

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
  -e PNPM_STORE_DIR=/home/builder/.pnpm-store \
  "${signing_env[@]}" \
  "$IMAGE" -lc "scripts/apk.sh $BUILD_TYPE"
