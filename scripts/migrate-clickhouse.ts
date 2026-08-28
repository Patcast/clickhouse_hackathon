import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("Set CLICKHOUSE_URL before applying analytics SQL");

const client = createClient({
  url,
  username: process.env.CLICKHOUSE_USERNAME ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
});

try {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS schema_migrations
      (
        version String,
        applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree
      ORDER BY version
    `,
    clickhouse_settings: { wait_end_of_query: 1 },
  });

  const directory = resolve("db/clickhouse");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await client.query({
      query: `SELECT count() AS count FROM schema_migrations WHERE version = {version:String}`,
      query_params: { version: file },
      format: "JSONEachRow",
    });
    const rows = await applied.json<{ count: string }>();
    if (Number(rows[0]?.count ?? 0) > 0) {
      console.log(`Skipped ${file} (already applied)`);
      continue;
    }

    if (file === "002_backfill_rollup.sql") {
      const sourceCount = await client.query({
        query:
          "SELECT count() AS count FROM reading_events FINAL WHERE _peerdb_is_deleted = 0",
        format: "JSONEachRow",
      });
      const [{ count = "0" } = {}] = await sourceCount.json<{
        count: string;
      }>();
      if (
        Number(count) > 0 &&
        process.env.CLICKHOUSE_CDC_PAUSED_ACKNOWLEDGED !== "true"
      ) {
        throw new Error(
          "Pause the ClickPipe after it catches up, set " +
            "CLICKHOUSE_CDC_PAUSED_ACKNOWLEDGED=true, then rerun the backfill",
        );
      }
    }

    const sql = await readFile(resolve(directory, file), "utf8");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await client.command({
        query: statement,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
    }
    await client.command({
      query: `INSERT INTO schema_migrations (version) VALUES ({version:String})`,
      query_params: { version: file },
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    console.log(`Applied ${file}`);
  }
} finally {
  await client.close();
}
