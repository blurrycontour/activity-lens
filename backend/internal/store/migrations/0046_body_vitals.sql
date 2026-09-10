-- Body Vitals: manually recorded weight and blood-pressure measurements kept
-- over time, plus a desired body-weight target on the user's preferences.
--
-- One row is one measurement event. A weight entry fills weight_kg; a
-- blood-pressure entry fills systolic/diastolic/pulse. Nullable columns rather
-- than a type discriminator keep the charts a simple "where column is not null"
-- and leave room for a reading that carries both.
ALTER TABLE user_prefs ADD COLUMN target_weight_kg REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS body_vitals (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    measured_at TEXT NOT NULL,
    weight_kg   REAL,
    systolic    INTEGER,
    diastolic   INTEGER,
    pulse       INTEGER,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_body_vitals_user_time ON body_vitals (user_id, measured_at);
