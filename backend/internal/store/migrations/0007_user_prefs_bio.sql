-- Backfill physiology columns on user_prefs. These bio details (biological
-- sex, birth year, height) feed energy-expenditure and other physiological
-- calculations. Each ALTER runs separately and duplicate-column errors are
-- tolerated by the migration runner, keeping startup idempotent.
ALTER TABLE user_prefs ADD COLUMN sex TEXT NOT NULL DEFAULT '';
ALTER TABLE user_prefs ADD COLUMN birth_year INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN height_cm INTEGER NOT NULL DEFAULT 0;
