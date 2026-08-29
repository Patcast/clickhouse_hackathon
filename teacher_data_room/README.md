# teacher_data_room

Teacher-facing dashboard, querying **ClickHouse Cloud** directly (no other database).

Production: <https://little-alexandria-professor.vercel.app/>

The production APIs require `TEAM_LAB_ACCESS_TOKEN` as a Bearer token. The
browser reads that token once from a private URL fragment, stores it only for
the current tab, removes it from the address bar, and attaches it to API calls:

```text
https://little-alexandria-professor.vercel.app/#access_token=<PROFESSOR_MCP_TOKEN>
```

Do not commit or paste the real token into the HTML or this README.

## Run

```bash
npm install
TEAM_LAB_ACCESS_TOKEN=local-only-token npm start  # http://localhost:3002
```

## Views

- **Class view** (`/`) — headline stats, students ranked worst-first with
  comprehension/vocab heat pills, a recent-vs-baseline trend alert per student,
  class accuracy + fluency over time, and the hardest questions across the class
  (item analysis).
- **Student view** (`/student.html?id=<studentId>`) — WPM trend, per-session
  comprehension vs vocabulary accuracy, a speed-vs-accuracy scatter that exposes
  guessing, a vocabulary-gap review list, full session history, and an
  auto-classified reader profile (guesser / careful-and-accurate / needs support /
  ready to level up).

All aggregations run as ClickHouse SQL in [`server.js`](server.js)
(`arraySlice(groupArray(...))` for baseline-vs-recent trends, plain
`GROUP BY` for everything else).
