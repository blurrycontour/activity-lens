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
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	keySMTP    = "smtp"
	keyOIDC    = "oidc"
	keyStorage = "storage"
	keyVAPID   = "vapid"
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
	LogoURL           string   `json:"logoUrl"`
	AllowRegistration bool     `json:"allowRegistration"`
	Scopes            []string `json:"scopes"`
}

// Storage holds data-retention preferences for imported activity files.
type Storage struct {
	// KeepOriginalUploads, when true, retains the original GPX/TCX file
	// bytes alongside the parsed workout so a future, improved import
	// pipeline can reprocess history without asking users to re-upload.
	// Trades additional database size for that flexibility.
	KeepOriginalUploads bool `json:"keepOriginalUploads"`
}

// UserPrefs holds per-user preferences that influence how activity metrics
// (calorie estimates, heart-rate zones) are computed and displayed.
type UserPrefs struct {
	CalorieMethod string  `json:"calorieMethod"`
	BodyWeightKg  float64 `json:"bodyWeightKg"`
	Sex           string  `json:"sex"`
	BirthYear     int     `json:"birthYear"`
	HeightCm      int     `json:"heightCm"`
	MaxHR         int     `json:"maxHr"`
	RestingHR     int     `json:"restingHr"`
	ThresholdPace string  `json:"thresholdPace"`
	FTP           int     `json:"ftp"`
	StepLengthCm  int     `json:"stepLengthCm"`
	// Goals the dashboard tracks, e.g. two 5 km runs a week plus two hikes a
	// month. Empty means the user has not set any.
	Goals []Goal `json:"goals"`
	// Notify holds the per-kind notification switches. Stored as opaque JSON
	// so the settings package does not have to know what kinds exist.
	Notify json.RawMessage `json:"notify,omitempty"`
}

// VAPID is the Web Push keypair identifying this server to browser push
// services. It is generated once on first run and kept for the lifetime of the
// deployment: regenerating it invalidates every existing subscription.
type VAPID struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

// VAPIDKeys returns the stored keypair, generating and persisting one the first
// time it is asked for. Doing this here rather than through configuration means
// push works on a fresh self-hosted install with nothing to set up.
func (s *Store) VAPIDKeys(ctx context.Context, generate func() (private, public string, err error)) (VAPID, error) {
	var v VAPID
	found, err := s.get(ctx, keyVAPID, &v)
	if err != nil {
		return VAPID{}, err
	}
	if found && v.Public != "" && v.Private != "" {
		return v, nil
	}
	priv, pub, err := generate()
	if err != nil {
		return VAPID{}, err
	}
	v = VAPID{Public: pub, Private: priv}
	if err := s.set(ctx, keyVAPID, v); err != nil {
		return VAPID{}, err
	}
	return v, nil
}

// Goal is one training target: `Count` qualifying activities per `Period`.
type Goal struct {
	// ID is client-generated and only needs to be unique within a user's list;
	// it exists so the settings editor can key rows across edits.
	ID     string  `json:"id"`
	Count  int     `json:"count"`
	Period string  `json:"period"` // "week" or "month"
	Type   string  `json:"type"`   // activity type, or "" for any
	MinKm  float64 `json:"minKm"`  // minimum distance to qualify; 0 for none
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
	v := Storage{}
	if _, err := s.get(ctx, keyStorage, &v); err != nil {
		return Storage{}, err
	}
	return v, nil
}

// SaveStorage persists storage settings.
func (s *Store) SaveStorage(ctx context.Context, v Storage) error {
	return s.set(ctx, keyStorage, v)
}

