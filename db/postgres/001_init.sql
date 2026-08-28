CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS passages (
  passage_id integer PRIMARY KEY,
  author text,
  title text NOT NULL,
  anthology text,
  source_url text,
  publication_year integer,
  category text NOT NULL CHECK (category IN ('Lit', 'Info')),
  subcategory text,
  lexile_raw text,
  lexile_band integer,
  source_location text,
  license text,
  maturity_rating text,
  excerpt text NOT NULL,
  word_count integer NOT NULL CHECK (word_count > 0),
  sentence_count integer,
  paragraph_count integer,
  bt_easiness double precision,
  flesch_reading_ease double precision,
  flesch_kincaid_grade double precision,
  dale_chall double precision,
  rights_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (rights_status IN ('unreviewed', 'approved', 'blocked')),
  enriched_document jsonb,
  content_version text,
  source_content_hash text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE passages
  ADD COLUMN IF NOT EXISTS source_content_hash text;

CREATE INDEX IF NOT EXISTS passages_selection_idx
  ON passages (lexile_band, category, passage_id)
  WHERE enriched_document IS NOT NULL AND rights_status = 'approved';

CREATE TABLE IF NOT EXISTS reading_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id text NOT NULL,
  passage_id integer NOT NULL REFERENCES passages(passage_id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  requested_band jsonb NOT NULL,
  requested_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_document jsonb NOT NULL,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'completed', 'abandoned')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  session_started_at timestamptz,
  session_finished_at timestamptz,
  submission_hash text,
  result_id uuid,
  result_summary jsonb,
  raw_submission jsonb,
  result_received_at timestamptz,
  UNIQUE (child_id, idempotency_key)
);

-- Compatibility for a database initialized by an earlier local draft.
ALTER TABLE reading_sessions
  ADD COLUMN IF NOT EXISTS request_hash text;

CREATE INDEX IF NOT EXISTS reading_sessions_child_history_idx
  ON reading_sessions (child_id, assigned_at DESC);

-- Keep this table append-only. It is the table selected for Managed Postgres
-- "Sync to ClickHouse" (initial load + CDC).
CREATE TABLE IF NOT EXISTS reading_events (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  child_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES reading_sessions(session_id),
  passage_id integer NOT NULL REFERENCES passages(passage_id),
  event_type text NOT NULL,
  axis text CHECK (axis IN ('comprehension', 'vocabulary') OR axis IS NULL),
  chunk_id integer,
  question_id text,
  word text,
  answer_index integer,
  is_correct boolean,
  score double precision,
  duration_ms integer CHECK (duration_ms >= 0 OR duration_ms IS NULL),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS reading_events_child_time_idx
  ON reading_events (child_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS reading_events_session_idx
  ON reading_events (session_id, event_type);

CREATE OR REPLACE FUNCTION prevent_reading_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'reading_events is append-only; write a compensating event instead';
END;
$$;

DROP TRIGGER IF EXISTS reading_events_append_only ON reading_events;
CREATE TRIGGER reading_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON reading_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_reading_event_mutation();
