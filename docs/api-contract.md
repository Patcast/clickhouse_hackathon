# Alexandria API contract (v1)

This contract follows the Granola meeting **Alex** and preserves the existing
`passage_2513.json` keys. Clients must ignore additive fields they do not yet
understand.

## Hosted trial authentication

When `TEAM_LAB_ACCESS_TOKEN` is configured, exchange it once with
`POST /api/team-lab/auth` and JSON `{ "token": "..." }`. Success returns `204`
and an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` cookie. `/health` and
all other `/api/*` routes require that cookie. The hosted trial does not accept
Bearer tokens; a separately deployed browser client must use a server-side
proxy because the cookie is deliberately same-origin.

## Select one passage

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

## Return the filled session

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

`correctIndex` remains in v1 for compatibility with the hackathon UI. A later
student-facing contract should omit answer keys and score entirely server-side.

## Read child progress

`GET /api/v1/analytics/children/{childId}/progress` returns ClickHouse UTC daily
rollups for comprehension/vocabulary attempts and correctness, active reading
milliseconds, word lookups, abandonments, and CDC freshness. ClickPipes is
eventually consistent; clients should poll after an accepted result.

`CORS_ORIGINS` controls allowed origins and supports comma-separated values,
but it does not turn the hosted `SameSite=Strict` trial cookie into a
cross-origin browser credential. The unset development default accepts the
requesting origin; hosted cross-origin clients should use a backend proxy.
