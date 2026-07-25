// Package settings stores admin-editable configuration (SMTP, OIDC) in the
// database and resolves the effective values by layering environment-variable
// overrides on top. Any value provided via an AL_* environment variable wins
// over the database value and is reported as read-only to the admin UI.
package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	keySMTP    = "smtp"
	keyOIDC    = "oidc"
	keyStorage = "storage"
)

// SMTP holds outbound email settings.
type SMTP struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	From       string `json:"from"`
	FromName   string `json:"fromName"`
	Encryption string `json:"encryption"` // none, starttls, tls
}

// OIDC holds single sign-on settings.
type OIDC struct {
	Enabled           bool     `json:"enabled"`
	IssuerURL         string   `json:"issuerUrl"`
	ClientID          string   `json:"clientId"`
	ClientSecret      string   `json:"clientSecret"`
	RedirectURL       string   `json:"redirectUrl"`
	AdminGroup        string   `json:"adminGroup"`
	ProviderName      string   `json:"providerName"`
	AllowRegistration bool     `json:"allowRegistration"`
	Scopes            []string `json:"scopes"`
}

// Storage holds data-retention preferences for imported activity files.
type Storage struct {
	// KeepOriginalUploads, when true, retains the original GPX/TCX file
	// bytes alongside the parsed workout so a future, improved import
	// pipeline can reprocess history without asking users to re-upload.
	// Trades additional database size for that flexibility.
	KeepOriginalUploads bool    `json:"keepOriginalUploads"`
	CalorieMethod       string  `json:"calorieMethod"`
	BodyWeightKg        float64 `json:"bodyWeightKg"`
}

// Store persists settings and per-user last-login timestamps.
type Store struct {
	db *sql.DB
}

// New returns a Store backed by db.
func New(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) get(ctx context.Context, key string, v any) (bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal([]byte(raw), v); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) set(ctx context.Context, key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, string(raw), time.Now().UTC().Format(time.RFC3339))
	return err
}

// StoredSMTP returns the raw SMTP settings saved in the database.
func (s *Store) StoredSMTP(ctx context.Context) (SMTP, error) {
	v := SMTP{Port: 587, Encryption: "starttls", FromName: "Activity Lens"}
	if _, err := s.get(ctx, keySMTP, &v); err != nil {
		return SMTP{}, err
	}
	return v, nil
}

// SaveSMTP persists SMTP settings.
func (s *Store) SaveSMTP(ctx context.Context, v SMTP) error {
	return s.set(ctx, keySMTP, v)
}

// StoredOIDC returns the raw OIDC settings saved in the database.
func (s *Store) StoredOIDC(ctx context.Context) (OIDC, error) {
	v := OIDC{ProviderName: "SSO", AllowRegistration: true}
	if _, err := s.get(ctx, keyOIDC, &v); err != nil {
		return OIDC{}, err
	}
	return v, nil
}

// SaveOIDC persists OIDC settings.
func (s *Store) SaveOIDC(ctx context.Context, v OIDC) error {
	return s.set(ctx, keyOIDC, v)
}

// StoredStorage returns the raw storage settings saved in the database.
func (s *Store) StoredStorage(ctx context.Context) (Storage, error) {
	v := Storage{CalorieMethod: "heart-rate", BodyWeightKg: 70}
	if _, err := s.get(ctx, keyStorage, &v); err != nil {
		return Storage{}, err
	}
	return v, nil
}

// SaveStorage persists storage settings.
func (s *Store) SaveStorage(ctx context.Context, v Storage) error {
	return s.set(ctx, keyStorage, v)
}

// RecordLogin stores the last-login timestamp for a user.
func (s *Store) RecordLogin(ctx context.Context, userID int64, at time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_last_login (user_id, last_login_at) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET last_login_at = excluded.last_login_at`,
		userID, at.UTC().Format(time.RFC3339))
	return err
}

// LastLogins returns a map of user id to last-login timestamp (RFC3339).
func (s *Store) LastLogins(ctx context.Context) (map[int64]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT user_id, last_login_at FROM user_last_login`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]string)
	for rows.Next() {
		var id int64
		var ts string
		if err := rows.Scan(&id, &ts); err != nil {
			return nil, err
		}
		out[id] = ts
	}
	return out, rows.Err()
}

