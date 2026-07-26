-- Add a per-user step (stride) length in centimetres used to estimate step
-- counts from distance. Zero means "use the per-activity default".
ALTER TABLE user_prefs ADD COLUMN step_length_cm INTEGER NOT NULL DEFAULT 0;
