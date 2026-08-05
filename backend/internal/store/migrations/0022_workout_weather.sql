-- Historical weather at each workout's start point, from Open-Meteo.
--
-- The workouts table has no coordinates: the only geography is `route`, a
-- gzipped JSON blob. Denormalising the first route point into two columns at
-- insert time means the background lookup can select its batch without
-- decompressing a blob per candidate row, and a retry never reads the route.
--
-- 0 is a legal latitude and longitude, so these are only meaningful when
-- weather_status says a lookup is wanted. Exactly (0,0) is treated as a bad fix.
ALTER TABLE workouts ADD COLUMN start_lat REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN start_lon REAL NOT NULL DEFAULT 0;

-- Lifecycle of the weather lookup for this row:
--
--   'none'    never asked for. This is the DEFAULT, which is what makes the
--             migration a no-op for every workout already in the library:
--             turning the feature on must not silently send years of location
--             history to a third party. Users opt into that explicitly, which
--             flips these to 'pending' (see Repository.RequestWeatherBackfill).
--   'pending' queued for the background lookup.
--   'ok'      fetched; the weather_* values below are real.
--   'manual'  entered by hand. Never overwritten by a fetch — someone who
--             corrected the temperature from their own notes must not have it
--             replaced by a 25 km grid average on the next pass.
--   'skipped' impossible and never retried: no route, a start time in the
--             future, or a coordinate that is out of range or exactly (0,0).
--   'failed'  failed in a way that might succeed later (timeout, 5xx, 429).
--             Retried while weather_attempts is under the cap, then left alone
--             so the UI can say "we tried" rather than "we have not looked".
--
-- Four distinct outcomes, not one nullable timestamp: "no GPS" is permanent and
-- must never consume the request budget again, while "the service was down" must
-- be retried but not forever. Collapsing them means either retrying indoor
-- workouts for eternity or turning a blip into a permanent silent gap.
ALTER TABLE workouts ADD COLUMN weather_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE workouts ADD COLUMN weather_attempts INTEGER NOT NULL DEFAULT 0;

-- Every column is NOT NULL DEFAULT 0 per house style, so 0 is indistinguishable
-- from "no reading" here. weather_status is the only thing separating the two,
-- which is why the API layer gates on it in exactly one place.
ALTER TABLE workouts ADD COLUMN weather_temp_c REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN weather_apparent_c REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN weather_humidity REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN weather_wind_kph REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN weather_precip_mm REAL NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN weather_code INTEGER NOT NULL DEFAULT 0;

-- The background pass asks one question — "which rows still owe a lookup" —
-- every few minutes. Without an index that is a full scan of the whole library
-- forever. A partial index holds only the rows that still need work, so it
-- costs nothing once they drain and nothing to maintain afterwards. Partial
-- indexes are supported by both SQLite and Postgres, so this stays portable.
CREATE INDEX IF NOT EXISTS idx_workouts_weather_pending
  ON workouts(user_id, start_time)
  WHERE weather_status IN ('pending', 'failed');

-- On by default, unlike most opt-ins here, because the lookup only ever covers
-- workouts imported from now on: nothing already in the library is sent
-- anywhere without the separate, explicit backfill action. Turning this off
-- stops new lookups and keeps whatever was already fetched.
ALTER TABLE user_prefs ADD COLUMN weather_enabled INTEGER NOT NULL DEFAULT 1;
