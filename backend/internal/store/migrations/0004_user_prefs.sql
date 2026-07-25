-- Per-user preferences that influence how activity metrics are computed and
-- displayed: the calorie-estimation method and body weight (previously global
-- admin settings) plus heart-rate / performance reference values.
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id        INTEGER PRIMARY KEY,
    calorie_method TEXT    NOT NULL DEFAULT 'heart-rate',
    body_weight_kg REAL    NOT NULL DEFAULT 70,
    max_hr         INTEGER NOT NULL DEFAULT 0,
    resting_hr     INTEGER NOT NULL DEFAULT 0,
    threshold_pace TEXT    NOT NULL DEFAULT '',
    ftp            INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT    NOT NULL
);
