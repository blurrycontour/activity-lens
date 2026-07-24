package settings

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:settings_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
	                  CREATE TABLE user_last_login (user_id INTEGER PRIMARY KEY, last_login_at TEXT NOT NULL);`)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return New(db)
}

func TestEffectiveSMTPEnvOverridesDB(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	if err := st.SaveSMTP(ctx, SMTP{Host: "db-host", Port: 25, From: "db@example.com", Encryption: "none"}); err != nil {
		t.Fatalf("save: %v", err)
	}

	t.Setenv("AL_SMTP_HOST", "env-host")
	t.Setenv("AL_SMTP_PORT", "587")

	v, ov, err := st.EffectiveSMTP(ctx)
	if err != nil {
		t.Fatalf("effective: %v", err)
	}
	if v.Host != "env-host" {
		t.Errorf("host = %q, want env-host", v.Host)
	}
	if v.Port != 587 {
		t.Errorf("port = %d, want 587", v.Port)
	}
	// Non-overridden fields keep DB values.
	if v.From != "db@example.com" {
		t.Errorf("from = %q, want db@example.com", v.From)
	}
	if !ov["host"] || !ov["port"] {
		t.Errorf("expected host and port overridden, got %v", ov)
	}
	if ov["from"] {
		t.Errorf("from should not be overridden")
	}
}

func TestEffectiveOIDCNoEnvUsesDB(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	if err := st.SaveOIDC(ctx, OIDC{Enabled: true, IssuerURL: "https://id.example.com", ClientID: "abc", Scopes: []string{"openid", "email"}}); err != nil {
		t.Fatalf("save: %v", err)
	}

	v, ov, err := st.EffectiveOIDC(ctx)
	if err != nil {
		t.Fatalf("effective: %v", err)
	}
	if !v.Enabled || v.IssuerURL != "https://id.example.com" || v.ClientID != "abc" {
		t.Errorf("unexpected effective oidc: %+v", v)
	}
	if len(v.Scopes) != 2 {
		t.Errorf("scopes = %v, want 2", v.Scopes)
	}
	if len(ov) != 0 {
		t.Errorf("expected no overrides, got %v", ov)
	}
}

func TestRecordAndListLastLogins(t *testing.T) {
	st := newTestStore(t)
	ctx := context.Background()

	if err := st.RecordLogin(ctx, 7, time.Now()); err != nil {
		t.Fatalf("record: %v", err)
	}
	m, err := st.LastLogins(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if _, ok := m[7]; !ok {
		t.Errorf("expected last login for user 7, got %v", m)
	}
}
