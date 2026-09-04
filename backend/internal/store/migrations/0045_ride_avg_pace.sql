UPDATE workouts
SET avg_pace = (CASE WHEN moving_time > 0 THEN moving_time ELSE duration END) * 1000.0 / distance
WHERE type = 'Ride' AND avg_pace = 0 AND distance > 0
  AND (CASE WHEN moving_time > 0 THEN moving_time ELSE duration END) > 0;