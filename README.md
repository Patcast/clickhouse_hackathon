# Read to Play — data team handoff

> 📚 **New here?** Start with [The Little Alexandria Data Story](https://claude.ai/code/artifact/14dbae04-49a1-4ccc-ad8d-9b5eded91478) — a visual walkthrough of the whole system from the data's perspective: the CLEAR corpus, the Postgres schema, the ClickPipes CDC bridge, the ClickHouse analytics, and how kids, teachers, and the LibreChat AI coach each touch the data.

## Little Alexandria production demo

Patricio's laptop-hosted demo has been moved from temporary ngrok URLs to three
persistent Vercel projects:

| Surface | Production URL | Access |
|---|---|---|
| Student reading app | <https://little-alexandria-student.vercel.app/> | Public demo; hard-coded synthetic student 104 |
| Professor data room | <https://little-alexandria-professor.vercel.app/> | Open the private `#access_token=...` link from the data team |
| Reading analytics MCP | `https://little-alexandria-mcp.vercel.app/mcp` | `Authorization: Bearer <PROFESSOR_MCP_TOKEN>` |
| Four-interface data/API lab | <https://read-to-play-alex.vercel.app/> | Existing cookie-exchange flow documented below |

The student app and its same-origin `POST /api/sessions` function are one Vercel
project. Completed reads write to ClickHouse. The professor app reads those
ClickHouse tables, and its APIs require the shared token. The MCP is a separate,
token-protected stateless Streamable HTTP endpoint exposing the four read-only
analytics tools. All learner names and performance data in this hackathon demo
are synthetic fixtures.

The professor/MCP token is separate from the four-interface data/API lab token
documented below. The private local handoff file labels both the complete
professor link and the corresponding MCP Bearer header.

LibreChat remains the Dockerized chat client. It no longer needs the MCP to run
on Patricio's laptop: point its `reading-analytics` server at the hosted MCP URL
and send the shared token as a Bearer header. Never commit the real token or put
it in browser source.

## Frontend handoff: four-route compatibility API

> **Deployment status:** all four routes are live on the hosted trial and backed
> by managed Postgres.

Use the API origin with no trailing slash:

```bash
# Hosted production origin.
export RTP_BASE_URL="https://read-to-play-alex.vercel.app"

# Local branch checkout.
# export RTP_BASE_URL="http://127.0.0.1:3000"
```

The compatibility surface is:

| Method | Path | Purpose | Success |
|---|---|---|---|
| `GET` | `/api/v1/user-info?userId=user_demo_003` | Read a learner profile | `200` |
| `POST` | `/api/v1/user-info` | Create or replace a learner profile | `200` |
| `GET` | `/api/v1/passage?userId=user_demo_003` | Assign one matched passage; requires `Idempotency-Key` | `200` |
| `POST` | `/api/v1/session` | Submit the filled passage document | `201`; exact replay `200` |

### What callers need for authentication

`SHARED_OUT_OF_BAND_TOKEN` is not needed to resolve the hostname or construct an
endpoint URL. When the trial is protected, it is needed once to exchange for the
eight-hour trial cookie. It is sent in JSON to the auth endpoint, not in the API
query string and not as a Bearer token:

```bash
export RTP_TRIAL_TOKEN="<SHARED_OUT_OF_BAND_TOKEN>"
export RTP_COOKIE_JAR="$(mktemp)"

curl --fail-with-body -sS \
  -c "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$RTP_TRIAL_TOKEN\"}" \
  "$RTP_BASE_URL/api/team-lab/auth"
```

Success is `204 No Content`; the cookie is returned in `Set-Cookie`. Send the
cookie on every `/health` and `/api/*` request:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/api/v1/user-info?userId=user_demo_003"
```

Never place the shared token in browser source. The cookie is `HttpOnly`,
`Secure`, and `SameSite=Strict`, so a browser app on another origin cannot call
the API directly with it. That app must call its own same-origin backend/server
proxy; the proxy performs the auth exchange, retains the upstream cookie, and
adds that cookie when it calls this API. A missing or stale cookie returns `401
TEAM_LAB_AUTH_REQUIRED`.

### Copyable GET and POST calls

Read or update a profile:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/api/v1/user-info?userId=user_demo_003"

curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "schemaVersion": "1.0",
    "userId": "user_demo_003",
    "readingProfile": {
      "lexileBand": { "min": 400, "target": 500, "max": 600 },
      "fleschKincaidGrade": 2.2,
      "daleChall": 6.2,
      "preferredCategories": ["Lit"],
      "preferredTopics": ["folktales", "kindness"]
    }
  }' \
  "$RTP_BASE_URL/api/v1/user-info"
```

Get an assignment, retain its complete response, fill only the allowed session
fields, and post the complete document back:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'idempotency-key: web-assignment-001' \
  "$RTP_BASE_URL/api/v1/passage?userId=user_demo_003" \
  -o passage.json

# Fill sessionStatus, sessionStartedAt/sessionFinishedAt, every chunk timing,
# every answer/timeSpentMs, and optional interactionEvents in passage.json.
cp passage.json completed-session.json

curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-binary @completed-session.json \
  "$RTP_BASE_URL/api/v1/session"
```

The passage response uses `userId` and deliberately omits the backend's
`sessionId` and `childId`. The session receipt also omits internal `sessionId`
and `resultId` values. Clients must preserve and return the complete assignment;
they should not invent or request an internal ID. Reuse the same
`Idempotency-Key` for an exact retry of a passage assignment. The first accepted
session result returns `201`; replaying the same answers and behavioral telemetry
returns `200`. Changing those result fields after acceptance returns `409
RESULT_CONFLICT`; immutable presentation fields are reconstructed from the
server's assignment and do not form part of the result fingerprint.

### Ten synthetic learner profiles

These are synthetic matching targets, not measured student records. Every
profile contains a Lexile range and target, Flesch–Kincaid grade, Dale–Chall
difficulty, preferred categories, and preferred topics.

The ten seed IDs are shared mutable demo fixtures. Integration teams should
create a namespaced pseudonymous ID (for example `alexandria_demo_001`) before
testing profile writes so they do not overwrite another team's selection setup.

| Seed ID | Lexile min / target / max | FK grade | Dale–Chall | Categories | Topics | Passage result today |
|---|---:|---:|---:|---|---|---|
| `user_demo_001` | 200 / 300 / 400 | 1.0 | 5.2 | Lit | animals, friendship | `422` |
| `user_demo_002` | 200 / 300 / 400 | 2.0 | 6.0 | Lit | family, adventure | `422` |
| `user_demo_003` | 400 / 500 / 600 | 2.2 | 6.2 | Lit | folktales, kindness | passage `2513` |
| `user_demo_004` | 400 / 500 / 600 | 3.6 | 5.2 | Lit | mystery, friendship | passage `2513` |
| `user_demo_005` | 400 / 500 / 600 | 2.9 | 5.8 | Info | animals, nature | passage `2513` |
| `user_demo_006` | 400 / 500 / 600 | 3.9 | 6.4 | Info | space, science | passage `2513` |
| `user_demo_007` | 600 / 700 / 800 | 4.2 | 7.2 | Lit | adventure, mythology | `422` |
| `user_demo_008` | 600 / 700 / 800 | 5.2 | 5.9 | Lit | historical fiction, mystery | `422` |
| `user_demo_009` | 600 / 700 / 800 | 5.0 | 7.1 | Info | history, technology | `422` |
| `user_demo_010` | 800 / 900 / 1000 | 5.6 | 7.8 | Info | environment, engineering | `422` |

Only passage `2513` is currently enriched and approved, and it is 500L. With
the seeded values, only the four 500L-target profiles (`user_demo_003` through
`user_demo_006`) can select it. The other six profiles still work with both
user-info routes, but passage selection returns `422 NO_ELIGIBLE_PASSAGE` until
content in their Lexile bands is approved or their profile is updated.

Flesch–Kincaid and Dale–Chall are stored and returned as matching targets, but
the selector does not yet score candidates against them. `band-match-v1`
hard-filters by approved/enriched content and Lexile band, then ranks primarily
by unseen status, category preference, topic matches, distance from the target
Lexile, assignment age, and passage ID. Categories and topics are ranking
signals, not hard filters.

The complete compatibility contract is in
[docs/four-interface-contract.md](docs/four-interface-contract.md). The
original session-ID API below remains available and is documented separately.

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
| `GET` | `/api/v1/user-info?userId=:userId` | `200`, one user profile |
| `POST` | `/api/v1/user-info` | `200`, complete saved user profile |
| `GET` | `/api/v1/passage?userId=:userId` | `200`, one compatibility assignment without an internal session ID |
| `POST` | `/api/v1/session` | `201` first result; `200` exact replay, without internal IDs |
| `POST` | `/api/v1/passages/select` | `200`, one assignment |
| `PUT` | `/api/v1/reading-sessions/:sessionId/result` | `201` first result; `200` exact replay |
| `GET` | `/api/v1/analytics/children/:childId/progress` | `200`, ClickHouse daily rollups |

Handled errors use `{ "error": { "code", "message", "details?" } }`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request does not match the v1 schema |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Compatibility passage GET omitted its assignment key |
| 400 | `SESSION_ID_MISMATCH` | URL and document session IDs differ |
| 401 | `TEAM_LAB_AUTH_REQUIRED` / `TEAM_LAB_AUTH_INVALID` | Missing or invalid trial access |
| 404 | `USER_NOT_FOUND` | Unknown compatibility-profile user ID |
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
| `users` | Learner matching profiles | Lexile band/target, FK grade, Dale–Chall, category/topic preferences, profile source |
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
- Use the four-route facade for learner clients; it strips `correctIndex` and server-scored fields. The original session-ID route retains them only for the existing hackathon lab.
- Treat shared trial access as demo protection, not child/session/class authorization.
