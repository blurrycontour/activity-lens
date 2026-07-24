-- Application schema for Activity Lens. Owned separately from the go-authkit
-- schema (which manages users/sessions). Written with portable SQL so a
-- Postgres backend can reuse most of it with minimal changes.

CREATE TABLE IF NOT EXISTS workouts (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL,
    name           TEXT    NOT NULL,
    type           TEXT    NOT NULL,
    start_time     TEXT    NOT NULL,            -- RFC3339 UTC
    duration       INTEGER NOT NULL DEFAULT 0,  -- seconds
    distance       REAL    NOT NULL DEFAULT 0,  -- meters
    avg_hr         INTEGER NOT NULL DEFAULT 0,
    max_hr         INTEGER NOT NULL DEFAULT 0,
    elevation_gain REAL    NOT NULL DEFAULT 0,  -- meters
    calories       INTEGER NOT NULL DEFAULT 0,
    avg_pace       REAL    NOT NULL DEFAULT 0,  -- seconds per km
    avg_speed      REAL    NOT NULL DEFAULT 0,  -- km/h
    route          TEXT    NOT NULL DEFAULT '[]',
    hr_timeline    TEXT    NOT NULL DEFAULT '[]',
    pace_timeline  TEXT    NOT NULL DEFAULT '[]',
    elev_timeline  TEXT    NOT NULL DEFAULT '[]',
    notes          TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_start
    ON workouts (user_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_workouts_user_type
    ON workouts (user_id, type);
