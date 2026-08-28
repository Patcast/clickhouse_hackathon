# Read to Play — data team handoff

This service is the data/API slice agreed in the Granola **Alex** meeting. It:

1. selects exactly one child-appropriate, enriched reading passage;
2. returns the passage, chunks, comprehension questions, and vocabulary questions as one JSON document;
3. accepts that same document with timings and answers filled in;
4. scores it in Postgres; and
5. exposes eventual progress analytics from ClickHouse after ClickPipes CDC arrives.

## Trial app

- Team trial: <https://read-to-play-alex.vercel.app>
- Local trial: <http://127.0.0.1:3000>

The hosted trial is protected. Ask the data team for the private access link; it has this shape:

```text
https://read-to-play-alex.vercel.app/#access_token=<SHARED_OUT_OF_BAND_TOKEN>
```

The page exchanges the URL fragment for an 8-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie, then immediately removes the token from the address bar. Never commit or paste the real token into client source code.

## Integration flow

```text
client/backend
    |
    | 1. POST /api/v1/passages/select
    v
Fastify API ----------------------> Managed Postgres
    ^                               passages + sessions + events
    |                                            |
    | 2. PUT filled session                     | ClickPipes CDC
    |                                            v
    +-- 3. GET child progress <----------- ClickHouse Cloud
```

Postgres owns transactional assignment, idempotency, results, and the append-only event stream. Only `reading_events` is replicated to ClickHouse. The application does not dual-write.

### 0. Authenticate to the hosted trial

The hosted API uses the same trial cookie as the UI; it does **not** accept Bearer tokens. For CLI or server-side integration:

```bash
export RTP_BASE_URL="https://read-to-play-alex.vercel.app"
export RTP_TRIAL_TOKEN="<ask-the-data-team>"
export RTP_COOKIE_JAR="$(mktemp)"

curl --fail-with-body -sS \
  -c "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$RTP_TRIAL_TOKEN\"}" \
  "$RTP_BASE_URL/api/team-lab/auth"

curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/health"
```

Successful authentication returns `204 No Content`. `/health` and all `/api/*` routes except the auth exchange require the cookie.

Important for other browser teams: the trial cookie is intentionally same-origin. A separately deployed browser app should call this API through its own backend/server-side proxy. Direct cross-origin browser integration is not yet a supported public-auth flow.

### 1. Select one passage

This is a `POST`, not a `GET`, because the request carries selection criteria and creates an assignment session.

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: maya-assignment-001' \
  -d '{
    "schemaVersion": "1.0",
    "childId": "child_maya",
    "readingBand": {
      "system": "lexile",
      "min": 400,
      "max": 600,
      "target": 500
    },
    "preferences": {
      "categories": ["Lit"],
      "topics": ["animals", "folktales"]
    },
    "excludePassageIds": []
  }' \
  "$RTP_BASE_URL/api/v1/passages/select"
```

Only `childId` and `readingBand` are required. Success is `200` with one flat `SessionDocument`, never an array. Keep the complete response—you will return it in step 2. Important top-level fields are:

```text
schemaVersion, sessionId, childId, assignedAt, sessionStatus
selection
passage
chunks[]
comprehensionQuestions[]
vocabQuestions[]
interactionEvents[]
```

The response header `x-idempotent-replay` is `false` for a new assignment and `true` when the original assignment is replayed.

#### How a passage is found

The Postgres selection runs inside a transaction:

1. Validate the ordered Lexile band and request limits.
2. Hard-filter to passages with an enriched document, approved rights, a Lexile inside `min..max`, and an ID not in `excludePassageIds`.
3. Rank passages the child has never received ahead of repeats.
4. Rank category matches, then topic-match count, then distance from the target Lexile.
5. Break ties by oldest prior assignment and then passage ID.
6. Persist one assignment atomically and return the exact original on a safe retry.

Preferences are ranking signals, not hard filters. The current cloud database contains all 4,724 imported CLEAR passages, but only passage `2513` is currently enriched and approved for assignment. Its Lexile is 500, so the demo band must include 500 and exclusions must not contain 2513.

### 2. Return the filled session

Send the **complete assignment document** back to:

```text
PUT /api/v1/reading-sessions/{sessionId}/result
```

Clicks, timers, lookups, and answers are accumulated in the browser draft. They do not populate `reading_events` one click at a time. Postgres receives the derived event batch only when this `PUT` succeeds, so closing the tab before completing or abandoning the session loses the in-progress telemetry.

Before sending, fill these interaction fields:

- `sessionStatus`: `completed` or `abandoned`
- `sessionStartedAt` and `sessionFinishedAt`: RFC 3339 timestamps
- each chunk's `readingTime` and optional `visits`
- each question's zero-based `answer` and `timeSpentMs`
- optional `interactionEvents`

Allowed interaction types are `word_lookup`, `word_tap`, `pause`, `resume`, and `reread`. Word interactions require both `word` and `chunkId`. The backend reconstructs the trusted assignment and recomputes `isCorrect` and `score`; client-supplied grading values are ignored.

Example call after saving the filled document as `result.json`:

```bash
export RTP_SESSION_ID="<sessionId-from-step-1>"

curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-binary @result.json \
  "$RTP_BASE_URL/api/v1/reading-sessions/$RTP_SESSION_ID/result" \
  -X PUT
```

The first accepted result returns `201`; an exact retry returns the same receipt with `200`. A changed retry returns `409 RESULT_CONFLICT`. Persist and retry the exact serialized payload.

Completed sessions require every chunk timing and every answer. Abandoned sessions may be partial; unanswered questions do not become failed attempts.

### 3. Read ClickHouse progress

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/api/v1/analytics/children/child_maya/progress"
```

Representative response:

```json
{
  "childId": "child_maya",
  "days": [
    {
      "activityDate": "2026-08-28",
      "comprehensionAttempts": 3,
      "comprehensionCorrect": 2,
      "vocabularyAttempts": 3,
      "vocabularyCorrect": 3,
      "activeReadingMs": 135000,
      "wordLookups": 1,
      "abandonments": 0,
      "latestSyncedAt": "2026-08-28 21:41:03.000",
      "maxObservedCdcTransferLagMs": 2000,
      "lastSyncedEventAgeSeconds": 8
    }
  ]
}
```

Dates are UTC. CDC is eventually consistent; the team lab polls every three seconds for up to 90 seconds.

## HTTP surface

| Method | Path | Success |
|---|---|---|
| `GET` | `/` | Team trial UI |
| `POST` | `/api/team-lab/auth` | `204`, sets trial cookie |
| `GET` | `/health` | `200`; body says `ok` or `degraded` |
| `POST` | `/api/v1/passages/select` | `200`, one assignment |
| `PUT` | `/api/v1/reading-sessions/:sessionId/result` | `201` first result; `200` exact replay |
| `GET` | `/api/v1/analytics/children/:childId/progress` | `200`, ClickHouse daily rollups |

Handled errors use `{ "error": { "code", "message", "details?" } }`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request does not match the v1 schema |
| 400 | `SESSION_ID_MISMATCH` | URL and document session IDs differ |
| 401 | `TEAM_LAB_AUTH_REQUIRED` / `TEAM_LAB_AUTH_INVALID` | Missing or invalid trial access |
| 404 | `SESSION_NOT_FOUND` | Unknown assignment |
| 409 | `IDEMPOTENCY_CONFLICT` | Selection key reused for changed input |
| 409 | `RESULT_CONFLICT` | Result retry differs from accepted payload |
| 422 | `NO_ELIGIBLE_PASSAGE` | No approved enriched passage matches |
| 422 | `INVALID_RESULT` | Impossible/incomplete result document |
| 503 | `ANALYTICS_NOT_CONFIGURED` | ClickHouse is unavailable in this environment |

The complete field contract and validation rules are in [docs/api-contract.md](docs/api-contract.md).

## Postgres layout

| Table | Purpose | Key content |
|---|---|---|
| `passages` | Imported CLEAR corpus and assignment candidates | descriptive metrics in columns; enriched chunks/questions/answer keys in `enriched_document` JSONB |
| `reading_sessions` | Transactional assignments and accepted results | requested band/preferences, immutable assigned `response_document`, raw submission, server result summary, idempotency hashes |
| `reading_events` | Append-only analytics boundary | derived chunk, question, interaction, completion, and abandonment events replicated by ClickPipes |

Questions are not normalized into separate tables in v1. The reviewed question prompts, options, zero-based `correctIndex`, and vocabulary metadata live inside `passages.enriched_document`; the assigned snapshot is copied to `reading_sessions.response_document`. Submitted answers live in `reading_sessions.raw_submission`, and derived/scored answer events live in `reading_events`.

The full read-only corpus distributions, column inventory, question/answer layout, trial counts, and integrity checks are in [docs/postgres-inventory.md](docs/postgres-inventory.md).

## Local development

Requires Node 22+ and pnpm:

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:3000>. With no `DATABASE_URL`, the app uses passage 2513 in memory; results are not durable and ClickHouse is unavailable.

For local Postgres:

```bash
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate
pnpm db:import
pnpm dev
```

The cloud setup sequence is in [docs/clickhouse-cloud-setup.md](docs/clickhouse-cloud-setup.md). Do not point ClickPipes at a PgBouncer hostname; use the direct Postgres connection for migrations/import/CDC and the pooled URL for application traffic.

Run all checks:

```bash
pnpm check
```

## Integration checklist

- Use a stable pseudonymous `childId`, not a child's real name.
- Generate one stable `Idempotency-Key` per logical assignment.
- Persist the complete assignment, `sessionId`, and `contentVersion`.
- Keep timestamps in RFC 3339 UTC and durations as integer milliseconds.
- Return every assigned chunk and question exactly once in a completed result.
- Treat answers as zero-based option indexes.
- Retry only the exact same result payload.
- Poll progress because CDC is asynchronous.
- Do not expose `correctIndex` in a real student UI; it remains in v1 only for hackathon compatibility.
- Treat shared trial access as demo protection, not child/session/class authorization.
