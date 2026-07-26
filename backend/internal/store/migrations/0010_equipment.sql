-- Equipment (shoes, watches, bikes, etc.) and their many-to-many link to
-- workouts. Deleting a workout or a piece of equipment cascades to the link
-- table so stale associations never linger.
CREATE TABLE IF NOT EXISTS equipment (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'shoes',
    brand      TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    retired    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_user ON equipment(user_id);

CREATE TABLE IF NOT EXISTS workout_equipment (
    workout_id   TEXT NOT NULL,
    equipment_id TEXT NOT NULL,
    PRIMARY KEY (workout_id, equipment_id),
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_we_equipment ON workout_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS idx_we_workout ON workout_equipment(workout_id);
