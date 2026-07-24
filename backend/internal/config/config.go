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

	// Database
	DatabaseURL string // when set, overrides the default sqlite path (kept for future Postgres support)

	// Bootstrap admin (created on first run if it does not exist)
	AdminUser  string
	AdminEmail string
	AdminPass  string

	// Session
	SessionTTL    time.Duration
	CookieName    string
	SecureCookies bool // force Secure cookie flag (otherwise derived per-request)

	// Self-service registration via password
	AllowRegistration bool

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
		Addr:              env("AL_ADDR", ":8080"),
		DataDir:           env("AL_DATA_DIR", "./.data"),
		DatabaseURL:       os.Getenv("AL_DATABASE_URL"),
		AdminUser:         os.Getenv("AL_ADMIN_USER"),
		AdminEmail:        os.Getenv("AL_ADMIN_EMAIL"),
		AdminPass:         os.Getenv("AL_ADMIN_PASS"),
		CookieName:        env("AL_COOKIE_NAME", "al_session"),
		SecureCookies:     boolEnv("AL_SECURE_COOKIES", false),
		AllowRegistration: boolEnv("AL_ALLOW_REGISTRATION", false),
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
