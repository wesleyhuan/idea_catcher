-- A digest is stale when any capture in its period changed (edit, status), not
-- only when the count changed. Existing rows get null, so they regenerate once.
alter table digests add column source_updated_at timestamptz;
