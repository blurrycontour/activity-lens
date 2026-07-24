# syntax=docker/dockerfile:1

# --- Stage 1: build the Go backend (the slow part) -------------------------
# Compiling the Go dependencies takes far longer than the frontend, so this
# stage does it first. It only depends on the Go sources, which lets BuildKit
# run it in parallel with the frontend stage. The expensive dependency
# compilation is warmed against a placeholder embed directory here; the final
# stage then re-links in seconds once the real frontend is available.
FROM golang:1.26-alpine AS backend
WORKDIR /app/backend

# Cache module downloads.
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

# Pre-create the data dir so it can be COPYed with nonroot ownership below.
RUN mkdir -p /data


# --- Stage 2: build the SvelteKit frontend ---------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend

# Install dependencies using the lockfile for reproducible builds.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# --- Stage 3: link the backend with the embedded frontend ------------------
FROM backend AS backend-final
WORKDIR /app/backend

# Embed the compiled frontend into the binary, replacing the placeholder.
COPY --from=frontend /app/frontend/build ./internal/web/dist

# Pure-Go SQLite => CGO can stay off for a fully static binary. Dependencies
# are already compiled in the backend stage's cache, so this is fast.
ARG VERSION=dev
RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/activity-lens ./cmd/server


# --- Stage 4: minimal runtime image ----------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# CA certificates are included in distroless/static for outbound TLS
# (OIDC discovery, SMTP over TLS).
COPY --from=backend-final /out/activity-lens /usr/local/bin/activity-lens

# Writable data directory owned by the nonroot user (uid 65532). A fresh named
# or anonymous volume inherits this ownership on first mount.
COPY --from=backend /data /data

ENV CH_ADDR=:8080 \
    CH_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/activity-lens"]
