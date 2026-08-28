# Managed Postgres inventory

Read-only discovery snapshot refreshed on **2026-08-28 at 21:59:29 UTC**. Counts are point-in-time trial data; corpus distributions and schema are stable until the next import or migration.

## At a glance

- 3 public tables; no Postgres views or materialized views
- 4,724 passages (about 6.6 MB)
- 1 passage currently enriched, rights-approved, and selectable
- 6 chunks, 3 comprehension questions, and 3 vocabulary questions in that enriched passage
- 7 trial sessions and 37 append-only reading events at snapshot time

## Tables

### `passages`

One row per imported CLEAR passage. It holds source metadata, raw excerpt text, readability measures, rights review, and optional enriched assignment content.

```text
passage_id                integer primary key
author                    text
title                     text
anthology                 text
source_url                text
publication_year          integer
category                  text: Lit | Info
subcategory               text
lexile_raw                text
lexile_band               integer
source_location           text
license                   text
maturity_rating           text
excerpt                    text
word_count                integer
sentence_count            integer
paragraph_count           integer
bt_easiness               double precision
flesch_reading_ease       double precision
flesch_kincaid_grade      double precision
dale_chall                double precision
rights_status             text: unreviewed | approved | blocked
enriched_document         jsonb
content_version           text
source_content_hash       text
imported_at               timestamptz
```

`enriched_document` contains the complete reviewed content package:

```text
passage
chunks[]
comprehensionQuestions[]
vocabQuestions[]
```

### `reading_sessions`

One row per assignment. It is the transactional source for idempotency and accepted results.

```text
session_id                uuid primary key
child_id                  text
passage_id                integer -> passages
idempotency_key           text
request_hash              text
requested_band            jsonb
requested_preferences     jsonb
response_document         jsonb
status                    text: assigned | completed | abandoned
assigned_at               timestamptz
session_started_at        timestamptz
session_finished_at       timestamptz
submission_hash           text
result_id                 uuid
result_summary            jsonb
raw_submission            jsonb
result_received_at        timestamptz
```

The unique `(child_id, idempotency_key)` constraint makes selection retries deterministic.

### `reading_events`

Append-only derived telemetry and the only table replicated to ClickHouse by ClickPipes.

```text
event_id                  uuid primary key
occurred_at               timestamptz
ingested_at               timestamptz
child_id                  text
session_id                uuid -> reading_sessions
passage_id                integer -> passages
event_type                text
axis                      text: comprehension | vocabulary | null
chunk_id                  integer
question_id               text
word                      text
answer_index              integer
is_correct                boolean
score                     double precision
duration_ms               integer
payload                    jsonb
```

