# analytics_engine

Ingest API for reading-session data. Everything is stored in **ClickHouse Cloud** —
no Postgres anywhere. Append-only event tables (`MergeTree`) hold sessions, chunk
reads and question answers; mutable student state uses `ReplacingMergeTree`.

Production student app: <https://little-alexandria-student.vercel.app/>

The Vercel deployment serves the student UI from `public/index.html` and routes
its same-origin `POST /api/sessions` request to the Express function. To keep the
public hackathon writer bounded, Vercel accepts only synthetic student `104`,
class `class-4b`, and bundled passage `2513`. Local development and the seed
script retain the full multi-student behavior.

Set the non-secret Vercel variable `STUDENT_WRITES_ENABLED=false` and redeploy
to pause session writes during an abuse incident. The UI remains online,
`/api/health` reports the writer state, and session POSTs return `503`.

## Run

```bash
npm install
npm start          # http://localhost:3001
```

Credentials are read from the repo-root `.env` (see `.env.example`).

## Schema

[`schema.sql`](schema.sql) — apply with the ClickHouse CLI:

```bash
clickhouse client --host <host> --port 9440 --secure --user default --password '<pw>' --queries-file schema.sql
```

Tables:

| table             | grain                       | engine             |
|-------------------|-----------------------------|--------------------|
| `sessions`        | one completed session       | MergeTree          |
| `chunk_events`    | one chunk read              | MergeTree          |
| `question_events` | one question answered       | MergeTree          |
| `students`        | current student state       | ReplacingMergeTree |

## Endpoint

`POST /api/sessions` — body is the `passage_2513.json` contract with the
answers/timings filled in, extended with a `session` block:

```jsonc
{
  "session": {
    "studentId": 104,            // required in the hosted demo
    "classId": "class-4b",       // required
    "studentName": "Diego Santos",
    "grade": 4,
    "startedAt": "2026-08-28T13:00:00Z",
    "finishedAt": "2026-08-28T13:09:12Z",
    "completed": true
  },
  "passage": { "id": 2513, "title": "...", "lexileBand": 500, ... },
  "chunks": [ { "chunkId": 1, "text": "...", "readingTime": { "startedAt": "...", "finishedAt": "...", "durationMs": 12000 } } ],
  "comprehensionQuestions": [ { "questionId": "c1", "axis": "comprehension", "correctIndex": 1, "answer": 1, "timeSpentMs": 9000, ... } ],
  "vocabQuestions": [ { "questionId": "v1", "axis": "vocabulary", "word": "snout", "correctIndex": 2, "answer": 0, "timeSpentMs": 15000, ... } ]
}
```

The server derives everything else: per-chunk word counts, WPM, per-axis scores,
and fan-outs into the three event tables in a single request.

## Seed data

With the server running:

```bash
npm run seed
```

Inserts 8 fake students (each with a distinct reader persona: strong, average,
struggling, guesser, slow-but-accurate, improving, declining, vocab-gap) × 10
sessions over 10 shared passages of increasing difficulty (420L → 690L),
POSTed through the real endpoint. Deterministic RNG, so reseeding reproduces
the same story.
