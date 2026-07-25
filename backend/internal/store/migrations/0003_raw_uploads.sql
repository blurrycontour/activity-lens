-- Optional storage of the original imported activity file (GPX/TCX), gated by
-- the "keep original uploads" admin setting. Kept in its own table so normal
-- workout reads/writes (list, get, update) never touch these larger blobs.
CREATE TABLE IF NOT EXISTS workout_raw_uploads (
    workout_id   TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data         BLOB NOT NULL,
    created_at   TEXT NOT NULL
);
