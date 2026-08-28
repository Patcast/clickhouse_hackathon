# Read to Play: Four-interface contract

Status: live on the hosted production API
Source: Patricio + John, Granola meeting “Catching up,” August 28, 2026  
Audience: Alexandria/frontend, data, and integration teams

This document defines the implemented compatibility routes and JSON envelopes for the four operations agreed in the meeting. The original session-ID routes remain available and are documented in `docs/api-contract.md`.

## Base URL and authentication

```bash
# Hosted production origin.
export RTP_BASE_URL="https://read-to-play-alex.vercel.app"
# Local branch checkout: export RTP_BASE_URL="http://127.0.0.1:3000"

export RTP_TRIAL_TOKEN="<SHARED_OUT_OF_BAND_TOKEN>"
export RTP_COOKIE_JAR="$(mktemp)"
curl --fail-with-body -sS \
  -c "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$RTP_TRIAL_TOKEN\"}" \
  "$RTP_BASE_URL/api/team-lab/auth"
```

`SHARED_OUT_OF_BAND_TOKEN` is not needed to resolve the endpoint. When the trial is protected, it is exchanged for an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie; it is not a Bearer token and must not be placed in a query string. The exchange returns `204`. Send the cookie on every `/health` and `/api/*` call. A separate-origin browser must call its own same-origin backend/server proxy, which performs the exchange, retains the upstream cookie, and includes it on API calls. Never embed the shared token in browser code.

## Decisions the frontend can rely on

- The branch seeds ten pseudonymous users, `user_demo_001` through `user_demo_010`.
- A user profile contains a Lexile band, Flesch–Kincaid grade, Dale–Chall difficulty, category preferences, and topic preferences. Word count was explicitly removed from the profile.
- Session IDs are created and managed by the backend. The frontend does not receive or return a session ID in this contract.
- The passage call returns one complete reading document. The client retains it and changes only reading telemetry, answer, interaction, and status fields.
- The backend reconstructs immutable content and recomputes correctness and scores; it does not trust client-supplied answer keys or scores.
- A completed session requires all questions. An abandoned session may preserve partial work.
- Keep every submitted interaction event so the Postgres event stream can replicate through ClickPipes to ClickHouse.

Base path: `/api/v1`

## 1. Get one matched passage

```http
GET /api/v1/passage?userId=user_demo_003
Accept: application/json
Idempotency-Key: web-assignment-001
```

Copyable call:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'idempotency-key: web-assignment-001' \
  "$RTP_BASE_URL/api/v1/passage?userId=user_demo_003" \
  -o passage.json
```

This GET creates an assignment. Reuse one stable `Idempotency-Key` only for an exact retry; `x-idempotent-replay` is `false` initially and `true` on replay. Omitting the header causes the server to generate a key, so another GET creates another assignment.

The backend loads the user's reading profile, hard-filters to approved enriched content in its Lexile range, ranks unseen passages first, and uses category/topic preferences as ranking signals.

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_003",
  "assignedAt": "2026-08-28T22:30:00.000Z",
  "sessionStatus": "assigned",
  "selection": {
    "algorithmVersion": "band-match-v1",
    "requestedReadingBand": {
      "system": "lexile",
      "min": 400,
      "target": 500,
      "max": 600
    },
    "reasonCodes": ["READING_BAND_MATCH", "CATEGORY_PREFERENCE_MATCH"],
    "reasonText": "A story near your reading level."
  },
  "passage": {
    "id": 2513,
    "contentVersion": "sha256:bcd88a209ee9d2b88ee6cf4245d401eee2eb58289ea127dc91bbd48a3cff3837",
    "title": "No Pigs Allowed",
    "author": "Basilio Gimo and Little Zebra Books",
    "source": "African Storybook Level 4",
    "license": "CC BY 4.0",
    "category": "Lit",
    "lexileBand": 500,
    "fleschKincaidGrade": 2.12,
    "daleChall": 4.96,
    "wordCount": 200,
    "coverImageUrl": null
  },
  "chunks": [
    {
      "chunkId": 1,
      "text": "...",
      "readingTime": {
        "startedAt": null,
        "finishedAt": null,
        "durationMs": null
      },
      "visits": []
    }
  ],
  "comprehensionQuestions": [
    {
      "questionId": "c1",
      "chunkId": 2,
      "axis": "comprehension",
      "prompt": "...",
      "options": ["...", "..."],
    "answer": null,
    "timeSpentMs": null
    }
  ],
  "vocabQuestions": [
    {
      "questionId": "v1",
      "chunkId": 1,
      "axis": "vocabulary",
      "word": "horned",
      "imageUrl": null,
      "prompt": "...",
      "options": ["...", "..."],
    "answer": null,
    "timeSpentMs": null
    }
  ],
  "interactionEvents": []
}
```

