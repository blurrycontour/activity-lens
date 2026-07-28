-- Provenance and de-duplication for imported workouts. Until now Create always
-- inserted a fresh row, so re-importing the same file (or re-running an
-- automated sync) silently produced duplicates.
--
-- source     : where the workout came from ('upload', 'manual', 'healthconnect')
-- external_id: stable identity of the workout *within* that source. For file
--              uploads this is the SHA-256 of the file bytes; for a sync source
--              it is that source's own record id. NULL means "not de-duplicable"
--              (hand-entered workouts), and the partial index below ignores it,
--              so existing rows need no backfill beyond the source default.
-- content_hash: SHA-256 of the original bytes, kept separately from external_id
--              so a sync source can still record what it ingested.
--
-- Each ALTER runs separately and duplicate-column errors are tolerated by the
-- migration runner, keeping startup idempotent.
ALTER TABLE workouts ADD COLUMN source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE workouts ADD COLUMN external_id TEXT;
ALTER TABLE workouts ADD COLUMN content_hash TEXT;

-- Partial unique index: a given source may claim each external id once per
-- user. The WHERE clause keeps hand-entered workouts (external_id NULL) exempt
-- and is supported by both SQLite and Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_user_source_external
	ON workouts (user_id, source, external_id)
	WHERE external_id IS NOT NULL;

-- Supports the "have I already stored these bytes?" lookup independently of
-- which source claimed them.
CREATE INDEX IF NOT EXISTS idx_workouts_user_content_hash
	ON workouts (user_id, content_hash)
	WHERE content_hash IS NOT NULL;
