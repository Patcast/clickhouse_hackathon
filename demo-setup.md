# Readable — Demo Setup

Screen-by-screen plan for the demo. **Bold = must-have** for the demo; **[brackets] = optional / stretch** (build only if time allows). If you fall behind, cut *within* screens (drop the bracketed items) before cutting a whole screen.

| # | Screen | What happens — **must-have** | **[Optional / stretch]** | Tech behind it |
|---|--------|------------------------------|--------------------------|----------------|
| **1** | **Onboarding** - optional | **Friendly character (Sparky) chats with the kid to get basic info; kid answers with tap buttons (Animals / Space / Funny). Then a short placement paragraph + a tiny comprehension quiz → sets starting comprehension & vocab levels.** | **[Kid reads the placement passage *aloud*, scored by speech-to-text]** · **[character speaks / reads its messages out loud]** · **[avatar animation]** | LibreChat (the chat) → writes profile to **Postgres** |
| **2** | **Recommended book opens** | **One book, matched on the axes — comprehension ✓, vocabulary ✓, topic ✓ — with a one-line "why this matches you" and a Start-reading button.** | **[Row of alternate recommendations]** · **[extra axes beyond the two core ones, e.g. theme/preference]** · **[real cover art pulled from Internet Archive]** | **Postgres** (profile) ↔ book labels; matching logic |
| **3** | **Reading** | **Book text on screen; kid can tap any word to ask its meaning; one comprehension check per page; progress bar + streak. Every tap/answer/time-on-page is logged as an event.** | **[Read-aloud toggle — "read this out loud?" — scored by speech-to-text]** · **[tap a word for *pronunciation* / audio, via LibreChat + TTS]** · **[highlight & animations]** | Word-meaning = **LibreChat** · events → **Postgres** |
| **4** | **Reward + unlock** | **"Daily reading done!" + points + streak + a screen-time-unlocked message (scripted in the demo).** | **[Real device-level app-blocking / Steam Deck deploy]** · **[adjustable reward amount]** · **[celebration animation]** | Scripted UI (writes completion event to **Postgres**) |
| **5** | **Teacher dashboard** ⭐ | **Class overview; a "quietly struggling" panel flagging the at-risk kids; drill-down showing a student's two axes trending over time; a live "synced from Postgres 5s ago · CDC" badge and the big event count. This is the climax.** | **[AI insight sentence per student]** · **[class heatmap]** · **[multiple classes / export report]** | **ClickHouse** (analytics), fed by **Postgres → CDC** |
| **6** | **Teacher chat** | *(entire screen is optional)* | **[Teacher asks questions in plain language → answered over the ClickHouse data]** — if built, this earns the **$250 LibreChat bonus** | **LibreChat** → NL query over **ClickHouse** |

## Notes

- **LibreChat shows up in three places** — onboarding (screen 1), word-lookups (screen 3), and the teacher chat (screen 6). Even if we skip the optional teacher chat, screens 1 and 3 already make LibreChat load-bearing, so we're eligible for the bonus without the extra screen.
- **The only truly non-negotiable screens are 1, 2, 3, and 5.** Screen 4 can shrink to a single scripted celebration, and screen 6 is pure upside.

## How we measure reading (the two axes)

We triangulate cheap signals rather than relying on any single one:

- **Implicit behavioral events** (the ClickHouse goldmine): time-on-page vs. passage length, re-reads, word taps, pauses, abandons.
  - Lots of word lookups / mispronounced words → **vocabulary** gap.
  - Slow pace, re-reading, wrong comprehension answers → **comprehension** gap.
- **Comprehension micro-quiz** — 1 question per page/chapter. Directly scores the comprehension axis.
- **Vocabulary tap** — "tap any word you don't know," feeds the vocab axis directly.
- **[Read-aloud / oral reading fluency]** — the flashy stretch (speech-to-text). Ship only if it's solid by mid-afternoon; the three signals above carry the product without it.

The child's measured comprehension & vocabulary levels are scored on the **same scale** used to label books, so matching is a direct comparison.

## Data architecture (OLTP + OLAP)

- **Postgres (OLTP)** — source of truth: users, profiles, book catalog + labels, and every reading interaction written as it happens.
- **ClickHouse (OLAP)** — real-time analytics over millions of events: powers the teacher dashboard, the "quietly struggling" detection, and (stretch) the recommendations.
- **CDC sync** — native Postgres → ClickHouse replication (as low as 5s). Wire the real thing; the live "synced 5s ago" moment is the demo's climax.

**"Why ClickHouse and not just Postgres?"** — Every interaction is a small write, so Postgres is the source of truth. But recommendations and struggle-detection are cohort aggregations over millions of events in real time — row-oriented Postgres chokes on that, columnar ClickHouse does it in milliseconds. We sync between them with the native CDC pipeline.
