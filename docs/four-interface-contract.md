# Read to Play: Four-interface contract

Status: proposed v1 frontend contract  
Source: Patricio + John, Granola meeting “Catching up,” August 28, 2026  
Audience: Alexandria/frontend, data, and integration teams

This document turns the four operations agreed in the meeting into concrete HTTP routes and JSON envelopes. The behavior was agreed in the meeting; the exact route names and envelopes below are the data team's proposed v1 spelling.

## Decisions the frontend can rely on

- The demo uses one hard-coded pseudonymous user ID. Authentication is outside this four-interface scope.
- A user profile contains a Lexile band, Flesch–Kincaid grade, and Dale–Chall difficulty. Word count was explicitly removed from the profile.
- Session IDs are created and managed by the backend. The frontend does not receive or return a session ID in this contract.
- The passage call returns one complete reading document. The client retains it and changes only reading telemetry, answer, interaction, and status fields.
- The backend reconstructs immutable content and recomputes correctness and scores; it does not trust client-supplied answer keys or scores.
- A completed session requires all questions. An abandoned session may preserve partial work.
- Keep every submitted interaction event so the Postgres event stream can replicate through ClickPipes to ClickHouse.

Base path: `/api/v1`

## 1. Get one matched passage

```http
GET /api/v1/passage?userId=user_demo_001
Accept: application/json
```

The backend loads the user's reading profile, filters to approved enriched content in range, ranks unseen passages first, and uses category/topic preferences as ranking signals.

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_001",
  "assignedAt": "2026-08-28T22:30:00.000Z",
  "sessionStatus": "assigned",
  "selection": {
    "algorithmVersion": "profile-match-v1",
    "reasonCodes": ["LEXILE_MATCH", "CATEGORY_MATCH"]
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
      "correctIndex": 1,
      "answer": null,
      "isCorrect": null,
      "score": 0,
      "maxScore": 1,
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
      "correctIndex": 0,
      "answer": null,
      "isCorrect": null,
      "score": 0,
      "maxScore": 1,
      "timeSpentMs": null
    }
  ],
  "interactionEvents": []
}
```

The current approved demo document contains six chunks, three comprehension questions, and three vocabulary questions. The current corpus has 4,724 passages, but only passage 2513 is enriched and approved for assignment.

## 2. Save a reading session

```http
POST /api/v1/session
Content-Type: application/json
Idempotency-Key: alex-session-001
```

Send back the complete object returned by the passage endpoint. Preserve immutable fields and array members. Change only session status/timestamps, chunk timing and visits, question answers/timing, and interaction events.

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_001",
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
- Generate one stable `Idempotency-Key` per logical submission and retry the exact serialized body. A changed retry returns a conflict.

## 3. Get user info

```http
GET /api/v1/user-info?userId=user_demo_001
Accept: application/json
```

```json
{
  "schemaVersion": "1.0",
  "user": {
    "id": "user_demo_001",
    "readingProfile": {
      "lexileBand": { "min": 400, "target": 500, "max": 600 },
      "fleschKincaidGrade": 2.1,
      "daleChall": 4.96
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

```json
{
  "schemaVersion": "1.0",
  "userId": "user_demo_001",
  "readingProfile": {
    "lexileBand": { "min": 450, "target": 550, "max": 650 },
    "fleschKincaidGrade": 2.5,
    "daleChall": 5.2
  }
}
```

Success is `200` with the complete updated user object from the GET response.

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

Recommended statuses are 400 for validation, 404 for an unknown user/assignment, 409 for a changed retry, 422 when no passage is eligible, and 503 when an upstream store is unavailable.

## Target-to-current implementation map

| Agreed target | Working API today | Required bridge |
|---|---|---|
| `GET /api/v1/passage` | `POST /api/v1/passages/select` | Read the new `users` table, call existing selection, retain the internal session ID, and return the document without it. |
| `POST /api/v1/session` | `PUT /api/v1/reading-sessions/:sessionId/result` | Resolve the hidden assignment, forward the complete result to existing validation/scoring, and return a receipt without the internal session ID. |
| `GET /api/v1/user-info` | Not implemented | Add the `users` table and read route. |
| `POST /api/v1/user-info` | Not implemented | Add profile validation and update route. |

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
