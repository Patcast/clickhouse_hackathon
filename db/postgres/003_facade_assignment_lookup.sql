-- The public facade resolves an assignment without exposing the internal
-- session UUID. Serialize each learner's assignment creation in application
-- code and enforce an unambiguous (learner, passage, assigned time) lookup.
CREATE UNIQUE INDEX IF NOT EXISTS reading_sessions_facade_lookup_uidx
  ON reading_sessions (child_id, passage_id, assigned_at);
