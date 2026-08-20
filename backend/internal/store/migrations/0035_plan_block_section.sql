-- A block can be a section rather than working sets: a warm-up, a cool-down,
-- or stretching. Empty means an ordinary block of exercises, which is what
-- every existing block is.
--
-- On the block rather than the day, because a warm-up is a few minutes at the
-- top of a day that also has working sets — not a day of its own — and people
-- put stretching at both ends.
ALTER TABLE plan_blocks ADD COLUMN section TEXT NOT NULL DEFAULT '';
