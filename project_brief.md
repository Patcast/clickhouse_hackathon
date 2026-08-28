# Read to Play — Hackathon Project Brief

**Track:** Kids that can't read (the reading crisis)
**Stack requirement:** ClickHouse (OLAP) + Postgres (OLTP)
**Demo centerpiece:** Kid reading app running on a Steam Deck; finishing the daily reading challenge unlocks the Deck's games.

## One-liner

A Steam Deck that won't play games until you've read: a gamified reading app matches each kid to books on multiple axes (comprehension, vocabulary, preferences), and every interaction streams into ClickHouse so teachers can see in real time who is struggling — and whether the gap is comprehension or vocabulary.

## Core insight (the pitch)

Books today are rated on one dimension (reading level). That can't distinguish a kid who decodes fine but doesn't comprehend from a kid who comprehends but lacks vocabulary — same score, opposite interventions. Our challenges *are* the diagnostic: comprehension quizzes and vocabulary mini-games generate per-axis signals on every answer.

Demo line: "Maya finishes fast but fails comprehension questions; Leo understands everything but stumbles on vocabulary — same reading level on paper, opposite interventions."

## Architecture

- **Postgres (OLTP):** child profiles, book catalog + multi-axis labels, daily challenge state, `unlocked` flag per device.
- **ClickHouse (OLAP):** reading event stream — quiz answers, time-per-question, retries, pages read, abandonment. Teacher dashboard aggregates run here.
- **Kid app:** web app, runs in the Deck's browser (added as a non-Steam "game" in Game Mode). Duolingo-style: streaks, scoring, celebration animations.
- **Deck unlock agent:** small script/systemd service polling the API for the `unlocked` flag. Demo version: kiosk/launcher screen with the game library greyed out until the flag flips, then launches Steam. (Do not attempt real SteamOS game-blocking in one day.)
- **Teacher dashboard:** 2–3 live charts over ClickHouse (who's slipping, comprehension-vs-vocab breakdown, reading time/completion trends).

## Decisions made

- **Challenge verification:** LLM-generated comprehension quiz + vocabulary mini-game per passage. Each answer is a labeled event feeding the two axes. No speech/read-aloud (too risky for one day).
- **Book data:** batch-label 30–50 short public-domain passages (Project Gutenberg / Open Library) with an LLM before the demo; store labels in Postgres. Generate synthetic event history for ~25 fake students so the dashboard is alive at demo start.
- **Events pipeline:** app writes events directly to ClickHouse. No CDC/Kafka — not in one day.

## Build order

1. Postgres schema + seed script (books, labels, kids, synthetic profiles)
2. Kid web app: pick book → read passage → quiz/vocab game → celebration → flip `unlocked` flag
3. Event writes into ClickHouse + synthetic event generator for fake students
4. Teacher dashboard (2–3 charts, live)
5. Steam Deck unlock agent (last — most mockable piece)

## Open items

- Team size / role split for the day
- Which charts make the teacher dashboard (suggest: "kids slipping this week", per-kid comprehension-vs-vocab radar, completion vs. abandonment by book)
- Exact unlock UX on the Deck (kiosk launcher vs. simple lock screen)
