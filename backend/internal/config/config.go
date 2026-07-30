// Package config loads runtime configuration from environment variables. All
// settings have sensible defaults so the server boots with zero configuration
// in development.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-resolved server configuration.
type Config struct {
	Addr    string // listen address, e.g. ":8080"
	DataDir string // directory for the database and uploaded files
	// CORSOrigins are extra origins allowed to call the API cross-origin, on
	// top of the built-in native app origins. Only needed when the web app is
	// served from a different host than the API.
	CORSOrigins []string

	// Database
	DatabaseURL string // when set, overrides the default sqlite path (kept for future Postgres support)

	// Bootstrap admin (created on first run if it does not exist)
	AdminUser   string
	AdminEmail  string
	AdminPass   string
	PushSubject string

	// Session
	SessionTTL    time.Duration
	CookieName    string
	SecureCookies bool // force Secure cookie flag (otherwise derived per-request)

	// Self-service registration via password
	AllowRegistration bool

	// AndroidApp enables the "Get the Android app" download on the login page
	// and the in-app update check. Turn it off for a deployment that cannot
	// reach GitHub, or that would rather not disclose its version to anonymous
	// callers.
	AndroidApp bool

	// AndroidAPKDir is where the bundled APK and its apk.json live. Set by the
	// Dockerfile; empty for a plain `go build`, which simply has no app to
	// offer.
	AndroidAPKDir string

	// OIDC
	OIDC OIDCConfig

	// SMTP (transactional email)
	SMTP SMTPConfig
}

// SMTPConfig holds outbound email settings.
type SMTPConfig struct {
	Host       string
	Port       int
	Username   string
	Password   string
	From       string
	FromName   string
	Encryption string // "none", "starttls", or "tls"
}

// OIDCConfig holds the optional OpenID Connect settings.
type OIDCConfig struct {
	Enabled           bool
	IssuerURL         string
	ClientID          string
	ClientSecret      string
	RedirectURL       string
	AdminGroup        string
	ProviderName      string
	AllowRegistration bool
	Scopes            []string
}

// Load reads configuration from the environment, applying defaults.
func Load() (Config, error) {
	c := Config{
		Addr:        env("AL_ADDR", ":8080"),
		DataDir:     env("AL_DATA_DIR", "./.data"),
		CORSOrigins: parseList(os.Getenv("AL_CORS_ORIGINS")),
		DatabaseURL: os.Getenv("AL_DATABASE_URL"),
		AdminUser:   os.Getenv("AL_ADMIN_USER"),
		AdminEmail:  os.Getenv("AL_ADMIN_EMAIL"),
		AdminPass:   os.Getenv("AL_ADMIN_PASS"),
		// Contact address embedded in Web Push messages, required by the spec
		// so a push service has someone to reach about abuse.
		PushSubject:       env("AL_PUSH_SUBJECT", "mailto:admin@localhost"),
		CookieName:        env("AL_COOKIE_NAME", "al_session"),
		SecureCookies:     boolEnv("AL_SECURE_COOKIES", false),
		AllowRegistration: boolEnv("AL_ALLOW_REGISTRATION", false),
		AndroidApp:        boolEnv("AL_ANDROID_APP", true),
		AndroidAPKDir:     os.Getenv("AL_ANDROID_APK_DIR"),
		OIDC: OIDCConfig{
			Enabled:           boolEnv("AL_OIDC_ENABLED", false),
			IssuerURL:         os.Getenv("AL_OIDC_ISSUER_URL"),
			ClientID:          os.Getenv("AL_OIDC_CLIENT_ID"),
			ClientSecret:      os.Getenv("AL_OIDC_CLIENT_SECRET"),
			RedirectURL:       os.Getenv("AL_OIDC_REDIRECT_URL"),
			AdminGroup:        os.Getenv("AL_OIDC_ADMIN_GROUP"),
			ProviderName:      env("AL_OIDC_PROVIDER_NAME", "SSO"),
			AllowRegistration: boolEnv("AL_OIDC_ALLOW_REGISTRATION", true),
			Scopes:            splitNonEmpty(os.Getenv("AL_OIDC_SCOPES")),
		},
	}

	ttl, err := durationEnv("AL_SESSION_TTL", 30*24*time.Hour)
	if err != nil {
		return Config{}, fmt.Errorf("AL_SESSION_TTL: %w", err)
	}
	c.SessionTTL = ttl

	c.SMTP = SMTPConfig{
		Host:       os.Getenv("AL_SMTP_HOST"),
		Port:       intEnv("AL_SMTP_PORT", 587),
		Username:   os.Getenv("AL_SMTP_USERNAME"),
		Password:   os.Getenv("AL_SMTP_PASSWORD"),
		From:       os.Getenv("AL_SMTP_FROM"),
		FromName:   env("AL_SMTP_FROM_NAME", "Activity Lens"),
		Encryption: env("AL_SMTP_ENCRYPTION", "starttls"),
	}

	return c, nil
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// parseList splits a comma-separated environment value, dropping blanks and
// any trailing slash — an Origin header never carries one, so a configured
// "https://app.example.com/" would otherwise silently never match.
func parseList(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		if v := strings.TrimRight(strings.TrimSpace(part), "/"); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func intEnv(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func boolEnv(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func durationEnv(key string, def time.Duration) (time.Duration, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def, nil
	}
	return time.ParseDuration(v)
}

func splitNonEmpty(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
