-- Training plans: a named routine (Push / Pull / Legs) made of days (Chest &
-- Triceps), each an ordered list of blocks, each block one or more exercises.
--
-- A block with one exercise is a plain exercise; a block with several is a
-- "choose one" — bench press or push-ups — and the runner picks at the time.
-- Modelling both as the same thing means no kind column and no second code
-- path: the count is the distinction.
--
-- Weights are kilograms throughout. The app is metric everywhere else and a
-- unit column here would be the only place it is not.
CREATE TABLE IF NOT EXISTS training_plans (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_user ON training_plans(user_id);

CREATE TABLE IF NOT EXISTS plan_days (
    id       TEXT PRIMARY KEY,
    plan_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_days_plan ON plan_days(plan_id, position);

CREATE TABLE IF NOT EXISTS plan_blocks (
    id       TEXT PRIMARY KEY,
    day_id   TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (day_id) REFERENCES plan_days(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_blocks_day ON plan_blocks(day_id, position);

-- One option within a block. The first by position is the default pick.
--
-- reps is text, not a number: "8", "8-10" and "45 s" are all things people
-- write in a plan, and forcing them into an integer is how a plan starts
-- lying. Nothing computes on it, so nothing needs it parsed.
CREATE TABLE IF NOT EXISTS plan_exercises (
    id        TEXT PRIMARY KEY,
    block_id  TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0,
    name      TEXT NOT NULL,
    sets      INTEGER NOT NULL DEFAULT 3,
    reps      TEXT NOT NULL DEFAULT '',
    weight_kg REAL NOT NULL DEFAULT 0,
    rest_sec  INTEGER NOT NULL DEFAULT 0,
    note      TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (block_id) REFERENCES plan_blocks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_exercises_block ON plan_exercises(block_id, position);

-- A run of one day, from Start to Finish.
--
-- The day is snapshotted into `snapshot` as JSON rather than referenced,
-- because history has to show the plan that was actually followed and plans
-- change. The alternative — versioning every plan — normalises a few kilobytes
-- per session at the cost of a join and reconciliation on every edit, and
-- still breaks when the plan is deleted. A snapshot is immutable by
-- construction and survives its plan.
--
-- plan_id is kept only to link back while the plan exists, and goes NULL when
-- it does not. The session stays readable either way.
--
-- The three counters are denormalised out of `progress` so the history list
-- and the consistency chart can aggregate without parsing JSON per row.
CREATE TABLE IF NOT EXISTS plan_sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    plan_id     TEXT,
    plan_name   TEXT NOT NULL,
    day_name    TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    -- The day as it stood when the session started.
    snapshot    TEXT NOT NULL,
    -- Which option was picked per block, which sets were ticked, and the
    -- weight actually used. Written as the session runs.
    progress    TEXT NOT NULL DEFAULT '{}',
    done_sets   INTEGER NOT NULL DEFAULT 0,
    total_sets  INTEGER NOT NULL DEFAULT 0,
    -- Sum of sets × reps × kg over completed sets. Zero for bodyweight-only
    -- days, which is honest: there is no load to total.
    volume_kg   REAL NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    -- The manual workout created on finish, when the user has that setting on.
    workout_id  TEXT,
    FOREIGN KEY (plan_id) REFERENCES training_plans(id) ON DELETE SET NULL,
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_sessions_user ON plan_sessions(user_id, started_at DESC);
-- The dashboard asks "is one running?" on every load; this keeps that an index
-- seek rather than a scan of every session the user has ever done.
CREATE INDEX IF NOT EXISTS idx_plan_sessions_active ON plan_sessions(user_id) WHERE finished_at IS NULL;
