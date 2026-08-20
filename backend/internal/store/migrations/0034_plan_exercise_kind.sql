-- What an exercise is measured in.
--
--   'weight'  sets × reps at a load in kilograms. The default, and what every
--             row was before this column existed.
--   'body'    sets × reps against your own bodyweight. weight_kg stays
--             meaningful as *added* load, which is how weighted pull-ups and
--             dips are written.
--   'time'    sets × a duration. Planks, dead hangs, carries.
--
-- Before this, a plank could only be expressed by typing "45 s" into the reps
-- field, which made the editor show a kilograms box for a held position and
-- left the reps text as the only thing standing between a duration and being
-- counted as repetitions.
ALTER TABLE plan_exercises ADD COLUMN kind TEXT NOT NULL DEFAULT 'weight';

-- Seconds per set, for kind = 'time'. Ignored otherwise.
ALTER TABLE plan_exercises ADD COLUMN duration_sec INTEGER NOT NULL DEFAULT 0;
