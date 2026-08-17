-- Rest taken *after* a block, as opposed to plan_exercises.rest_sec, which is
-- the rest between the sets of one exercise.
--
-- Two different waits: ninety seconds between sets of the same lift, and a
-- longer break before moving to the next station. Folding them into one number
-- would make the runner's timer wrong for whichever of the two it was not
-- measuring.
ALTER TABLE plan_blocks ADD COLUMN rest_sec INTEGER NOT NULL DEFAULT 0;
