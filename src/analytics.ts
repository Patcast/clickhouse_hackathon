import { createClient, type ClickHouseClient } from "@clickhouse/client";

export interface AnalyticsStore {
  childProgress(childId: string): Promise<ChildProgressDay[]>;
  healthCheck?(): Promise<AnalyticsStoreHealth>;
  close?(): Promise<void>;
}

export interface AnalyticsStoreHealth {
  replicatedEventCount: number;
}

export interface ChildProgressDay {
  activityDate: string;
  comprehensionAttempts: number;
  comprehensionCorrect: number;
  vocabularyAttempts: number;
  vocabularyCorrect: number;
  activeReadingMs: number;
  wordLookups: number;
  abandonments: number;
  latestSyncedAt: string;
  maxObservedCdcTransferLagMs: number;
  lastSyncedEventAgeSeconds: number;
}

interface RawChildProgressDay {
  activity_date: string;
  comprehension_attempts: string | number;
  comprehension_correct: string | number;
  vocabulary_attempts: string | number;
  vocabulary_correct: string | number;
  active_reading_ms: string | number;
  word_lookups: string | number;
  abandonments: string | number;
  latest_synced_at: string;
  max_observed_cdc_transfer_lag_ms: string | number;
  last_synced_event_age_seconds: string | number;
}

function safeInteger(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`ClickHouse returned an unsafe ${field} value`);
  }
  return parsed;
}

export class ClickHouseAnalyticsStore implements AnalyticsStore {
  private readonly client: ClickHouseClient;

  constructor(options: {
    url: string;
    username: string;
    password: string;
    database: string;
  }) {
    this.client = createClient(options);
  }

  async childProgress(childId: string): Promise<ChildProgressDay[]> {
    const result = await this.client.query({
      query: `
        SELECT
          activity_date,
          comprehension_attempts,
          comprehension_correct,
          vocabulary_attempts,
          vocabulary_correct,
          active_reading_ms,
          word_lookups,
          abandonments,
          latest_synced_at,
          max_observed_cdc_transfer_lag_ms,
          last_synced_event_age_seconds
        FROM child_progress_daily
        WHERE child_id = {childId:String}
        ORDER BY activity_date
      `,
      query_params: { childId },
      format: "JSONEachRow",
    });
    const rows = await result.json<RawChildProgressDay>();
    return rows.map((row) => ({
      activityDate: row.activity_date,
      comprehensionAttempts: safeInteger(
        row.comprehension_attempts,
        "comprehension_attempts",
      ),
      comprehensionCorrect: safeInteger(
        row.comprehension_correct,
        "comprehension_correct",
      ),
      vocabularyAttempts: safeInteger(
        row.vocabulary_attempts,
        "vocabulary_attempts",
      ),
      vocabularyCorrect: safeInteger(
        row.vocabulary_correct,
        "vocabulary_correct",
      ),
      activeReadingMs: safeInteger(row.active_reading_ms, "active_reading_ms"),
      wordLookups: safeInteger(row.word_lookups, "word_lookups"),
      abandonments: safeInteger(row.abandonments, "abandonments"),
      latestSyncedAt: row.latest_synced_at,
      maxObservedCdcTransferLagMs: safeInteger(
        row.max_observed_cdc_transfer_lag_ms,
        "max_observed_cdc_transfer_lag_ms",
      ),
      lastSyncedEventAgeSeconds: safeInteger(
        row.last_synced_event_age_seconds,
        "last_synced_event_age_seconds",
      ),
    }));
  }

  async healthCheck(): Promise<AnalyticsStoreHealth> {
    const result = await this.client.query({
      query: `
        SELECT
          (SELECT count() FROM reading_events) AS replicated_event_count,
          (
            SELECT count()
            FROM system.tables
            WHERE database = currentDatabase()
              AND name = 'child_progress_daily'
          ) AS progress_view_count
      `,
      format: "JSONEachRow",
    });
    const [row] = await result.json<{
      replicated_event_count: string | number;
      progress_view_count: string | number;
    }>();
    if (!row || safeInteger(row.progress_view_count, "progress_view_count") !== 1) {
      throw new Error("ClickHouse progress view is unavailable");
    }
    return {
      replicatedEventCount: safeInteger(
        row.replicated_event_count,
        "replicated_event_count",
      ),
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