// --- Effective (env-overridden) resolution ---

// SMTPFields maps each SMTP field name to whether an env var overrides it.
type SMTPFields map[string]bool

// OIDCFields maps each OIDC field name to whether an env var overrides it.
type OIDCFields map[string]bool

// EffectiveSMTP layers env overrides on top of the stored settings and reports
// which fields are env-controlled.
func (s *Store) EffectiveSMTP(ctx context.Context) (SMTP, SMTPFields, error) {
	v, err := s.StoredSMTP(ctx)
	if err != nil {
		return SMTP{}, nil, err
	}
	ov := SMTPFields{}
	if s, ok := lookup("AL_SMTP_HOST"); ok {
		v.Host = s
		ov["host"] = true
	}
	if s, ok := lookup("AL_SMTP_PORT"); ok {
		if n, err := strconv.Atoi(s); err == nil {
			v.Port = n
		}
		ov["port"] = true
	}
	if s, ok := lookup("AL_SMTP_USERNAME"); ok {
		v.Username = s
		ov["username"] = true
	}
	if s, ok := lookup("AL_SMTP_PASSWORD"); ok {
		v.Password = s
		ov["password"] = true
	}
	if s, ok := lookup("AL_SMTP_FROM"); ok {
		v.From = s
		ov["from"] = true
	}
	if s, ok := lookup("AL_SMTP_FROM_NAME"); ok {
		v.FromName = s
		ov["fromName"] = true
	}
	if s, ok := lookup("AL_SMTP_ENCRYPTION"); ok {
		v.Encryption = s
		ov["encryption"] = true
	}
	return v, ov, nil
}

// EffectiveOIDC layers env overrides on top of the stored settings and reports
// which fields are env-controlled.
func (s *Store) EffectiveOIDC(ctx context.Context) (OIDC, OIDCFields, error) {
	v, err := s.StoredOIDC(ctx)
	if err != nil {
		return OIDC{}, nil, err
	}
	ov := OIDCFields{}
	if s, ok := lookup("AL_OIDC_ENABLED"); ok {
		v.Enabled, _ = strconv.ParseBool(s)
		ov["enabled"] = true
	}
	if s, ok := lookup("AL_OIDC_ISSUER_URL"); ok {
		v.IssuerURL = s
		ov["issuerUrl"] = true
	}
	if s, ok := lookup("AL_OIDC_CLIENT_ID"); ok {
		v.ClientID = s
		ov["clientId"] = true
	}
	if s, ok := lookup("AL_OIDC_CLIENT_SECRET"); ok {
		v.ClientSecret = s
		ov["clientSecret"] = true
	}
	if s, ok := lookup("AL_OIDC_REDIRECT_URL"); ok {
		v.RedirectURL = s
		ov["redirectUrl"] = true
	}
	if s, ok := lookup("AL_OIDC_ADMIN_GROUP"); ok {
		v.AdminGroup = s
		ov["adminGroup"] = true
	}
	if s, ok := lookup("AL_OIDC_PROVIDER_NAME"); ok {
		v.ProviderName = s
		ov["providerName"] = true
	}
	if s, ok := lookup("AL_OIDC_ALLOW_REGISTRATION"); ok {
		v.AllowRegistration, _ = strconv.ParseBool(s)
		ov["allowRegistration"] = true
	}
	if s, ok := lookup("AL_OIDC_SCOPES"); ok {
		v.Scopes = splitNonEmpty(s)
		ov["scopes"] = true
	}
	return v, ov, nil
}

func lookup(key string) (string, bool) {
	v, ok := os.LookupEnv(key)
	v = strings.TrimSpace(v)
	if !ok || v == "" {
		return "", false
	}
	return v, true
}

func splitNonEmpty(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
