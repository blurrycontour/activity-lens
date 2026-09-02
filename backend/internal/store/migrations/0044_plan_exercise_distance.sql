-- Sets × a distance, for kind = 'distance': intervals, weighted carries, sled
-- pushes. distance_m is metres (the canonical unit); distance_unit is only how
-- the value is shown and entered ('m' or 'km'). weight_kg stays meaningful as
-- *added* load, which is how a weighted carry is written.
ALTER TABLE plan_exercises ADD COLUMN distance_m INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_exercises ADD COLUMN distance_unit TEXT NOT NULL DEFAULT 'm';
