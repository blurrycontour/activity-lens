-- Track whether calories/steps were entered manually by the user versus
-- derived/estimated by the app, so the UI can badge each value accordingly.
-- Each ALTER runs separately and duplicate-column errors are tolerated by the
-- migration runner, keeping startup idempotent.
ALTER TABLE workouts ADD COLUMN calories_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN steps_manual INTEGER NOT NULL DEFAULT 0;
