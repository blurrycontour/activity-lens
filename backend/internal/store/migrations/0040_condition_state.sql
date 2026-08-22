-- What a standing condition looked like the last time it was checked.
--
-- Notifications about a condition -- a goal met, a shoe worn out -- want to
-- fire on the *edge*: the moment it becomes true, and not again while it stays
-- true. Until now the edge was inferred from whether a notification with a
-- given dedupe key already existed, and that has two faults. The marker lives
-- on a row the user can delete, so clearing the notification list re-arms every
-- condition in the app; and a condition that was already true the first time it
-- was ever looked at is indistinguishable from one that just became true, so
-- the first workout recorded after a goal was already complete announced it as
-- news.
--
-- This is the state itself, separate from the message about it. First sight of
-- a condition records what it is and says nothing -- a baseline is not news --
-- and only a change from false to true afterwards is.
--
-- The key is the caller's to choose and carries whatever scope the condition
-- has: a goal's includes the period, so each week or month is its own
-- condition and starts fresh; a piece of equipment's does not, because wearing
-- out is not something that happens weekly.
CREATE TABLE IF NOT EXISTS condition_state (
  user_id    INTEGER NOT NULL,
  key        TEXT    NOT NULL,
  active     INTEGER NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);
