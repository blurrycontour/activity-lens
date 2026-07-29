package httpapi

import (
	"context"
	"errors"
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
	})
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
	out := make([]adminUser, 0, len(users))
	for _, u := range users {
		out = append(out, adminUser{User: u, LastLoginAt: last[u.ID]})
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
	if req.Role != auth.RoleAdministrator || !req.IsActive {
		users, err := s.auth.ListUsers(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not load users")
			return
		}
		activeAdmins := 0
		for _, u := range users {
			if u.Role == auth.RoleAdministrator && u.IsActive {
				activeAdmins++
			}
		}
		var target *auth.User
		for i := range users {
			if users[i].ID == targetID {
				target = &users[i]
				break
			}
		}
		if target != nil && target.Role == auth.RoleAdministrator && target.IsActive && activeAdmins <= 1 {
			writeError(w, http.StatusBadRequest, "cannot remove the last administrator account")
			return
		}
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
