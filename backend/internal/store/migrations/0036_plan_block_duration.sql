-- A section with no exercises in it: "warm up for ten minutes", written as a
-- duration on the block itself rather than as a made-up exercise called
-- "warm-up". Zero means the block's exercises say how long it takes.
ALTER TABLE plan_blocks ADD COLUMN duration_sec INTEGER NOT NULL DEFAULT 0;

-- The break taken after one exercise inside a block, before the next one in
-- the same block. Distinct from both of the rests that already exist:
--
--   plan_exercises.rest_sec  between sets of this exercise
--   plan_blocks.rest_sec     after the whole block, before the next block
--
-- A superset of three movements with a minute between each needed a third
-- number, and neither of the other two could be it.
ALTER TABLE plan_exercises ADD COLUMN break_sec INTEGER NOT NULL DEFAULT 0;
