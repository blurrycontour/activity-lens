-- Photos attached to a workout.
--
-- The bytes live on disk under <data dir>/media, not in here. That is the same
-- call 0018 made for archived uploads, and for the same reasons: SQLite pages
-- are a poor container for megabytes of JPEG, a photo is served far more often
-- than an activity file and wants http.ServeContent rather than a round trip
-- through memory, and a database that stays small stays quick to back up.
--
-- What is in here is everything needed to render the grid without touching the
-- disk: dimensions for the aspect ratio, the byte count for the caption, and
-- the caption itself.
CREATE TABLE IF NOT EXISTS workout_media (
    id         TEXT    NOT NULL PRIMARY KEY,
    workout_id TEXT    NOT NULL,
    -- Who added it. Not necessarily the workout's owner: a later change lets
    -- someone add a photo to a workout shared with them, and a column added
    -- now costs nothing while a column added later costs a migration.
    user_id    INTEGER NOT NULL,
    -- 'photo' today. Video is a separate decision with its own storage and
    -- processing story; the column exists so that decision does not have to
    -- rewrite every row.
    kind       TEXT    NOT NULL DEFAULT 'photo',
    -- What it was called when it arrived, for the download name only. Never
    -- used to build a path — see MediaStore, which names files by id.
    filename   TEXT    NOT NULL DEFAULT '',
    mime       TEXT    NOT NULL DEFAULT 'image/jpeg',
    width      INTEGER NOT NULL DEFAULT 0,
    height     INTEGER NOT NULL DEFAULT 0,
    -- Of the stored file, after processing, so the UI reports what it costs
    -- rather than what was uploaded.
    bytes      INTEGER NOT NULL DEFAULT 0,
    caption    TEXT    NOT NULL DEFAULT '',
    -- Display order within the workout. Explicit rather than by created_at, so
    -- reordering later is an UPDATE and not a rewrite of timestamps.
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);

-- The only query this table serves: everything for one workout, in order.
CREATE INDEX IF NOT EXISTS idx_workout_media_workout
    ON workout_media (workout_id, position, created_at);
