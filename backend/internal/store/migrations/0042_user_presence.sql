-- Last activity belongs to a user, not to the session that happened to carry
-- the request. Session rows are deleted on logout or revoke, while this one
-- timestamp remains useful to the directory.
CREATE TABLE IF NOT EXISTS user_presence (
    user_id   INTEGER PRIMARY KEY,
    last_seen TEXT NOT NULL
);

-- Preserve the newest observation available before session client rows are
-- next pruned. Login history is included because a logged-out session may
-- already have been removed before this migration first runs.
INSERT INTO user_presence (user_id, last_seen)
SELECT user_id, MAX(last_seen)
FROM (
    SELECT user_id, last_seen FROM session_clients WHERE last_seen != ''
    UNION ALL
    SELECT user_id, last_login_at FROM user_last_login WHERE last_login_at != ''
) observations
GROUP BY user_id
ON CONFLICT(user_id) DO UPDATE SET
    last_seen = CASE
        WHEN excluded.last_seen > user_presence.last_seen THEN excluded.last_seen
        ELSE user_presence.last_seen
    END;
