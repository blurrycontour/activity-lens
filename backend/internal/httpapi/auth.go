package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/blurrycontour/go-authkit/auth"
	"github.com/blurrycontour/go-authkit/httpmw"
	"github.com/blurrycontour/go-authkit/oidc"
)

// authResponse is returned by login/register/me: the user plus a CSRF token the
// SPA echoes in the X-CSRF-Token header on unsafe requests.
type authResponse struct {
	User      *auth.User `json:"user"`
	CSRFToken string     `json:"csrfToken"`
}

// handleAuthConfig exposes the auth features the frontend should render
// (registration availability, OIDC button + label). Public endpoint.
func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	oidcCfg, _, err := s.settings.EffectiveOIDC(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"allowRegistration": s.cfg.AllowRegistration,
		"oidcEnabled":       oidcCfg.Enabled,
		"oidcProviderName":  oidcCfg.ProviderName,
		"oidcLogoUrl":       oidcCfg.LogoURL,
		"oidcLogoUrlDark":   oidcCfg.LogoURLDark,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, sid, exp, err := s.auth.Login(r.Context(), req.Identifier, req.Password, r.UserAgent(), clientIP(r))
	if err != nil {
		// Failed sign-ins are the one thing worth reading these logs for, so
		// they are logged with the attempted identifier and source address.
		slog.Warn("login failed", "identifier", req.Identifier, "ip", clientIP(r), "error", err)
		s.writeLoginError(w, err)
		return
	}
	slog.Info("login", "user", user.Username, "user_id", user.ID, "ip", clientIP(r))
	s.startSession(w, r, user, sid, exp)
}

// handleIssueToken signs in and returns the session token in the body instead
// of setting a cookie, for the Android app.
//
// A separate endpoint rather than a flag on /login so the web path is unchanged
// and its token stays httpOnly: a session token in a JSON body is readable by
// script, which is exactly what the cookie flag exists to prevent. Only a client
// that has somewhere safer to put it should ask for it this way. The Android app
// keeps it in app-private storage (SharedPreferences, via @capacitor/preferences)
// with Android's own backup excluded, so it is readable only by this app on an
// unrooted device — better than localStorage in a browser, and short of hardware
// encryption. It is a session like any other, so the recovery for a lost device
// is the one that already exists: revoke it from Settings -> Sessions.
//
// What comes back is an ordinary session. It appears in Settings -> Sessions
// with the device's user agent, revoking it there signs the phone out, and it
// expires on the same schedule as any other (AL_SESSION_TTL).
func (s *Server) handleIssueToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, sid, exp, err := s.auth.Login(r.Context(), req.Identifier, req.Password, r.UserAgent(), clientIP(r))
	if err != nil {
		slog.Warn("token login failed", "identifier", req.Identifier, "ip", clientIP(r), "error", err)
		s.writeLoginError(w, err)
		return
	}
	if err := s.settings.RecordLogin(r.Context(), user.ID, time.Now()); err != nil {
		slog.Warn("record last login", "error", err, "user", user.ID)
	}
	slog.Info("login (token)", "user", user.Username, "user_id", user.ID, "ip", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     sid,
		"expiresAt": exp.UTC().Format(time.RFC3339),
		"user":      user,
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		Email       string `json:"email"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	user, err := s.auth.AdminCreateUser(r.Context(), req.Username, req.Email, req.DisplayName, req.Password, auth.RoleEditor)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrConflict):
			writeError(w, http.StatusConflict, "username or email already taken")
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	sid, exp, err := s.auth.LoginByUserID(r.Context(), user.ID, r.UserAgent(), clientIP(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not start session")
		return
	}
	s.startSession(w, r, user, sid, exp)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	// Reissue a fresh CSRF cookie so long-lived sessions always have a valid
	// token even after the shorter-lived CSRF cookie expires.
	csrf, err := s.mw.IssueCSRFCookie(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue csrf token")
		return
	}
	http.SetCookie(w, csrf)
	writeJSON(w, http.StatusOK, authResponse{User: user, CSRFToken: csrf.Value})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if sid := s.mw.SessionID(r); sid != "" {
		_ = s.auth.Logout(r.Context(), sid)
	}
	secure := s.secure(r)
	http.SetCookie(w, s.auth.ClearSessionCookie(secure))
	http.SetCookie(w, s.mw.ClearCSRFCookie(r))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.auth.UpdateProfile(r.Context(), user.ID, req.DisplayName, req.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updated})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.auth.ChangePassword(r.Context(), user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// startSession sets session + CSRF cookies and returns the user.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user *auth.User, sid string, exp time.Time) {
	if err := s.settings.RecordLogin(r.Context(), user.ID, time.Now()); err != nil {
		slog.Warn("record last login", "error", err, "user", user.ID)
	}
	secure := s.secure(r)
	http.SetCookie(w, s.auth.SessionCookie(sid, exp, secure))
	csrf, err := s.mw.IssueCSRFCookie(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue csrf token")
		return
	}
	http.SetCookie(w, csrf)
	writeJSON(w, http.StatusOK, authResponse{User: user, CSRFToken: csrf.Value})
}

func (s *Server) writeLoginError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInactive):
		writeError(w, http.StatusForbidden, "account is disabled")
	case errors.Is(err, auth.ErrPasswordLoginDisabled):
		writeError(w, http.StatusForbidden, "password login is not enabled for this account")
	default:
		writeError(w, http.StatusUnauthorized, "invalid credentials")
	}
}

// oidcConfig builds the effective OIDC config from database + environment
// settings (environment values take precedence).
func (s *Server) oidcConfig(ctx context.Context) (oidc.Config, error) {
	c, _, err := s.settings.EffectiveOIDC(ctx)
	if err != nil {
		return oidc.Config{}, err
	}
	return oidc.Config{
		Enabled:           c.Enabled,
		IssuerURL:         c.IssuerURL,
		ClientID:          c.ClientID,
		ClientSecret:      c.ClientSecret,
		RedirectURL:       c.RedirectURL,
		AdminGroup:        c.AdminGroup,
		ProviderName:      c.ProviderName,
		AllowRegistration: c.AllowRegistration,
		Scopes:            c.Scopes,
	}, nil
}

// oidcOnSuccess sets cookies after a successful OIDC login and redirects to the
// SPA root.
func (s *Server) oidcOnSuccess(w http.ResponseWriter, r *http.Request, user *auth.User, sid string, exp time.Time) {
	if user != nil {
		if err := s.settings.RecordLogin(r.Context(), user.ID, time.Now()); err != nil {
			slog.Warn("record last login", "error", err, "user", user.ID)
		}
	}
	secure := s.secure(r)
	http.SetCookie(w, s.auth.SessionCookie(sid, exp, secure))
	if csrf, err := s.mw.IssueCSRFCookie(r); err == nil {
		http.SetCookie(w, csrf)
	}
	http.Redirect(w, r, "/", http.StatusFound)
}
