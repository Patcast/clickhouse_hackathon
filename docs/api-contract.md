# Alexandria API contract (v1)

This contract follows the Granola meeting **Alex** and preserves the existing
`passage_2513.json` keys. Clients must ignore additive fields they do not yet
understand.

## Base URL and compatibility status

The four profile-oriented compatibility routes are deployed on the hosted
service and backed by managed Postgres.

```bash
# Hosted production origin.
export RTP_BASE_URL="https://read-to-play-alex.vercel.app"

# Local branch checkout.
# export RTP_BASE_URL="http://127.0.0.1:3000"
```

Append the route path directly to this origin. Do not add the shared token to
the hostname, path, or query string.

## Hosted trial authentication

When `TEAM_LAB_ACCESS_TOKEN` is configured, exchange it once with
`POST /api/team-lab/auth` and JSON `{ "token": "..." }`. Success returns `204`
and an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie. `/health` and
all other `/api/*` routes require that cookie. The hosted trial does not accept
Bearer tokens; a separately deployed browser client must use a server-side
proxy because the cookie is deliberately same-origin.

The value referred to by the team as `SHARED_OUT_OF_BAND_TOKEN` is the JSON
`token` value for this exchange. It is an authentication secret, not endpoint
discovery information. A separate-origin browser should call its own backend;
that backend performs the exchange, retains the upstream cookie, and sends the
cookie with API calls. Do not embed the shared token in frontend JavaScript.

Copyable exchange:

```bash
export RTP_TRIAL_TOKEN="<SHARED_OUT_OF_BAND_TOKEN>"
export RTP_COOKIE_JAR="$(mktemp)"

curl --fail-with-body -sS \
  -c "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$RTP_TRIAL_TOKEN\"}" \
  "$RTP_BASE_URL/api/team-lab/auth"
```

All examples below assume `RTP_BASE_URL` and `RTP_COOKIE_JAR` are set.

## Four-route compatibility surface

| Method | Path | Request | Success |
|---|---|---|---|
| `GET` | `/api/v1/user-info?userId=:userId` | Query parameter | `200` user envelope |
| `POST` | `/api/v1/user-info` | Complete profile JSON | `200` saved user envelope |
| `GET` | `/api/v1/passage?userId=:userId` | Query parameter and required `Idempotency-Key` | `200` passage/session document |
| `POST` | `/api/v1/session` | Complete filled passage document | `201` accepted; exact replay `200` |

### Read and update a profile

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/api/v1/user-info?userId=user_demo_003"
```

Response:

```json
{
  "schemaVersion": "1.0",
  "user": {
    "id": "user_demo_003",
    "readingProfile": {
      "lexileBand": { "min": 400, "target": 500, "max": 600 },
      "fleschKincaidGrade": 2.2,
      "daleChall": 6.2,
      "preferredCategories": ["Lit"],
      "preferredTopics": ["folktales", "kindness"]
    },
    "updatedAt": "2026-08-28T00:00:00.000Z"
  }
}
```

`POST /api/v1/user-info` is an upsert. It can create a new pseudonymous user or
replace the complete matching profile for an existing user:

```bash
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

Profile fields and validation:

| Field | Type and rule |
|---|---|
| `lexileBand.min` | Integer `0..3000`; no greater than target |
| `lexileBand.target` | Integer `0..3000`; between min and max |
| `lexileBand.max` | Integer `0..3000`; no less than target |
| `fleschKincaidGrade` | Finite number `-10..50` |
| `daleChall` | Finite number `0..20` |
| `preferredCategories` | Up to two values: `Lit` and/or `Info` |
| `preferredTopics` | Up to 20 non-empty strings, each at most 80 characters |

### Assign and submit a passage without a client-visible session ID

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'idempotency-key: web-assignment-001' \
  "$RTP_BASE_URL/api/v1/passage?userId=user_demo_003" \
  -o passage.json
```

This `GET` creates an assignment, so `Idempotency-Key` is required. Supply one
stable key per logical assignment and reuse it only for an exact retry; the response header
`x-idempotent-replay` is `false` for the first response and `true` for its
replay. Omitting the header returns `400 IDEMPOTENCY_KEY_REQUIRED`.

The response is the same complete reading document used by the original API,
except it contains `userId` and omits the internal `sessionId` and `childId`.
It also omits `correctIndex`, `isCorrect`, `score`, and `maxScore`, so answer
keys are not exposed to the learner client.
Keep every field and array member. Change only `sessionStatus`, start/finish
timestamps, chunk timing and visits, question answers/timing, and optional
interaction events, then send the complete document:

```bash
# After filling passage.json as described above:
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-binary @passage.json \
  "$RTP_BASE_URL/api/v1/session"
