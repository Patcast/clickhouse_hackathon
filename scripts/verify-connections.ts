import { createClient } from "@clickhouse/client";
import { createPostgresPool } from "../src/postgres.js";

const postgresUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
const clickhouseUrl = process.env.CLICKHOUSE_URL;
if (!postgresUrl || !clickhouseUrl) {
  throw new Error(
    "Set DATABASE_DIRECT_URL (or DATABASE_URL) and CLICKHOUSE_URL before verifying",
  );
}

const pool = createPostgresPool(postgresUrl);
const clickhouse = createClient({
  url: clickhouseUrl,
  username: process.env.CLICKHOUSE_USERNAME ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
});

try {
  const postgres = await pool.query<{
    database: string;
    server_version: string;
  }>(
    `SELECT current_database() AS database,
            current_setting('server_version') AS server_version`,
  );
  const clickhouseVersion = await clickhouse.query({
    query: "SELECT currentDatabase() AS database, version() AS server_version",
    format: "JSONEachRow",
  });
  const clickhouseRows = await clickhouseVersion.json();
  const cdcTable = await clickhouse.query({
    query: "EXISTS TABLE reading_events",
    format: "JSONEachRow",
  });

  console.log(
    JSON.stringify(
      {
        postgres: postgres.rows[0],
        clickhouse: clickhouseRows[0],
        readingEventsReplicated: Boolean(
          Number((await cdcTable.json<{ result: number | string }>())[0]?.result),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
  await clickhouse.close();
}
