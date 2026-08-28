-- This rebuild makes the non-transactional backfill safely rerunnable. The
-- migration runner refuses a non-empty first backfill unless CDC is paused.
TRUNCATE TABLE child_progress_daily_rollup;

INSERT INTO child_progress_daily_rollup
SELECT
  child_id,
  toDate(occurred_at, 'UTC') AS activity_date,
  sumState(toUInt64(event_type = 'question_answer' AND ifNull(axis = 'comprehension', false))) AS comprehension_attempts,
  sumState(toUInt64(event_type = 'question_answer' AND ifNull(axis = 'comprehension', false) AND ifNull(is_correct, false))) AS comprehension_correct,
  sumState(toUInt64(event_type = 'question_answer' AND ifNull(axis = 'vocabulary', false))) AS vocabulary_attempts,
  sumState(toUInt64(event_type = 'question_answer' AND ifNull(axis = 'vocabulary', false) AND ifNull(is_correct, false))) AS vocabulary_correct,
  sumState(toUInt64(if(event_type = 'chunk_completed', coalesce(duration_ms, 0), 0))) AS active_reading_ms,
  sumState(toUInt64(event_type = 'word_lookup')) AS word_lookups,
  sumState(toUInt64(event_type = 'session_abandoned')) AS abandonments,
  maxState(toUInt64(toUnixTimestamp64Milli(_peerdb_synced_at))) AS latest_synced_epoch_ms,
  maxState(
    toUInt64(
      greatest(
        toInt64(toUnixTimestamp64Milli(_peerdb_synced_at)) -
          toInt64(toUnixTimestamp64Milli(ingested_at)),
        0
      )
    )
  ) AS max_observed_cdc_transfer_lag_ms
FROM reading_events FINAL
WHERE _peerdb_is_deleted = 0
GROUP BY child_id, activity_date;
