-- Training goals become a list ("2 runs a week" AND "2 hikes a month"), stored
-- as a JSON array rather than a fixed set of columns so the shape can grow
-- without another migration. The single weekly_goal_* columns added in 0012 are
-- left in place and read once, to seed this column for anyone who already set a
-- goal; nothing writes to them any more.
ALTER TABLE user_prefs ADD COLUMN goals TEXT NOT NULL DEFAULT '';
