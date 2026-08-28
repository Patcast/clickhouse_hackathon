-- Apply after ClickPipes has created the CDC destination table
-- `reading_events`. Because this source is append-only, an incremental
-- materialized view is safe: no later UPDATE/DELETE needs to retract a rollup.

CREATE TABLE IF NOT EXISTS child_progress_daily_rollup
(
  child_id String,
  activity_date Date,
  comprehension_attempts AggregateFunction(sum, UInt64),
  comprehension_correct AggregateFunction(sum, UInt64),
  vocabulary_attempts AggregateFunction(sum, UInt64),
  vocabulary_correct AggregateFunction(sum, UInt64),
  active_reading_ms AggregateFunction(sum, UInt64),
  word_lookups AggregateFunction(sum, UInt64),
  abandonments AggregateFunction(sum, UInt64),
  latest_synced_epoch_ms AggregateFunction(max, UInt64),
  max_observed_cdc_transfer_lag_ms AggregateFunction(max, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (child_id, activity_date);
