CREATE OR REPLACE VIEW child_progress_daily AS
SELECT
  child_id,
  activity_date,
  sumMerge(comprehension_attempts) AS comprehension_attempts,
  sumMerge(comprehension_correct) AS comprehension_correct,
  sumMerge(vocabulary_attempts) AS vocabulary_attempts,
  sumMerge(vocabulary_correct) AS vocabulary_correct,
  sumMerge(active_reading_ms) AS active_reading_ms,
  sumMerge(word_lookups) AS word_lookups,
  sumMerge(abandonments) AS abandonments,
  fromUnixTimestamp64Milli(toInt64(maxMerge(latest_synced_epoch_ms)), 'UTC') AS latest_synced_at,
  maxMerge(max_observed_cdc_transfer_lag_ms) AS max_observed_cdc_transfer_lag_ms,
  intDiv(
    greatest(
      toUnixTimestamp64Milli(now64(3)) -
        toInt64(maxMerge(latest_synced_epoch_ms)),
      0
    ),
    1000
  ) AS last_synced_event_age_seconds
FROM child_progress_daily_rollup
GROUP BY child_id, activity_date;
