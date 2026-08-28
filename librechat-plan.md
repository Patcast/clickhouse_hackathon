# LibreChat — plan to get it actually working

Goal: a real, running LibreChat doing a real job in the demo, so we can honestly claim we built with it (and qualify for the $250 bonus).

**Guiding decision:** don't try to call LibreChat's backend from the app as step one. LibreChat is built as an end-user chat application, not a clean third-party API — programmatic access means dealing with its auth and CORS, and that's a bad thing to discover at 3pm. This is a ladder: every rung is demo-able on its own. Stop climbing when time runs out.

## Current state

LibreChat is **not** doing anything yet. In `read-to-play-app.html` there are two labelled hooks:

- `LIBRECHAT_ENDPOINT` — Sparky's onboarding turns. Falls back to the hardcoded `SPARKY_SCRIPT`.
- `DEFINITIONS` — word lookups. A hand-written map of nine words, no endpoint hook yet.

⚠️ The onboarding footer currently reads "Sparky runs on LibreChat", which is not true yet. Either reach Phase 3 or change that text — don't leave a claim on screen a judge can poke.

## Phase 1 — Get LibreChat running (~30 min) — THE GATE

Nothing else matters until this is up.

```bash
git clone https://github.com/danny-avila/LibreChat.git
cd LibreChat && cp .env.example .env
# put one LLM provider key in .env (Anthropic or OpenAI — whichever we have)
docker compose up -d
```

Open `http://localhost:3080`, register an account, send a message.

**Checkpoint:** we can chat. From this moment we have honestly deployed LibreChat.

## Phase 2 — Sparky as a real LibreChat agent (~30 min, zero dependencies)

In the LibreChat UI, create an **Agent** (or custom preset) called Sparky with a system prompt encoding what we actually need:

> You explain words to a 7–9 year old who is reading. Given a word and the sentence it appeared in, reply with one short sentence a child would understand, using the meaning that fits *that* sentence. No jargon, no more than 15 words.

Test it: `word: "cousin", sentence: "a blue whale will sing a different song from his cousin in the Pacific."` → it should say a relative whale, not a human relative.

**Why this rung matters:** no dependency on ClickHouse, John's endpoint, or anything else on the critical path. It works even if everything else slips.

## Phase 3 — Let the kid app actually call it (~45 min) — THE TARGET

The browser can't hold LibreChat credentials and CORS will block a direct call, so put a **tiny proxy** in between: one small Node/Express service that holds the auth, takes `{word, sentence}`, forwards to the Sparky agent, and returns a one-line definition with a permissive CORS header.

Then it's one line in the app: point the word lookup at `http://localhost:<proxy-port>/lookup`.

App side gets: real async call, a "Sparky's thinking…" state, and a **fallback to the local definitions on timeout or error**, so a flaky network can never break the demo on stage.

At this point, tapping any word in the book is a live LibreChat call — *"tap any word, any word at all"* becomes a true statement.

## Phase 4 — Stretch only: teacher chat over ClickHouse

If Phases 1–3 land early: LibreChat supports **MCP servers**. John exposes 2–3 ClickHouse queries as tools, configured in `librechat.yaml`, and the teacher asks "who's quietly struggling this week?" directly in LibreChat. Strongest possible story, but depends on ClickHouse being up — bonus, not plan.

## Time-boxing

- **Phase 1 not working ~1 hour in** → stop, ask at the expert bar, don't grind alone.
- **Phase 3 not working by 3pm** → freeze. Demo Phases 1–2: LibreChat running with the Sparky agent answering a real word lookup live, and say plainly the app call is wired but not yet pointed at it. Honest, and still counts.

## What to say to judges

> "LibreChat is self-hosted in Docker with a Sparky agent. Every word a child taps in the book goes to it live, in the sentence's context, and comes back at their reading level — that's not a lookup table, it can't be."

## Open questions

- Do we have Docker Desktop installed and an LLM API key handy?
- Who owns this task? (Parallelizes well with the data work.)
- Is ClickHouse up yet? Decides whether Phase 4 is real.