// UserPreferences returns the calorie-estimation preferences for a user,
// falling back to sensible defaults when the user has never saved any.
func (s *Store) UserPreferences(ctx context.Context, userID int64) (UserPrefs, error) {
	v := UserPrefs{CalorieMethod: "heart-rate", BodyWeightKg: 70, Goals: []Goal{}}
	var (
		goalsJSON   string
		notifyJSON  string
		legacyCount int
		legacyType  string
		legacyMinKm float64
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT calorie_method, body_weight_kg, sex, birth_year, height_cm, max_hr, resting_hr, threshold_pace, ftp, step_length_cm,
		        goals, notify_prefs, weekly_goal_count, weekly_goal_type, weekly_goal_min_km FROM user_prefs WHERE user_id = ?`, userID).
		Scan(&v.CalorieMethod, &v.BodyWeightKg, &v.Sex, &v.BirthYear, &v.HeightCm, &v.MaxHR, &v.RestingHR, &v.ThresholdPace, &v.FTP, &v.StepLengthCm,
			&goalsJSON, &notifyJSON, &legacyCount, &legacyType, &legacyMinKm)
	if errors.Is(err, sql.ErrNoRows) {
		return v, nil
	}
	if err != nil {
		return UserPrefs{}, err
	}
	if goalsJSON != "" {
		if err := json.Unmarshal([]byte(goalsJSON), &v.Goals); err != nil {
			return UserPrefs{}, fmt.Errorf("parse goals: %w", err)
		}
	} else if legacyCount > 0 {
		// Seed from the single weekly goal this user set before goals became a
		// list. Their next save writes it back as JSON and this stops firing.
		v.Goals = []Goal{{ID: "legacy", Count: legacyCount, Period: "week", Type: legacyType, MinKm: legacyMinKm}}
	}
	if v.Goals == nil {
		v.Goals = []Goal{}
	}
	if notifyJSON != "" {
		v.Notify = json.RawMessage(notifyJSON)
	}
	return v, nil
}

// SaveUserPreferences persists a user's calorie-estimation preferences.
func (s *Store) SaveUserPreferences(ctx context.Context, userID int64, v UserPrefs) error {
	if v.Goals == nil {
		v.Goals = []Goal{}
	}
	goalsJSON, err := json.Marshal(v.Goals)
	if err != nil {
		return fmt.Errorf("encode goals: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO user_prefs (user_id, calorie_method, body_weight_kg, sex, birth_year, height_cm, max_hr, resting_hr, threshold_pace, ftp, step_length_cm,
		                         goals, notify_prefs, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   calorie_method = excluded.calorie_method,
		   body_weight_kg = excluded.body_weight_kg,
		   sex = excluded.sex,
		   birth_year = excluded.birth_year,
		   height_cm = excluded.height_cm,
		   max_hr = excluded.max_hr,
		   resting_hr = excluded.resting_hr,
		   threshold_pace = excluded.threshold_pace,
		   ftp = excluded.ftp,
		   step_length_cm = excluded.step_length_cm,
		   goals = excluded.goals,
		   notify_prefs = excluded.notify_prefs,
		   updated_at = excluded.updated_at`,
		userID, v.CalorieMethod, v.BodyWeightKg, v.Sex, v.BirthYear, v.HeightCm, v.MaxHR, v.RestingHR, v.ThresholdPace, v.FTP, v.StepLengthCm,
		string(goalsJSON), string(v.Notify), time.Now().UTC().Format(time.RFC3339))
	return err
}

// RecordLogin stores the last-login timestamp for a user.
func (s *Store) RecordLogin(ctx context.Context, userID int64, at time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_last_login (user_id, last_login_at) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET last_login_at = excluded.last_login_at`,
		userID, at.UTC().Format(time.RFC3339))
	return err
}

// PurgeUser removes the per-user rows this store owns, for account deletion.
// Both tables are keyed by a user id that go-authkit does not know about, so
// nothing else would ever clear them.
func (s *Store) PurgeUser(ctx context.Context, userID int64) error {
	for _, q := range []string{
		`DELETE FROM user_prefs WHERE user_id = ?`,
		`DELETE FROM user_last_login WHERE user_id = ?`,
	} {
		if _, err := s.db.ExecContext(ctx, q, userID); err != nil {
			return fmt.Errorf("delete user settings: %w", err)
		}
	}
	return nil
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
	if s, ok := lookup("AL_OIDC_LOGO_URL"); ok {
		v.LogoURL = s
		ov["logoUrl"] = true
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
