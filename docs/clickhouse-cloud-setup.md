# ClickHouse Cloud deployment checklist

This is the production path for the hackathon. It uses the current native
Managed Postgres integration rather than browser-side database writes or a
custom dual-write pipeline.

## 1. Create both services

Create a ClickHouse Managed Postgres instance and a ClickHouse Cloud service in
the same available region. Managed Postgres is currently a public-beta service,
so keep the application contract independent of provider-specific APIs.

Copy two Postgres URLs:

- `DATABASE_URL`: runtime URL; the bundled PgBouncer endpoint is suitable when
  the deployment creates many short-lived connections.
- `DATABASE_DIRECT_URL`: direct instance hostname for migrations, imports, and
  administrative work. Never use PgBouncer for ClickPipes CDC.

For production, download the instance CA and set
`POSTGRES_CA_CERT_PATH`; Managed Postgres requires TLS and ClickHouse recommends
full certificate verification.

Copy the ClickHouse **HTTPS** connection endpoint (normally
`https://<service-host>:8443`) into `CLICKHOUSE_URL`, plus the username,
password, and exact destination database in `CLICKHOUSE_DATABASE`. The Node
client does not use the native `clickhouse://...:9440` endpoint.

## 2. Load operational data

```bash
cp .env.example .env
pnpm db:migrate
pnpm db:import
```

The import validates all 4,724 CLEAR IDs, normalizes mixed Lexile values,
recomputes the workbook's broken formula-derived word/paragraph counts, and
marks only the reviewed CC BY passage 2513 as selectable.

## 3. Configure native CDC

From the Managed Postgres sidebar choose **Sync to ClickHouse**:

1. Select the ClickHouse service.
2. Choose **Initial load + CDC**.
3. Select only `reading_events` for the initial integration.
4. Select the same database named by `CLICKHOUSE_DATABASE`.
5. Map `public.reading_events` to exactly `reading_events`; disable the option
   that prefixes destination tables with the Postgres schema.
6. Preserve NULL values.
7. Start with a 10-second sync interval for the live demo if the account allows
   it; otherwise display the actual lag rather than promising a fixed delay.

If either service uses restricted IP access, allow the ClickPipes source IPs
shown for the ClickHouse region before starting the sync.

`reading_events.event_id` is an immutable primary key. The API uses
deterministic IDs and `ON CONFLICT DO NOTHING`, which makes result retries safe
before data reaches ClickPipes.

## 4. Create ClickHouse analytics objects

After the ClickPipe destination table exists and before demo traffic starts:

```bash
pnpm db:clickhouse
```

If `reading_events` already contains rows, first wait for the ClickPipe to catch
up, pause it, set `CLICKHOUSE_CDC_PAUSED_ACKNOWLEDGED=true`, run the command,
then resume the ClickPipe. The migration refuses a non-empty first backfill
without that acknowledgement. This closes the gap between the initial rebuild
and creation of the live materialized view; run only one migrator at a time.

The migrations rebuild/backfill existing CDC rows, then create one incremental
materialized view backed by `AggregatingMergeTree`. It maintains daily
comprehension/vocabulary attempts, correct answers, active reading time, word
lookups, abandonments, and the latest `_peerdb_synced_at` timestamp.

The API queries the rollup with the official `@clickhouse/client` and converts
ClickHouse's 64-bit JSON strings to checked JavaScript numbers. Reporting days
are explicitly UTC. `maxObservedCdcTransferLagMs` is the largest observed
event-level Postgres-to-ClickHouse delay for that child/day; it is a useful
clock-dependent proxy, not authoritative ClickPipe health.
`lastSyncedEventAgeSeconds` measures how long ago that child's latest event
arrived, so it naturally grows while a child is inactive.

Postgres enforces `reading_events` as append-only. That is required because an
incremental ClickHouse materialized view cannot retract an earlier aggregate
when a CDC source row is updated or deleted. Corrections must be represented as
new compensating events.

## 5. Verify without exposing credentials

```bash
pnpm db:verify
```

This prints server versions, database names, and whether the replicated
`reading_events` table exists. It never prints passwords or connection URLs.

## Why not use pg_clickhouse first?

Managed Postgres bundles `pg_clickhouse`, and it is a useful optional demo of a
single SQL surface. Its query pushdown is still evolving. Two explicit
server-side clients keep the critical path predictable:

- `pg` for transactional assignment and idempotent result writes
- `@clickhouse/client` for class and longitudinal analytics