```

The backend resolves its retained assignment, reconstructs immutable content,
and recomputes correctness and score. The receipt deliberately omits both the
internal `sessionId` and `resultId`:

```json
{
  "schemaVersion": "1.0",
  "status": "accepted",
  "receivedAt": "2026-08-28T22:35:11.000Z",
  "summary": {
    "totalActiveReadingMs": 135000,
    "comprehension": { "correct": 2, "possible": 3, "percent": 66.7 },
    "vocabulary": { "correct": 3, "possible": 3, "percent": 100 }
  },
  "analyticsSyncStatus": "pending"
}
```

The first accepted result returns `201`. Replaying the same answers and
behavioral telemetry returns the same receipt with `200`; changing those result
fields after acceptance returns `409 RESULT_CONFLICT`. Immutable presentation
fields are reconstructed from the retained assignment and are not included in
the result fingerprint.

### Synthetic profile seeds

These are synthetic matching targets, not observed student scores.

The ten seed IDs are shared mutable demo fixtures. Teams testing profile writes
should create a namespaced pseudonymous user ID instead of overwriting a seed.

| Seed ID | Lexile min / target / max | FK grade | Dale–Chall | Categories | Topics | Seeded passage result |
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

Passage `2513` is the only currently approved enriched passage and is 500L.
With the seeded profiles, only `user_demo_003` through `user_demo_006` include
500L and select it. The remaining seeds return `422 NO_ELIGIBLE_PASSAGE` until
matching content is approved or their profile is updated.

The stored Flesch–Kincaid and Dale–Chall values are future matching targets.
The current selector remains `band-match-v1`: it hard-filters on approved and
enriched content plus the Lexile band, then ranks unseen passages, category,
topic matches, target-Lexile distance, prior assignment age, and passage ID.
Flesch–Kincaid and Dale–Chall do not currently affect candidate filtering or
ranking; category and topic preferences are soft ranking signals.

### Compatibility responses and errors

Handled errors use `{ "error": { "code", "message", "details?" } }`.

| HTTP | Code | Applies when |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing `userId` or invalid profile/session JSON |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Passage assignment omitted its required key |
| `401` | `TEAM_LAB_AUTH_REQUIRED` | Protected route has no valid trial cookie |
| `401` | `TEAM_LAB_AUTH_INVALID` | Auth exchange token is invalid |
| `404` | `USER_NOT_FOUND` | GET profile/passage uses an unknown user ID |
| `404` | `SESSION_NOT_FOUND` | Submitted facade document cannot be matched to its retained assignment |
| `409` | `IDEMPOTENCY_CONFLICT` | Passage key is reused after the effective profile request changes |
| `409` | `RESULT_CONFLICT` | A changed result is submitted after a result was accepted |
| `422` | `NO_ELIGIBLE_PASSAGE` | No approved enriched passage is inside the Lexile band |
| `422` | `INVALID_RESULT` | Result is incomplete or changes immutable assigned content |

## Original session-ID API

### Select one passage

`POST /api/v1/passages/select`

Required request fields:

```json
{
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
    "topics": ["animals"]
  },
  "excludePassageIds": []
}
```

Only `childId` and `readingBand` are required. The response is exactly one
versioned session document, never an array. It retains the existing `passage`,
`chunks`, `comprehensionQuestions`, and `vocabQuestions` fields and adds:

- `schemaVersion`, `sessionId`, `childId`, `assignedAt`, `sessionStatus`
- `selection`, explaining why the passage was selected
- `passage.contentVersion`
- optional chunk `visits`
- question `chunkId`, `isCorrect`, and `maxScore`
- `interactionEvents` for rereads, pauses/resumes, and word lookups/taps

Category and topic preferences are soft ranking signals. The service falls
back to another eligible passage rather than failing solely because a
preference cannot be met.

Send an `Idempotency-Key` header when retrying. The same child and key returns
the original session. If no eligible enriched passage exists, the API returns
`422 NO_ELIGIBLE_PASSAGE`.

### Return the filled session

`PUT /api/v1/reading-sessions/{sessionId}/result`

Return the same session document with:

- `sessionStatus`: `completed` or `abandoned`
- RFC 3339 UTC `sessionStartedAt` and `sessionFinishedAt`
- chunk `readingTime` values populated with integer milliseconds
- each question's zero-based `answer` and `timeSpentMs`
- optional `interactionEvents`

Allowed interaction types are `word_lookup`, `word_tap`, `pause`, `resume`,
and `reread`. Word interactions require `word` and `chunkId`. The backend
normalizes `word_tap` to the canonical `word_lookup` analytics event. Session
completion/abandonment, chunk completions, scores, and question-answer events
are derived server-side and cannot be supplied as interaction types.

The backend recomputes `isCorrect` and `score`; those client values are never
trusted. A first submission returns `201`. An identical retry returns `200`.
A different second payload for the same session returns `409 RESULT_CONFLICT`.

The browser collects interactions locally while the session is in progress.
`reading_events` is populated only when this result `PUT` is accepted; v1 does
not autosave each click. Completed sessions require every chunk timing and
every question answer. Abandoned sessions may be partial, and unanswered
questions do not produce failed attempts.

The receipt is shaped as follows:

```json
{
  "schemaVersion": "1.0",
  "resultId": "5ebf7f7f-251d-4e25-bca8-b107558d0fb1",
  "sessionId": "c2730309-f8d0-438c-85c2-a78c2e7f9807",
  "status": "accepted",
  "receivedAt": "2026-08-28T20:00:00.000Z",
  "summary": {
    "totalActiveReadingMs": 135000,
    "comprehension": { "correct": 2, "possible": 3, "percent": 66.7 },
    "vocabulary": { "correct": 3, "possible": 3, "percent": 100 }
  },
  "analyticsSyncStatus": "pending"
}
```

This original session-ID route retains `correctIndex` for the existing
hackathon UI. Learner clients should use the four-route facade above, which
omits answer keys and server-scored fields.

### Read child progress

`GET /api/v1/analytics/children/{childId}/progress` returns ClickHouse UTC daily
rollups for comprehension/vocabulary attempts and correctness, active reading
milliseconds, word lookups, abandonments, and CDC freshness. ClickPipes is
eventually consistent; clients should poll after an accepted result.

`CORS_ORIGINS` controls allowed origins and supports comma-separated values,
but it does not turn the hosted `SameSite=Strict` trial cookie into a
cross-origin browser credential. The unset development default accepts the
requesting origin; hosted cross-origin clients should use a backend proxy.