The facade omits answer keys and server-scored fields (`correctIndex`, `isCorrect`, `score`, and `maxScore`). The current approved demo document contains six chunks, three comprehension questions, and three vocabulary questions. The current corpus has 4,724 passages, but only passage 2513 is enriched and approved for assignment. It is 500L, so the seeded `user_demo_003` through `user_demo_006` profiles work; `user_demo_001` currently returns `422 NO_ELIGIBLE_PASSAGE`.

## 2. Save a reading session

```http
POST /api/v1/session
Content-Type: application/json
```

Send back the complete object returned by the passage endpoint. Preserve immutable fields and array members. Change only session status/timestamps, chunk timing and visits, question answers/timing, and interaction events.

Copyable call after filling the complete `passage.json` document:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-binary @passage.json \
  "$RTP_BASE_URL/api/v1/session"
```

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_003",
  "assignedAt": "2026-08-28T22:30:00.000Z",
  "sessionStatus": "completed",
  "sessionStartedAt": "2026-08-28T22:30:10.000Z",
  "sessionFinishedAt": "2026-08-28T22:35:10.000Z",
  "passage": { "id": 2513, "contentVersion": "sha256:bcd88a..." },
  "chunks": [
    {
      "chunkId": 1,
      "readingTime": {
        "startedAt": "2026-08-28T22:30:10.000Z",
        "finishedAt": "2026-08-28T22:30:30.000Z",
        "durationMs": 20000
      },
      "visits": [
        {
          "visitId": "visit-1",
          "startedAt": "2026-08-28T22:30:10.000Z",
          "finishedAt": "2026-08-28T22:30:30.000Z",
          "durationMs": 20000
        }
      ]
    }
  ],
  "comprehensionQuestions": [
    { "questionId": "c1", "answer": 1, "timeSpentMs": 5000 }
  ],
  "vocabQuestions": [
    { "questionId": "v1", "answer": 0, "timeSpentMs": 4000 }
  ],
  "interactionEvents": [
    {
      "eventId": "lookup-1",
      "type": "word_lookup",
      "occurredAt": "2026-08-28T22:31:00.000Z",
      "chunkId": 1,
      "word": "horned"
    }
  ]
}
```

Success:

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

Rules:

- `sessionStatus` is `completed` or `abandoned`.
- Both statuses require RFC 3339 start/finish timestamps.
- Completed sessions require timing for every chunk and an answer plus `timeSpentMs` for every question.
- Abandoned sessions may contain partial timings and answers. Unanswered questions are not failed attempts.
- Answers are zero-based option indexes.
- All assigned chunk/question IDs must remain present exactly once.
- Allowed interactions are `word_lookup`, `word_tap`, `pause`, `resume`, and `reread`.
- Answers, timings, status, and behavioral events form the submission's idempotency identity. Replaying those same fields succeeds; changing them after acceptance returns `409 RESULT_CONFLICT`. Immutable presentation fields are reconstructed server-side and ignored for this fingerprint.
- The first accepted submission returns `201`; an exact replay returns the same receipt with `200`.

## 3. Get user info

```http
GET /api/v1/user-info?userId=user_demo_001
Accept: application/json
```

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  "$RTP_BASE_URL/api/v1/user-info?userId=user_demo_001"
```

```json
{
  "schemaVersion": "1.0",
  "user": {
    "id": "user_demo_001",
    "readingProfile": {
      "lexileBand": { "min": 200, "target": 300, "max": 400 },
      "fleschKincaidGrade": 1.0,
      "daleChall": 5.2,
      "preferredCategories": ["Lit"],
      "preferredTopics": ["animals", "friendship"]
    },
    "updatedAt": "2026-08-28T22:00:00.000Z"
  }
}
```

## 4. Update user info

```http
POST /api/v1/user-info
Content-Type: application/json
```

Copy the complete JSON body below into `user-profile.json`, then:

```bash
curl --fail-with-body -sS \
  -b "$RTP_COOKIE_JAR" \
  -H 'content-type: application/json' \
  --data-binary @user-profile.json \
  "$RTP_BASE_URL/api/v1/user-info"
