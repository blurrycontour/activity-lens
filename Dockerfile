# syntax=docker/dockerfile:1

# Build context is this directory (activity-lens). The go-authkit dependency is
# resolved from the Go module proxy using the version pinned in backend/go.mod,
# so no local checkout is required (works identically locally and in CI).

# --- Stage 1: build the Go backend (the slow part) -------------------------
# Compiling the Go dependencies takes far longer than the frontend, so this
# stage does it first. It only depends on the Go sources, which lets BuildKit
# run it in parallel with the frontend stage. The expensive dependency
# compilation is warmed against a placeholder embed directory here; the final
# stage then re-links in seconds once the real frontend is available.
FROM golang:1.26-alpine AS backend
WORKDIR /app/backend

# Cache module downloads. go-authkit is fetched from the proxy like any other
# dependency (a stray go.work is excluded via .dockerignore).
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./

# Warm the Go build cache by compiling against a placeholder embed dir (the
# `//go:embed all:dist` directive requires it to exist). This pre-compiles all
# dependencies so the final build only has to recompile main and embed the
# frontend. Flags must match the final build (notably -trimpath, which is part
# of the build cache key) so the compiled packages are actually reused.
RUN mkdir -p ./internal/web/dist \
    && touch ./internal/web/dist/index.html \
    && CGO_ENABLED=0 go build -trimpath -o /dev/null ./cmd/server

# Pre-create the data dir owned by the distroless nonroot user (uid 65532) so
# the default runtime user can write the SQLite database.
RUN mkdir -p /data && chown 65532:65532 /data


# --- Stage 2: build the React (Vite) frontend ------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend

ARG VERSION=dev
ENV VITE_APP_VERSION=$VERSION

# Enable pnpm via corepack and install using the lockfile for reproducibility.
RUN corepack enable

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build


# --- Stage 3: link the backend with the embedded frontend ------------------
FROM backend AS backend-final
WORKDIR /app/backend

# Embed the compiled frontend into the binary, replacing the placeholder.
COPY --from=frontend /app/frontend/dist ./internal/web/dist

# Pure-Go SQLite => CGO can stay off for a fully static binary. Dependencies
# are already compiled in the backend stage's cache, so this is fast.
# Build provenance, baked into the binary so the running app can report it.
# A container cannot read its own OCI image labels without access to the Docker
# socket, so the same values docker/metadata-action writes as labels are also
# passed in here as build args. The image digest is deliberately absent: it is
# only known after the push, so it cannot exist inside the image it names.
ARG VERSION=dev
ARG REVISION=""
ARG CREATED=""
ARG LICENSES=""
ARG SOURCE=""
RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags "-s -w \
      -X main.version=${VERSION} \
      -X main.revision=${REVISION} \
      -X main.created=${CREATED} \
      -X main.licenses=${LICENSES} \
      -X main.source=${SOURCE}" \
    -o /out/activity-lens ./cmd/server


# --- Stage 4: minimal runtime image ----------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# CA certificates are included in distroless/static for outbound TLS
# (OIDC discovery).
COPY --from=backend-final /out/activity-lens /usr/local/bin/activity-lens

# Writable data directory owned by the nonroot user (uid 65532). A fresh named
# or anonymous volume inherits this ownership on first mount.
COPY --from=backend --chown=65532:65532 /data /data

ENV AL_ADDR=:8080 \
    AL_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/activity-lens"]
