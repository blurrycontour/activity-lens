-- Whether the profile body weight is entered by hand (used for estimates but
-- kept out of the weight chart) or mirrors the latest logged weigh-in.
--
-- Default 0 (mirror the log) matches the unified behaviour body vitals shipped
-- with; a user who wants a fixed manual weight opts in.
ALTER TABLE user_prefs ADD COLUMN body_weight_manual INTEGER NOT NULL DEFAULT 0;
