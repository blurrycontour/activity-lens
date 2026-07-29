package settings

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

// The real migrations rather than a hand-written schema: user_prefs has grown
// columns across five migrations, and a local copy would drift out of step
// without failing anything.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
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

// Preferences and the last-login record are keyed by a user id that go-authkit
// does not know about, so deleting an account leaves both behind unless this
// runs. Neither is large, but a stale row here means a recycled user id would
// inherit a stranger's body weight, max HR and training goals.
func TestPurgeUserRemovesPreferencesAndLastLogin(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	const gone, kept int64 = 1, 2
	for _, id := range []int64{gone, kept} {
		if err := st.SaveUserPreferences(ctx, id, UserPrefs{MaxHR: 190, BodyWeightKg: 70}); err != nil {
			t.Fatalf("SaveUserPreferences(%d) error = %v", id, err)
		}
		if err := st.RecordLogin(ctx, id, time.Now()); err != nil {
			t.Fatalf("RecordLogin(%d) error = %v", id, err)
		}
	}

	if err := st.PurgeUser(ctx, gone); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}

	var rows int
	if err := st.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM user_prefs WHERE user_id = ?`, gone).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d preference rows survived the purge", rows)
	}

	logins, err := st.LastLogins(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := logins[gone]; ok {
		t.Error("the deleted user's last-login record survived")
	}
	if _, ok := logins[kept]; !ok {
		t.Error("purging one user removed another's last-login record")
	}

	// The other user's preferences must be exactly as they were.
	prefs, err := st.UserPreferences(ctx, kept)
	if err != nil {
		t.Fatal(err)
	}
	if prefs.MaxHR != 190 || prefs.BodyWeightKg != 70 {
		t.Errorf("purging one user disturbed another's preferences: %+v", prefs)
	}
}

// Account deletion calls this unconditionally, including for someone who never
// opened the settings page.
func TestPurgeUserWithNothingStored(t *testing.T) {
	if err := newTestStore(t).PurgeUser(context.Background(), 99); err != nil {
		t.Errorf("PurgeUser() with no rows: %v", err)
	}
}
