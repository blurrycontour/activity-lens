package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"

	"github.com/blurrycontour/go-authkit/auth"
	"github.com/blurrycontour/go-authkit/httpmw"
)

// --- Settings ---

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	smtp, smtpOv, err := s.settings.EffectiveSMTP(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	oidc, oidcOv, err := s.settings.EffectiveOIDC(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	storage, err := s.settings.StoredStorage(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	social, err := s.settings.StoredSocial(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"smtp": map[string]any{
			"host":        smtp.Host,
			"port":        smtp.Port,
			"username":    smtp.Username,
			"passwordSet": smtp.Password != "",
			"from":        smtp.From,
			"fromName":    smtp.FromName,
			"encryption":  smtp.Encryption,
			"overridden":  smtpOv,
		},
		"oidc": map[string]any{
			"enabled":           oidc.Enabled,
			"issuerUrl":         oidc.IssuerURL,
			"clientId":          oidc.ClientID,
			"clientSecretSet":   oidc.ClientSecret != "",
			"redirectUrl":       oidc.RedirectURL,
			"adminGroup":        oidc.AdminGroup,
			"providerName":      oidc.ProviderName,
			"logoUrl":           oidc.LogoURL,
			"logoUrlDark":       oidc.LogoURLDark,
			"allowRegistration": oidc.AllowRegistration,
			"scopes":            oidc.Scopes,
			"overridden":        oidcOv,
		},
		"storage": map[string]any{
			"keepOriginalUploads": storage.KeepOriginalUploads,
		},
		"social": map[string]any{
			"pingCooldownSeconds": social.PingCooldownSeconds,
		},
	})
}

// handleSaveSocial sets how often one member may ping another.
func (s *Server) handleSaveSocial(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PingCooldownSeconds int `json:"pingCooldownSeconds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Refused rather than clamped at either end. Zero would read as "no limit"
	// to whoever typed it and mean "the default" to the store, and a cooldown
	// of a week is the feature switched off by an admin for everyone — which is
	// what each person's own notification switch is for.
	if req.PingCooldownSeconds < 1 || req.PingCooldownSeconds > settings.MaxPingCooldown {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("a ping cooldown must be between 1 and %d seconds", settings.MaxPingCooldown))
		return
	}
	if err := s.settings.SaveSocial(r.Context(), settings.Social{PingCooldownSeconds: req.PingCooldownSeconds}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleSaveSMTP(w http.ResponseWriter, r *http.Request) {
	stored, err := s.settings.StoredSMTP(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	_, ov, err := s.settings.EffectiveSMTP(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}

	var req struct {
		Host       string `json:"host"`
		Port       int    `json:"port"`
		Username   string `json:"username"`
		Password   string `json:"password"`
		From       string `json:"from"`
		FromName   string `json:"fromName"`
		Encryption string `json:"encryption"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	out := stored
	if !ov["host"] {
		out.Host = strings.TrimSpace(req.Host)
	}
	if !ov["port"] {
		out.Port = req.Port
	}
	if !ov["username"] {
		out.Username = req.Username
	}
	if !ov["password"] && req.Password != "" {
		out.Password = req.Password // empty means keep existing
	}
	if !ov["from"] {
		out.From = strings.TrimSpace(req.From)
	}
	if !ov["fromName"] {
		out.FromName = strings.TrimSpace(req.FromName)
	}
	if !ov["encryption"] {
		out.Encryption = normalizeEncryption(req.Encryption)
	}

	if err := s.settings.SaveSMTP(r.Context(), out); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleSaveOIDC(w http.ResponseWriter, r *http.Request) {
	stored, err := s.settings.StoredOIDC(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	_, ov, err := s.settings.EffectiveOIDC(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}

	var req struct {
		Enabled           bool     `json:"enabled"`
		IssuerURL         string   `json:"issuerUrl"`
		ClientID          string   `json:"clientId"`
		ClientSecret      string   `json:"clientSecret"`
		RedirectURL       string   `json:"redirectUrl"`
		AdminGroup        string   `json:"adminGroup"`
		ProviderName      string   `json:"providerName"`
		LogoURL           string   `json:"logoUrl"`
		LogoURLDark       string   `json:"logoUrlDark"`
		AllowRegistration bool     `json:"allowRegistration"`
		Scopes            []string `json:"scopes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	out := stored
	if !ov["enabled"] {
		out.Enabled = req.Enabled
	}
	if !ov["issuerUrl"] {
		out.IssuerURL = strings.TrimSpace(req.IssuerURL)
	}
	if !ov["clientId"] {
		out.ClientID = strings.TrimSpace(req.ClientID)
	}
	if !ov["clientSecret"] && req.ClientSecret != "" {
		out.ClientSecret = req.ClientSecret // empty means keep existing
	}
	if !ov["redirectUrl"] {
		out.RedirectURL = strings.TrimSpace(req.RedirectURL)
	}
	if !ov["adminGroup"] {
		out.AdminGroup = strings.TrimSpace(req.AdminGroup)
	}
	if !ov["providerName"] {
		out.ProviderName = strings.TrimSpace(req.ProviderName)
	}
	if !ov["logoUrl"] {
		out.LogoURL = strings.TrimSpace(req.LogoURL)
	}
	if !ov["logoUrlDark"] {
		out.LogoURLDark = strings.TrimSpace(req.LogoURLDark)
	}
	if !ov["allowRegistration"] {
		out.AllowRegistration = req.AllowRegistration
	}
	if !ov["scopes"] {
		out.Scopes = req.Scopes
	}

	if err := s.settings.SaveOIDC(r.Context(), out); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleSaveStorage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KeepOriginalUploads bool `json:"keepOriginalUploads"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.settings.SaveStorage(r.Context(), settings.Storage{KeepOriginalUploads: req.KeepOriginalUploads}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleTestEmail(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		To string `json:"to"`
	}
	// Body is optional; ignore decode errors for an empty body.
	_ = decodeJSON(r, &req)

	to := strings.TrimSpace(req.To)
	if to == "" {
		to = user.Email
	}
	if to == "" {
		writeError(w, http.StatusBadRequest, "no recipient address")
		return
	}

	mailer, err := s.mailer(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load email settings")
		return
	}
	if !mailer.Configured() {
		writeError(w, http.StatusBadRequest, "SMTP is not configured; save settings first")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	body := "This is a test email from Activity Lens. If you received it, your SMTP settings are working.\n"
	if err := mailer.Send(ctx, to, "Activity Lens SMTP test", body); err != nil {
		writeError(w, http.StatusBadGateway, "send failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "to": to})
}

// --- User management ---

type adminUser struct {
	auth.User
	LastLoginAt string `json:"lastLoginAt"`
	LastSeen    string `json:"lastSeen,omitempty"`
	// Sessions is how many devices this account is signed in on, so the list
	// can show it without every row carrying the devices themselves.
	Sessions int `json:"sessions"`
	// Stats is absent when the totals could not be computed, which the UI shows
	// as "unknown" rather than as zero workouts.
	Stats *UserStats `json:"stats,omitempty"`
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	last, err := s.settings.LastLogins(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load login history")
		return
	}
	// Sessions and totals for everyone, in two passes over the whole set
	// rather than a pair of queries per user — this list shows every account.
	var stats map[int64]*UserStats
	if s.adminStats != nil {
		var err error
		if stats, err = s.adminStats.All(r.Context()); err != nil {
			slog.Warn("could not load user stats", "error", err)
			stats = nil
		}
	}
	counts, err := s.sessionCounts(r.Context(), users)
	if err != nil {
		slog.Warn("could not count sessions", "error", err)
	}
	ids := make([]int64, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	seen := map[int64]string{}
	if s.sessionClients != nil {
		if seen, err = s.sessionClients.LastSeenFor(r.Context(), ids); err != nil {
			slog.Warn("could not load last seen", "error", err)
			seen = map[int64]string{}
		}
	}
	out := make([]adminUser, 0, len(users))
	for _, u := range users {
		row := adminUser{User: u, LastLoginAt: last[u.ID], LastSeen: seen[u.ID], Sessions: counts[u.ID]}
		if stats != nil {
			// A user with no workouts has no row in any of those grouped
			// queries, which is not the same as the totals being unavailable —
			// so they get an explicit zero. Nil is reserved for "we could not
			// work it out", which is what the UI renders as unknown.
			if got, ok := stats[u.ID]; ok {
				row.Stats = got
			} else {
				row.Stats = &UserStats{}
			}
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		Email       string `json:"email"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
		Role        string `json:"role"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}
	user, err := s.auth.AdminCreateUser(r.Context(), req.Username, req.Email, req.DisplayName, req.Password, req.Role)
	if err != nil {
		if errors.Is(err, auth.ErrConflict) {
			writeError(w, http.StatusConflict, "username or email already taken")
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	caller := httpmw.UserFrom(r)
	targetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var req struct {
		Role     string `json:"role"`
		IsActive bool   `json:"isActive"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validRole(req.Role) {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}
	if caller.ID == targetID && !req.IsActive {
		writeError(w, http.StatusBadRequest, "cannot deactivate your own account")
		return
	}
	// Losing the last administrator locks everyone out of user management, SSO
	// and email settings with no way back in short of editing the database by
	// hand. Checked on every change rather than only on the ones that look
	// dangerous: "administrator + active" being harmless is true but is one more
	// thing to keep in step, and this is a rare, human-initiated request.
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if activeAdminsAfter(users, targetID, req.Role, req.IsActive) == 0 {
		writeError(w, http.StatusBadRequest, "cannot remove the last administrator account")
		return
	}
	user, err := s.auth.AdminUpdateUser(r.Context(), caller.ID, targetID, req.Role, req.IsActive)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	caller := httpmw.UserFrom(r)
	targetID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if caller.ID == targetID {
		writeError(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}
	// Read before the delete: the purge needs the avatar path, and once the
	// account is gone there is no way to find out what it was.
	target := auth.User{ID: targetID}
	if users, err := s.auth.ListUsers(r.Context()); err == nil {
		for _, u := range users {
			if u.ID == targetID {
				target = u
				break
			}
		}
	}
	if err := s.auth.AdminDeleteUser(r.Context(), caller.ID, targetID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.purgeUserData(r.Context(), target)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// activeAdminsAfter counts how many active administrators would remain if
// targetID were changed to the given role and active flag.
//
// Written as "count the world afterwards" rather than as a set of rules about
// which edits are dangerous. Demotion, deactivation and both at once then fall
// out of one expression, and so does the case that rules tend to miss: an edit
// is only unsafe relative to who else is left, so the same demotion is fine
// with two administrators and fatal with one.
//
// A targetID that matches nobody simply leaves the tally untouched, which is the
// right answer for an account deleted out from under the request.
func activeAdminsAfter(users []auth.User, targetID int64, role string, isActive bool) int {
	n := 0
	for _, u := range users {
		admin, active := u.Role == auth.RoleAdministrator, u.IsActive
		if u.ID == targetID {
			admin, active = role == auth.RoleAdministrator, isActive
		}
		if admin && active {
			n++
		}
	}
	return n
}

func validRole(role string) bool {
	switch role {
	case auth.RoleAdministrator, auth.RoleEditor, auth.RoleReader:
		return true
	default:
		return false
	}
}

func normalizeEncryption(enc string) string {
	switch strings.ToLower(strings.TrimSpace(enc)) {
	case "tls", "ssl":
		return "tls"
	case "none":
		return "none"
	default:
		return "starttls"
	}
}
