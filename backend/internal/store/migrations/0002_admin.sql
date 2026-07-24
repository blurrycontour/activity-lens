-- Admin/settings schema for Activity Lens (Phase 3).

-- Key/value store for admin-editable settings (SMTP, OIDC). Values are JSON.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Last successful login per user. Kept separate from the go-authkit users
-- table so we don't modify its owned schema.
CREATE TABLE IF NOT EXISTS user_last_login (
    user_id       INTEGER PRIMARY KEY,
    last_login_at TEXT NOT NULL
);