A database trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE` on this table. Corrections must be new compensating events.

## Passage corpus

### Coverage

| Measure | Count |
|---|---:|
| Passages | 4,724 |
| Distinct titles | 4,657 |
| Distinct authors | 2,401 |
| Distinct anthologies | 289 |
| Publication years | 168 |
| Publication-year range | 1728–2020 |

### Category

| Category | Passages | Share |
|---|---:|---:|
| Literary (`Lit`) | 2,420 | 51.23% |
| Informational (`Info`) | 2,304 | 48.77% |

### Maturity

| Rating | Count |
|---|---:|
| G | 3,706 |
| PG | 928 |
| PG-13 | 87 |
| R | 3 |

### Source location

| Location | Count |
|---|---:|
| Middle | 3,470 |
| Start | 1,024 |
| Whole | 122 |
| End | 108 |

### Subcategory

| Subcategory | Count |
|---|---:|
| Missing | 4,139 |
| Science | 223 |
| Technology | 193 |
| History | 165 |
| AutoBio | 2 |
| Bio | 2 |

### Numeric descriptive statistics

| Measure | Min | P25 | Median | Mean | Std. dev. | P75 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Words | 129 | 160 | 175 | 173.34 | 17.00 | 188 | 205 |
| Sentences | 2 | 7 | 8 | 9.57 | 4.64 | 11 | 41 |
| Paragraphs | 1 | 1 | 2 | 2.54 | 1.87 | 3 | 20 |
| Lexile | 100 | 900 | 1,100 | 1,049.92 | 282.52 | 1,300 | 1,900 |
| BT easiness | -3.68 | -1.70 | -0.91 | -0.96 | 1.03 | -0.20 | 1.71 |
| Flesch ease | -28.99 | 53.63 | 66.33 | 65.23 | 18.18 | 78.65 | 114.03 |
| FK grade | -1.04 | 6.56 | 9.35 | 9.51 | 4.33 | 11.97 | 42.64 |
| Dale-Chall | 0.28 | 6.56 | 7.63 | 7.67 | 1.94 | 8.87 | 14.19 |

### Lexile distribution

| Band | Count |
|---:|---:|
| 100 | 3 |
| 300 | 41 |
| 500 | 382 |
| 700 | 492 |
| 900 | 815 |
| 1,100 | 1,379 |
| 1,300 | 1,359 |
| 1,500 | 186 |
| 1,700 | 58 |
| 1,900 | 9 |

Flesch-Kincaid grade grouping:

| Range | Count |
|---|---:|
| Below grade 3 | 213 |
| Grades 3–5.9 | 777 |
| Grades 6–8.9 | 1,192 |
| Grades 9–11.9 | 1,366 |
| Grade 12+ | 1,176 |

### Metadata completeness

Every passage has an ID, author, title, excerpt, category, Lexile, word/sentence/paragraph count, maturity rating, and all four readability measures.

| Field | Populated | Missing |
|---|---:|---:|
| Anthology | 2,712 | 2,012 |
| License | 1,405 | 3,319 |
| Subcategory | 585 | 4,139 |
| Source URL | 4,712 | 12 |
| Publication year | 4,715 | 9 |
| Enriched document | 1 | 4,723 |

Major license values:

| License | Count |
|---|---:|
| Missing | 3,319 |
| CC BY 4.0 | 694 |
| CC BY-SA 3.0 | 306 |
| CC BY-SA 3.0 + GFDL | 274 |
| CC BY-NC-SA 2.0 | 74 |

Missing license metadata must not be interpreted as approval or public-domain status.

## Assignment-ready content funnel

| Gate | Passages |
|---|---:|
| G-rated | 3,706 |
| Lexile <= 900 | 1,733 |
| G-rated and Lexile <= 900 | 1,402 |
| Above plus FK grade <= 6 | 804 |
| Above plus license and source URL | 332 |
| Enriched and rights-approved | **1** |

The current selection endpoint therefore returns passage `2513` when the requested band includes its Lexile 500 and it is not excluded. The other 4,723 rows are `unreviewed` and have no enriched document; there are no blocked rows.

## Questions and answers

Questions are **not normalized into separate relational tables**.

The one enriched passage contains:

- 3 comprehension questions
- 3 vocabulary questions
- 4 options per question (24 option strings total)
- 6 zero-based `correctIndex` answer keys
- template `answer`, `isCorrect`, and `timeSpentMs` values initially set to null

Each assignment copies that structure into `reading_sessions.response_document`.

Answers then appear in two places:

1. `reading_sessions.raw_submission` retains the complete returned JSON document.
2. Each answered question becomes a `reading_events` row with `answer_index`, `is_correct`, `score`, `duration_ms`, `axis`, and `question_id`.

At snapshot time, five result submissions contained 12 answered questions: eight correct and four incorrect. Both comprehension and vocabulary were 4/6 correct (66.67%), and median answer time was 1,350 ms. Across submitted documents, each axis had 15 question instances: six answered and nine unanswered. Unanswered abandoned questions did not create question-answer events.

The stored assignment retains `correctIndex` for server-side scoring and the
original hackathon UI. The live four-route learner facade now strips answer
keys and server-scored fields from its response.

## Trial activity at snapshot time

Sessions:

- 7 total across 4 pseudonymous child IDs
- 2 assigned, 2 completed, 3 abandoned
- 5 stored result submissions
- all used passage 2513

Events:

| Event type | Count |
|---|---:|
| `chunk_completed` | 12 |
| `question_answer` | 12 |
| `pause` | 2 |
| `resume` | 2 |
| `reread` | 2 |
| `word_lookup` | 2 |
| `session_completed` | 2 |
| `session_abandoned` | 3 |

There were no orphan sessions, orphan events, or event/session identity mismatches.

## Integrity and indexes

- Primary keys on passage, session, and event IDs
- Foreign keys from sessions to passages and events to sessions/passages
- Unique `(child_id, idempotency_key)` assignment key
- Checks for category, status, axis, and nonnegative duration
- Partial passage-selection index over approved enriched passages
- Child-history and child-event-time indexes
- Session/event-type index
- Append-only mutation-prevention trigger on `reading_events`

Schema source: [`db/postgres/001_init.sql`](../db/postgres/001_init.sql). Selection behavior: [`src/postgres-repository.ts`](../src/postgres-repository.ts). Question validation: [`src/contract.ts`](../src/contract.ts). Event derivation: [`src/scoring.ts`](../src/scoring.ts).
