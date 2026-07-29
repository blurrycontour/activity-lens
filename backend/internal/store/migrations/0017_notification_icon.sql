-- Avatar of whoever caused the notification, so a share shows the person who
-- sent it rather than the app icon. Stored rather than resolved at read time:
-- the push payload is built when the event fires, and it needs the same value.
-- The cost is that changing your avatar leaves older notifications pointing at
-- the previous file, which simply falls back to the default icon.
ALTER TABLE notifications ADD COLUMN icon TEXT NOT NULL DEFAULT '';
