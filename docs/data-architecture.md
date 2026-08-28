# How Little Alexandria is built — the data story

A reading app for kids that turns every reading session into analytics a teacher can act on. Built for the ClickHouse hackathon; the whole point of the project is the data, so this doc follows the data.

## What's used

| Piece | Tech | Job |
|---|---|---|
| **Little Alexandria** (kid app) | Single-file HTML/JS (`read-to-play-app.html`) | The reader: Sparky onboarding, chunked reading, comprehension + vocabulary questions. Captures per-chunk reading time and per-question answer + time |
| **Progress server** | Fastify + TypeScript (`server.ts`, `src/`) | Picks the right passage for a kid from the corpus, serves the web apps |
| **Analytics engine** | Express (`analytics_engine/`), port 3001 | The ingest door: one `POST /api/sessions` that fans a finished session out into ClickHouse tables |
| **Teacher data room** | Express + Chart.js (`teacher_data_room/`), port 3002 | The teacher dashboard: reads ClickHouse, renders class + per-student analytics, writes difficulty adjustments back |
| **Storage** | **ClickHouse Cloud** | All analytics data. No OLTP database in the analytics path |

## How the data flows

```
kid finishes a passage in Little Alexandria
        │  one JSON payload: session + chunks[] + questions[]
        ▼
analytics_engine  POST /api/sessions
        │  derives wpm, correctness, word counts…
        ▼
ClickHouse Cloud ──── 4 event/state tables (below)
        ▲                                   │
        │  INSERT (difficulty targets)      │  SELECT (aggregations)
        │                                   ▼
teacher_data_room  ◄──── teacher opens dashboard, drills into a student,
                          and adjusts that student's difficulty sliders
```

1. **Capture.** While a kid reads, the app records when each text chunk was opened and finished (fluency), and for each question which option was chosen and how long it took (accuracy + behavior — fast-and-wrong = guessing).
2. **Ingest.** On completion, the app sends one JSON payload. The analytics engine derives the metrics (words per minute from chunk timings, is_correct per question) and inserts rows into ClickHouse — a session summary row, one row per chunk, one row per question, and an upsert of the student.
3. **Analyze.** The teacher data room runs ClickHouse aggregations live on request: class overview sorted by who needs help, per-day accuracy/fluency trends, Lexile level growth (last-20 vs first-20 sessions), hardest questions across the class, per-student vocabulary gap lists.
4. **Act.** From a student's page the teacher adjusts three difficulty targets (see below). That writes a new row to ClickHouse; the latest row per student wins.

## How the data is stored

Everything lives in ClickHouse (`analytics_engine/schema.sql`), in two patterns:

**Append-only event tables (MergeTree)** — facts never change, so rows are only inserted, partitioned by month, ordered for the dashboard's access pattern `(class_id, student_id, time)`:

| Table | Grain | Powers |
|---|---|---|
| `sessions` | one row per completed reading session | WPM trends, accuracy trends, level growth |
| `chunk_events` | one row per text chunk read | fluency at paragraph level |
| `question_events` | one row per question answered | comprehension vs vocabulary split, guessing detection (time × correctness), hardest-question item analysis, vocabulary gap words |

**Mutable state tables (ReplacingMergeTree)** — the few things that do change are stored as "insert a new version, latest `updated_at` wins", read with `FINAL`:

| Table | Holds |
|---|---|
| `students` | roster: name, class, grade, current Lexile band |
| `student_difficulty` | the teacher's three per-student difficulty targets |

The three difficulty targets map straight onto the dataset's readability axes:

- `fk_grade_max` — **syntax ceiling** (Flesch-Kincaid grade: sentence complexity)
- `dale_chall_max` — **vocabulary ceiling** (Dale-Chall: unfamiliar-word load)
- `bt_easiness_min` — **easiness floor** (BT_easiness: human-judged difficulty)

## The dataset: CLEAR corpus

We use the **CLEAR corpus** (CommonLit Ease of Readability): **4,724 English excerpts of 125–205 words**, split ~50/50 between literary and informational texts. Full field reference in [dataset_reference.md](../dataset_reference.md).

Why it's great for this project:

1. **Human-judged difficulty, not just formulas.** Every excerpt has `BT_easiness`, a Bradley-Terry score distilled from thousands of pairwise "which is easier?" judgments by real teachers. That's a ground-truth difficulty signal most corpora simply don't have.
2. **Difficulty is multi-axis — and that's our whole pitch.** Flesch-Kincaid measures *sentence complexity* while Dale-Chall measures *vocabulary load*, and two passages at the same Lexile band can diverge on them. A kid failing a vocab-hard/syntax-easy passage has a vocabulary gap, not a comprehension problem. The app's separate comprehension and vocabulary questions detect exactly the distinction the corpus lets us serve.
3. **Kid-safe and licensed.** Every excerpt carries a movie-style content-maturity rating (we filter to **G**) and license metadata (public-domain and CC BY are safe to show with attribution).
4. **Ready-to-read length.** 125–205 words is one comfortable session for an early reader — no chopping needed; each excerpt maps to one Little Alexandria passage.

One caveat we design around: the corpus skews hard (mean grade ~9.5), so we filter to roughly Lexile ≤ 900 / FK ≤ 6 — which still leaves ~1,000 kid-appropriate candidates.
