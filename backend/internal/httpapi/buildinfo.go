package httpapi

import (
	"net/http"
	"runtime"
)

// BuildInfo describes the running build. The Docker image's OCI labels cannot
// be read from inside the container, so the same values docker/metadata-action
// writes as labels are passed in as build args and linked into the binary (see
// the Dockerfile). Every field is empty on a plain `go build`, and the client
// simply omits the rows it has no value for.
type BuildInfo struct {
	// Version is the release tag, or `git describe` output for untagged builds.
	Version string `json:"version"`
	// Revision is the full commit SHA the image was built from.
	Revision string `json:"revision,omitempty"`
	// Created is the image build timestamp, RFC 3339.
	Created string `json:"created,omitempty"`
	// Licenses is the SPDX identifier from the repository's licence.
	Licenses string `json:"licenses,omitempty"`
	// Source is the repository URL.
	Source string `json:"source,omitempty"`
	// GoVersion is the toolchain the server binary was compiled with.
	GoVersion string `json:"goVersion"`
	// Platform is the OS/architecture the server is running on.
	Platform string `json:"platform"`
}

// handleBuildInfo reports what build is running, for the About dialog. It sits
// behind auth because the commit SHA and toolchain version are useful to an
// attacker fingerprinting a deployment and of no use to a logged-out visitor.
func (s *Server) handleBuildInfo(w http.ResponseWriter, _ *http.Request) {
	info := s.build
	info.GoVersion = runtime.Version()
	info.Platform = runtime.GOOS + "/" + runtime.GOARCH
	writeJSON(w, http.StatusOK, info)
}
