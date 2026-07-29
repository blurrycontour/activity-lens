package httpapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/imageutil"
	"github.com/blurrycontour/activity-lens/backend/internal/mail"

	"github.com/blurrycontour/go-authkit/httpmw"
)

const (
	avatarURLPrefix   = "/api/avatars/"
	maxAvatarUpload   = 10 << 20 // 10 MiB
	deletionEmailSubj = "Activity Lens account deletion code"
)

// avatarsDir returns the on-disk directory where avatars are stored.
func (s *Server) avatarsDir() string {
	return filepath.Join(s.cfg.DataDir, "avatars")
}

// mailer builds an email sender from the effective SMTP configuration
// (database settings overlaid with environment overrides).
func (s *Server) mailer(ctx context.Context) (*mail.Sender, error) {
	cfg, _, err := s.settings.EffectiveSMTP(ctx)
	if err != nil {
		return nil, err
	}
	return mail.New(mail.Config{
		Host:       cfg.Host,
		Port:       cfg.Port,
		Username:   cfg.Username,
		Password:   cfg.Password,
		From:       cfg.From,
		FromName:   cfg.FromName,
		Encryption: cfg.Encryption,
	}), nil
}

// --- Sessions ---

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	sessions, err := s.auth.ListSessions(r.Context(), user.ID, s.mw.SessionID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (s *Server) handleRevokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	n, err := s.auth.RevokeOtherSessions(r.Context(), user.ID, s.mw.SessionID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": n})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	ok, err := s.auth.RevokeSession(r.Context(), user.ID, r.PathValue("id"), s.mw.SessionID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke session")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Avatar ---

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)

	if err := r.ParseMultipartForm(maxAvatarUpload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, maxAvatarUpload+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read upload")
		return
	}
	if len(raw) > maxAvatarUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "image too large")
		return
	}

	processed, err := imageutil.ProcessAvatar(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "unsupported or invalid image")
		return
	}

	dir := s.avatarsDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		writeError(w, http.StatusInternalServerError, "could not store image")
		return
	}
	filename := fmt.Sprintf("%d-%d.jpg", user.ID, time.Now().UnixNano())
	if err := os.WriteFile(filepath.Join(dir, filename), processed, 0o640); err != nil {
		writeError(w, http.StatusInternalServerError, "could not store image")
		return
	}

	publicURL := avatarURLPrefix + filename
	updated, prevPath, err := s.auth.SetAvatar(r.Context(), user.ID, publicURL)
	if err != nil {
		_ = os.Remove(filepath.Join(dir, filename))
		writeError(w, http.StatusInternalServerError, "could not update profile")
		return
	}

	// Best-effort cleanup of the previous avatar file.
	if prev := avatarDiskPath(dir, prevPath); prev != "" {
		_ = os.Remove(prev)
	}

	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (s *Server) handleServeAvatar(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.PathValue("file"))
	if name == "." || name == "/" || strings.ContainsAny(name, `/\`) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	path := filepath.Join(s.avatarsDir(), name)
	f, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	// Public rather than private: the route is now unauthenticated, and a
	// shared cache holding an avatar is harmless.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// avatarDiskPath maps a stored avatar public URL back to a safe on-disk path
// inside dir, or "" if it is not a managed avatar URL.
func avatarDiskPath(dir, publicURL string) string {
	if !strings.HasPrefix(publicURL, avatarURLPrefix) {
		return ""
	}
	name := filepath.Base(strings.TrimPrefix(publicURL, avatarURLPrefix))
	if name == "." || name == "/" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	return filepath.Join(dir, name)
}

// --- Account deletion ---

func (s *Server) handleRequestAccountDeletion(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)

	mailer, err := s.mailer(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load email settings")
		return
	}
	if !mailer.Configured() {
		writeError(w, http.StatusServiceUnavailable, "email is not configured; contact your administrator")
		return
	}

	code, email, err := s.auth.RequestAccountDeletion(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	body := fmt.Sprintf("Hello %s,\n\nUse this code to confirm deletion of your Activity Lens account:\n\n    %s\n\nThe code expires in 15 minutes. If you did not request this, you can ignore this email.\n",
		firstNonEmpty(user.DisplayName, user.Username), code)

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := mailer.Send(ctx, email, deletionEmailSubj, body); err != nil {
		slog.Error("send deletion code", "error", err, "user", user.ID)
		writeError(w, http.StatusBadGateway, "could not send confirmation email")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "sent", "email": maskEmail(email)})
}

func (s *Server) handleConfirmAccountDeletion(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.auth.DeleteOwnAccount(r.Context(), user.ID, req.Code); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.purgeUserShares(r, user.ID)
	// The account (and its sessions) are gone; clear cookies.
	secure := s.secure(r)
	http.SetCookie(w, s.auth.ClearSessionCookie(secure))
	http.SetCookie(w, s.mw.ClearCSRFCookie(r))
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// maskEmail obscures the local part of an email for display, e.g. j***@x.com.
func maskEmail(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return email
	}
	local, domain := email[:at], email[at:]
	if len(local) <= 1 {
		return local + "***" + domain
	}
	return string(local[0]) + "***" + domain
}
