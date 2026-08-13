-- What kind of client each session is, beside what go-authkit records.
--
-- The sessions table belongs to go-authkit, so its columns are not ours to add
-- to: it stores a user agent, an IP and a login time and nothing else. A user
-- agent cannot answer "is this the Android app or a browser" reliably and
-- cannot answer "which version of the app" at all — both are things only the
-- client knows, so the client now says so in a header and this is where the
-- answer is kept.
--
-- Keyed by the session's own id, which is also go-authkit's primary key there.
-- Deliberately no foreign key: the sessions table is another module's, and a
-- constraint against it would make our migration depend on its shape and its
-- ordering. Rows whose session has gone are pruned by the daily sweep instead,
-- and are invisible before that because every read starts from the session list.
CREATE TABLE IF NOT EXISTS session_clients (
    session_id  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    -- 'web' or 'android'. Empty for a session that predates this table or a
    -- client that sent no header, which is why the UI falls back to the agent.
    kind        TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    -- Last request on this session, RFC 3339. Written at most once every few
    -- minutes per session, not per request: what it is for is telling a phone
    -- you used this morning from one you signed into in March and forgot.
    last_seen   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_session_clients_user ON session_clients(user_id);