```

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_001",
  "readingProfile": {
    "lexileBand": { "min": 450, "target": 550, "max": 650 },
    "fleschKincaidGrade": 2.5,
    "daleChall": 5.2,
    "preferredCategories": ["Lit"],
    "preferredTopics": ["animals", "friendship"]
  }
}
```

Success is `200` with the complete updated user object from the GET response.

This route is an upsert: it creates an unknown pseudonymous ID or replaces the complete profile for an existing ID.

## Synthetic profile seeds and current selection behavior

These are synthetic matching targets, not observed student scores.

The seed IDs are shared mutable demo fixtures. Integration teams should create a namespaced pseudonymous ID before testing profile writes so they do not overwrite another team's setup.

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

Only passage `2513` is currently approved and enriched, and it is 500L. With seeded values, only `user_demo_003` through `user_demo_006` include 500L and select it. The other seeds still work with both user-info routes but return `422 NO_ELIGIBLE_PASSAGE` from the passage route until matching content is approved or their profile changes.

Flesch–Kincaid and Dale–Chall are stored and returned as future matching targets. They do not yet affect filtering or ranking. The algorithm remains `band-match-v1`: approved/enriched status and Lexile band are hard filters; unseen history, category, topics, target-Lexile distance, assignment age, and passage ID provide the ranking. Category and topic preferences are soft signals.

## Errors

Handled errors use one envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Implemented error cases:

| HTTP | Code | Meaning |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing `userId` or invalid profile/session JSON |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Passage assignment omitted its required key |
| `401` | `TEAM_LAB_AUTH_REQUIRED` | Protected route has no valid trial cookie |
| `401` | `TEAM_LAB_AUTH_INVALID` | Auth exchange token is invalid |
| `404` | `USER_NOT_FOUND` | Unknown user on profile read or passage assignment |
| `404` | `SESSION_NOT_FOUND` | Submitted facade document cannot be matched to its retained assignment |
| `409` | `IDEMPOTENCY_CONFLICT` | Passage key reused after the effective request changes |
| `409` | `RESULT_CONFLICT` | Changed result submitted after a result was accepted |
| `422` | `NO_ELIGIBLE_PASSAGE` | No approved enriched passage is in the Lexile band |
| `422` | `INVALID_RESULT` | Result is incomplete or changes immutable content |

## Compatibility-to-original implementation map

| Compatibility route | Reused original capability | Implemented bridge |
|---|---|---|
| `GET /api/v1/passage` | `POST /api/v1/passages/select` | Implemented on branch: reads `users`, assigns through the existing selector, retains the internal session ID, and returns `userId` without `sessionId` or `childId`. |
| `POST /api/v1/session` | `PUT /api/v1/reading-sessions/:sessionId/result` | Implemented on branch: resolves the hidden assignment, uses existing validation/scoring, and omits internal `sessionId` and `resultId` from the receipt. |
| `GET /api/v1/user-info` | Postgres `users` / in-memory seed store | Implemented on branch: returns the complete profile envelope. |
| `POST /api/v1/user-info` | Postgres `users` / in-memory seed store | Implemented on branch: validates and upserts the complete profile. |

The existing `GET /api/v1/analytics/children/:childId/progress` remains an optional analytics extension; it is not one of Patricio's four requested interfaces.

## Persistence note

The current browser accumulates clicks, timers, lookups, and answers locally. Postgres receives the derived event batch only when Complete or Abandon succeeds. Closing the tab first loses in-progress telemetry. True click-by-click durability requires a separate ingestion/autosave design and is not implicit in these four interfaces.

## Data ownership

- `users` (new): learner matching profile.
- `passages`: corpus metadata and `enriched_document` JSONB containing approved chunks, questions, options, answer keys, and vocabulary metadata.
- `reading_sessions`: assigned document snapshot, raw submission, result summary, status, and idempotency records.
- `reading_events`: append-only normalized event stream replicated by ClickPipes.
- ClickHouse: derived UTC daily progress and CDC freshness analytics.

Postgres is the transactional source of truth. The application does not dual-write to ClickHouse.
