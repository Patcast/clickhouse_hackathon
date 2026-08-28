const interfaces = [
  {
    number: '01',
    method: 'GET',
    path: '/api/v1/passage?userId={userId}',
    title: 'Choose a passage',
    description:
      'Load the learner profile, select one matched passage, and return the complete reading document.',
    status: 'Live',
  },
  {
    number: '02',
    method: 'POST',
    path: '/api/v1/session',
    title: 'Save the session',
    description:
      'Return the passage document with reading, answer, and interaction fields filled. The backend creates its internal session ID.',
    status: 'Live',
  },
  {
    number: '03',
    method: 'GET',
    path: '/api/v1/user-info?userId={userId}',
    title: 'Read a learner profile',
    description:
      'Retrieve the Lexile band, Flesch–Kincaid grade, and Dale–Chall difficulty used for matching.',
    status: 'Live',
  },
  {
    number: '04',
    method: 'POST',
    path: '/api/v1/user-info',
    title: 'Update a learner profile',
    description:
      'Let a professor or demo operator update the complete matching profile for a pseudonymous user.',
    status: 'Live',
  },
];

const liveApp = 'https://read-to-play-alex.vercel.app';
const repository =
  'https://github.com/Patcast/clickhouse_hackathon/tree/codex-alex-api';
const contractArtifact =
  'https://claude.ai/code/artifact/24ba5366-8d2d-4ec7-8feb-3e79ee299c42';

const getPassageExample = `GET /api/v1/passage?userId=user_demo_003
Accept: application/json
Idempotency-Key: alexandria-assignment-001`;

const getPassageResponse = `{
  "schemaVersion": "1.0",
  "userId": "user_demo_003",
  "assignedAt": "2026-08-28T22:30:00.000Z",
  "sessionStatus": "assigned",
  "selection": {
    "algorithmVersion": "band-match-v1",
    "reasonCodes": ["READING_BAND_MATCH", "CATEGORY_PREFERENCE_MATCH"]
  },
  "passage": {
    "id": 2513,
    "contentVersion": "sha256:bcd88a…",
    "title": "No Pigs Allowed",
    "author": "Basilio Gimo and Little Zebra Books",
    "source": "African Storybook Level 4",
    "license": "CC BY 4.0",
    "category": "Lit",
    "lexileBand": 500,
    "fleschKincaidGrade": 2.12,
    "daleChall": 4.96,
    "wordCount": 200
  },
  "chunks": [{
    "chunkId": 1,
    "text": "…",
    "readingTime": {
      "startedAt": null,
      "finishedAt": null,
      "durationMs": null
    },
    "visits": []
  }],
  "comprehensionQuestions": [{
    "questionId": "c1",
    "chunkId": 2,
    "prompt": "…",
    "options": ["…", "…"],
    "answer": null,
    "timeSpentMs": null
  }],
  "vocabQuestions": [{
    "questionId": "v1",
    "word": "horned",
    "imageUrl": null,
    "prompt": "…",
    "options": ["…", "…"],
    "answer": null,
    "timeSpentMs": null
  }],
  "interactionEvents": []
}`;

const postSessionExample = `POST /api/v1/session
Content-Type: application/json

{
  "schemaVersion": "1.0",
  "userId": "user_demo_003",
  "assignedAt": "2026-08-28T22:30:00.000Z",
  "sessionStatus": "completed",
  "sessionStartedAt": "2026-08-28T22:30:10.000Z",
  "sessionFinishedAt": "2026-08-28T22:35:10.000Z",
  "passage": { "…same immutable passage…": "…" },
  "chunks": [{
    "…same chunk…": "…",
    "readingTime": {
      "startedAt": "2026-08-28T22:30:10.000Z",
      "finishedAt": "2026-08-28T22:30:30.000Z",
      "durationMs": 20000
    },
    "visits": [{
      "visitId": "visit-1",
      "startedAt": "2026-08-28T22:30:10.000Z",
      "finishedAt": "2026-08-28T22:30:30.000Z",
      "durationMs": 20000
    }]
  }],
  "comprehensionQuestions": [{
    "…same question…": "…",
    "answer": 1,
    "timeSpentMs": 5000
  }],
  "vocabQuestions": [{
    "…same question…": "…",
    "answer": 0,
    "timeSpentMs": 4000
  }],
  "interactionEvents": [{
    "eventId": "lookup-1",
    "type": "word_lookup",
    "occurredAt": "2026-08-28T22:31:00.000Z",
    "chunkId": 1,
    "word": "horned"
  }]
}`;

const sessionReceipt = `HTTP/1.1 201 Created
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
}`;

const getUserExample = `GET /api/v1/user-info?userId=user_demo_003
Accept: application/json

{
  "schemaVersion": "1.0",
  "user": {
    "id": "user_demo_003",
    "readingProfile": {
      "lexileBand": { "min": 400, "target": 500, "max": 600 },
      "fleschKincaidGrade": 2.2,
      "daleChall": 6.2,
      "preferredCategories": ["Lit"],
      "preferredTopics": ["folktales", "kindness"]
    },
    "updatedAt": "2026-08-28T22:00:00.000Z"
  }
}`;

const postUserExample = `POST /api/v1/user-info
Content-Type: application/json

{
  "schemaVersion": "1.0",
  "userId": "alexandria_demo_001",
  "readingProfile": {
    "lexileBand": { "min": 450, "target": 550, "max": 650 },
    "fleschKincaidGrade": 2.5,
    "daleChall": 5.2,
    "preferredCategories": ["Lit"],
    "preferredTopics": ["animals", "friendship"]
  }
}

// 200 returns the complete updated user object.`;

const connectAndGetExample = `export RTP_BASE_URL="https://read-to-play-alex.vercel.app"
export RTP_TRIAL_TOKEN="<ask-the-data-team>"
export RTP_COOKIE_JAR="$(mktemp)"

# 1. Exchange the real private token for an 8-hour cookie.
curl --fail-with-body -sS \\
  -c "$RTP_COOKIE_JAR" \\
  -H "content-type: application/json" \\
  --data "{\\"token\\":\\"$RTP_TRIAL_TOKEN\\"}" \\
  "$RTP_BASE_URL/api/team-lab/auth"

# 2. Verify Postgres + ClickHouse readiness.
curl --fail-with-body -sS \\
  -b "$RTP_COOKIE_JAR" \\
  "$RTP_BASE_URL/health"

# 3. Read one learner profile from managed Postgres.
curl --fail-with-body -sS \\
  -b "$RTP_COOKIE_JAR" \\
  "$RTP_BASE_URL/api/v1/user-info?userId=user_demo_003"

# 4. Assign one passage. This GET writes, so the key is required.
curl --fail-with-body -sS \\
  -b "$RTP_COOKIE_JAR" \\
  -H "Idempotency-Key: alexandria-assignment-001" \\
  "$RTP_BASE_URL/api/v1/passage?userId=user_demo_003"`;

const currentPostExample = `# Create a namespaced test user; do not overwrite shared seeds.
curl --fail-with-body -sS \\
  -b "$RTP_COOKIE_JAR" \\
  -H "content-type: application/json" \\
  --data '{
    "schemaVersion": "1.0",
    "userId": "alexandria_demo_001",
    "readingProfile": {
      "lexileBand": { "min": 400, "target": 500, "max": 600 },
      "fleschKincaidGrade": 2.2,
      "daleChall": 6.2,
      "preferredCategories": ["Lit"],
      "preferredTopics": ["folktales", "kindness"]
    }
  }' \\
  "$RTP_BASE_URL/api/v1/user-info"`;

function CodeBlock({
  label,
  children,
  format = 'JSON · v1.0',
}: {
  label: string;
  children: string;
  format?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0d3028] shadow-inner">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-mint-dark">
          {label}
        </span>
        <span className="font-mono text-[10px] text-white/35">{format}</span>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 font-mono text-[11px] leading-5 text-white/78 sm:p-5 sm:text-xs">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-forest/10 bg-cream/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-forest font-heading text-lg font-bold text-cream">
              R
            </span>
            <span>
              <span className="block font-heading text-[15px] font-semibold leading-none">
                Read to Play
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-forest/55">
                Data team contract
              </span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-forest/65 md:flex">
            <a className="transition hover:text-forest" href="#interfaces">
              Interfaces
            </a>
            <a className="transition hover:text-forest" href="#decisions">
              Decisions
            </a>
            <a className="transition hover:text-forest" href="#implementation">
              Implementation
            </a>
          </nav>
          <a
            href={repository}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-forest/15 bg-white px-4 py-2 text-xs font-bold text-forest shadow-sm transition hover:border-forest/35"
          >
            <span aria-hidden="true">↗</span>
            <span className="hidden sm:inline">View repository</span>
          </a>
        </div>
      </header>

      <section className="border-b border-mint-dark/25 bg-forest text-white">
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-mint px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-forest">
                  <span className="size-2 rounded-full bg-mint-dark" /> Live on
                  the web now
                </span>
                <span className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white/65">
                  HTTPS · Vercel · Managed Postgres + ClickHouse
                </span>
              </div>
              <h2 className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">
                Current API access
              </h2>
              <a
                href="https://read-to-play-alex.vercel.app"
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all font-mono text-sm font-semibold text-mint-dark underline decoration-mint-dark/35 underline-offset-4"
              >
                https://read-to-play-alex.vercel.app
              </a>
              <p className="mt-4 text-sm leading-6 text-white/68">
                The API is publicly reachable over HTTPS but requires the
                private team-lab access exchange. The same-origin Vercel UI,
                Postman, curl, and server-side clients can use it today. A
                browser app hosted on a different domain must call it through
                its own backend proxy because the trial cookie is{' '}
                <code className="font-mono text-xs text-white">
                  SameSite=Strict
                </code>
                .
              </p>
              <p className="mt-3 rounded-xl border border-coral/35 bg-coral/10 px-4 py-3 text-xs font-semibold leading-5 text-white/75">
                Access requirement: exchange the real private token at{' '}
                <code className="font-mono text-white">
                  POST /api/team-lab/auth
                </code>
                . The text{' '}
                <code className="font-mono text-white">
                  SHARED_OUT_OF_BAND_TOKEN
                </code>{' '}
                is a placeholder, not a working credential. Never put the real
                token in browser code or GitHub.
              </p>
            </div>
            <div className="grid shrink-0 gap-2 text-xs sm:min-w-[390px]">
              {[
                ['GET', '/api/v1/user-info?userId=…'],
                ['POST', '/api/v1/user-info'],
                ['GET', '/api/v1/passage?userId=…'],
                ['POST', '/api/v1/session'],
              ].map(([method, path]) => (
                <div
                  key={path}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.07] px-3 py-2.5"
                >
                  <span className="w-10 font-mono font-bold text-mint-dark">
                    {method}
                  </span>
                  <code className="font-mono text-white/75">{path}</code>
                  <span className="ml-auto text-mint-dark">✓</span>
                </div>
              ))}
              <p className="mt-1 rounded-xl border border-coral/35 bg-coral/10 px-3 py-2.5 leading-5 text-white/65">
                Patricio’s four simplified routes are live and connected to
                managed Postgres. The original session-ID routes remain
                available for the team lab.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-forest/10 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
                Start here · Current deployed API
              </p>
              <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
                Connect in three steps
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-forest/58">
              These commands authenticate once, exercise a live GET, and show
              the safe pattern for a profile POST. Use a namespaced test user so
              another team’s shared fixture is not changed.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              [
                '1',
                'Get the private token',
                'Ask the data team for the real trial token. The placeholder in GitHub is intentionally invalid.',
              ],
              [
                '2',
                'Exchange it once',
                'POST the token to /api/team-lab/auth and retain the returned HttpOnly cookie for subsequent calls.',
              ],
              [
                '3',
                'Call with the cookie',
                'Send the cookie on every GET, POST, and PUT. Re-authenticate after eight hours or any 401 response.',
              ],
            ].map(([step, title, copy]) => (
              <article
                key={step}
                className="rounded-2xl border border-forest/10 bg-cream p-5"
              >
                <span className="grid size-7 place-items-center rounded-full bg-forest font-mono text-xs font-bold text-white">
                  {step}
                </span>
                <h3 className="mt-4 text-sm font-extrabold text-forest">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-forest/58">{copy}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <CodeBlock
              label="Authenticate + working GET requests"
              format="Shell · curl"
            >
              {connectAndGetExample}
            </CodeBlock>
            <CodeBlock label="Working POST request" format="Shell · curl">
              {currentPostExample}
            </CodeBlock>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['204', 'Token accepted; cookie set'],
              ['200', 'GET or assignment succeeded'],
              ['401', 'Cookie missing, invalid, or expired'],
              ['422', 'No approved passage matches the request'],
            ].map(([status, meaning]) => (
              <div
                key={status}
                className="flex items-center gap-3 rounded-xl bg-sand/70 px-4 py-3 text-xs text-forest/60"
              >
                <code className="font-mono font-bold text-forest">
                  {status}
                </code>
                <span>{meaning}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-coral/20 bg-coral-soft p-5 text-sm leading-6 text-coral-dark">
            <strong>Browser teams:</strong> do not copy the shared token into
            frontend code. The cookie is same-origin and{' '}
            <code className="font-mono text-xs">SameSite=Strict</code>. A UI
            hosted on another domain must send its requests through its own
            backend/server-side proxy, which performs this exchange and keeps
            the cookie.
          </div>
        </div>
      </section>

      <section id="top" className="border-b border-forest/10 bg-cream">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div>
            <div className="mb-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-mint-dark/25 bg-mint px-3 py-1.5 text-xs font-bold text-forest">
                <span className="size-2 rounded-full bg-mint-dark" />
                Agreement captured
              </span>
              <span className="rounded-full border border-coral/20 bg-coral-soft px-3 py-1.5 text-xs font-bold text-coral-dark">
                Granola · “Catching up” · Aug 28
              </span>
            </div>
            <p className="mb-4 text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
              Interface brief 01 · For Alexandria + app teams
            </p>
            <h1 className="max-w-3xl font-heading text-4xl font-semibold leading-[1.03] tracking-[-0.045em] text-forest sm:text-6xl">
              Four clear interfaces. One shared passage contract.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-forest/68 sm:text-lg">
              This is the working handoff from Patricio’s conversation with
              John: what the frontend calls, what the data team returns, and
              which gaps remain between the agreement and today’s deployed lab.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#interfaces"
                className="inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(19,70,56,0.16)] transition hover:-translate-y-0.5"
              >
                Read the contract <span aria-hidden="true">↘</span>
              </a>
              <a
                href={liveApp}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-forest/15 bg-white px-5 py-3 text-sm font-bold text-forest transition hover:border-forest/35"
              >
                Open live lab <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

          <aside className="rounded-[28px] bg-forest p-6 text-white shadow-[0_24px_80px_rgba(19,70,56,0.18)] sm:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-mint-dark">
                  Team snapshot
                </p>
                <h2 className="mt-2 font-heading text-2xl font-semibold">
                  What exists today
                </h2>
              </div>
              <span className="grid size-9 place-items-center rounded-xl bg-white/10 font-mono text-sm text-mint-dark">
                DB
              </span>
            </div>
            <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10">
              {[
                ['4,724', 'passages'],
                ['1', 'approved demo'],
                ['7', 'sessions'],
                ['37', 'events'],
              ].map(([value, label]) => (
                <div key={label} className="bg-white/[0.055] p-4 sm:p-5">
                  <dt className="font-mono text-2xl font-semibold text-white">
                    {value}
                  </dt>
                  <dd className="mt-1 text-xs font-semibold text-white/55">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="mt-6 space-y-3 text-sm text-white/72">
              <li className="flex gap-3">
                <span className="text-mint-dark">✓</span>
                Managed Postgres is the operational source.
              </li>
              <li className="flex gap-3">
                <span className="text-mint-dark">✓</span>
                ClickPipes sends the event stream to ClickHouse.
              </li>
              <li className="flex gap-3">
                <span className="text-mint-dark">✓</span>
                The deployed lab already exercises the full cloud path.
              </li>
            </ul>
            <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-5 text-white/42">
              Snapshot from Aug 28, 2026. Counts change as the team tests.
            </p>
          </aside>
        </div>
      </section>

      <section
        id="interfaces"
        className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20"
      >
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
              The agreed surface
            </p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              Patricio’s four interfaces
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-forest/58">
            Authentication is intentionally out of scope for this demo. The UI
            uses one hard-coded pseudonymous user ID.
          </p>
        </div>

        <div className="mt-9 grid gap-4 md:grid-cols-2">
          {interfaces.map((item) => (
            <article
              key={item.number}
              className="group rounded-3xl border border-forest/12 bg-white p-6 shadow-[0_10px_40px_rgba(19,70,56,0.045)] transition hover:-translate-y-1 hover:border-forest/25 sm:p-7"
            >
              <div className="flex items-start justify-between gap-5">
                <span className="font-mono text-xs font-semibold text-forest/35">
                  {item.number}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-forest/65">
                  <span className="size-1.5 rounded-full bg-coral" />{' '}
                  {item.status}
                </span>
              </div>
              <div className="mt-5 flex items-center gap-2 font-mono text-[12px]">
                <span className="rounded-md bg-forest px-2 py-1 font-bold text-mint">
                  {item.method}
                </span>
                <code className="min-w-0 truncate text-forest/72">
                  {item.path}
                </code>
              </div>
              <h3 className="mt-5 font-heading text-2xl font-semibold text-forest">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-forest/58">
                {item.description}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-6 flex gap-4 rounded-2xl border border-coral/20 bg-coral-soft p-5 text-sm leading-6 text-coral-dark">
          <span className="mt-0.5 font-mono font-bold" aria-hidden="true">
            {'{}'}
          </span>
          <p>
            <strong>Important:</strong> these are the agreed frontend-facing
            routes. The current lab uses a select endpoint plus a session-result
            endpoint. The implementation section maps the two surfaces so nobody
            codes against the wrong contract.
          </p>
        </div>
      </section>

      <section id="decisions" className="border-y border-forest/10 bg-sand/55">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
                Decisions from “Catching up”
              </p>
              <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
                What the team can rely on
              </h2>
              <p className="mt-5 text-sm leading-6 text-forest/60">
                The meeting agreed the behavior and four operations. The HTTP
                path spelling and JSON envelope below are the data team’s
                proposed v1 contract so Alexandria can begin now.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [
                  'Identity',
                  'Ten shared synthetic profiles are seeded. Teams should create a namespaced pseudonymous ID before testing writes.',
                ],
                [
                  'Profile',
                  'Store Lexile band, Flesch–Kincaid grade, and Dale–Chall difficulty. Word count was explicitly dropped.',
                ],
                [
                  'Session IDs',
                  'The backend creates and manages internal IDs. The frontend does not need to receive or return one.',
                ],
                [
                  'Event history',
                  'Keep every submitted interaction event so ClickHouse can analyze the reading journey, not only the final score.',
                ],
                [
                  'Scoring',
                  'The browser submits answers and timing. The backend recomputes correctness and scores from the stored assignment.',
                ],
                [
                  'Completion',
                  'Completed sessions require every question. Abandoned sessions may preserve partial answers and timings.',
                ],
              ].map(([title, copy]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-forest/10 bg-white p-5"
                >
                  <h3 className="text-sm font-extrabold text-forest">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-forest/58">
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="contract"
        className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24"
      >
        <div className="max-w-3xl">
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
            Live contract v1.0
          </p>
          <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-5xl">
            Request and response shapes
          </h2>
          <p className="mt-5 text-base leading-7 text-forest/60">
            Examples use{' '}
            <code className="rounded bg-sand px-1.5 py-1 font-mono text-xs">
              user_demo_003
            </code>
            . Clients should retain the complete document returned by the
            passage call, change only telemetry fields, and ignore additive
            fields they do not know.
          </p>
        </div>

        <div className="mt-12 space-y-6">
          <article className="grid gap-7 rounded-[28px] border border-forest/12 bg-white p-5 shadow-[0_14px_50px_rgba(19,70,56,0.05)] sm:p-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <span className="inline-flex rounded-lg bg-forest px-2.5 py-1.5 font-mono text-xs font-bold text-mint">
                GET
              </span>
              <h3 className="mt-5 font-heading text-3xl font-semibold text-forest">
                1. Get one passage
              </h3>
              <p className="mt-3 text-sm leading-6 text-forest/60">
                The backend reads the profile for{' '}
                <code className="font-mono text-xs">userId</code>, filters to
                approved content in range, ranks unseen passages first, then
                applies category and topic preferences as ranking signals.
              </p>
              <ul className="mt-6 space-y-3 text-sm leading-6 text-forest/65">
                <li>
                  <strong>Returns:</strong> one object, never an array.
                </li>
                <li>
                  <strong>Retry safety:</strong> this GET creates an assignment,
                  so a stable <code className="font-mono text-xs">Idempotency-Key</code>{' '}
                  header is required.
                </li>
                <li>
                  <strong>Demo:</strong> passage 2513 is currently the only
                  eligible enriched passage.
                </li>
                <li>
                  <strong>Contract:</strong> six chunks, three comprehension
                  questions, three vocabulary questions.
                </li>
                <li>
                  <strong>Privacy:</strong> use a stable pseudonymous ID, not a
                  child’s real name. Answer keys and server scores are omitted.
                </li>
              </ul>
              <CodeBlock label="Actual GET request">
                {getPassageExample}
              </CodeBlock>
            </div>
            <CodeBlock label="200 response · representative structure">
              {getPassageResponse}
            </CodeBlock>
          </article>

          <article className="grid gap-7 rounded-[28px] border border-forest/12 bg-white p-5 shadow-[0_14px_50px_rgba(19,70,56,0.05)] sm:p-8 lg:grid-cols-2">
            <div>
              <span className="inline-flex rounded-lg bg-coral px-2.5 py-1.5 font-mono text-xs font-bold text-white">
                POST
              </span>
              <h3 className="mt-5 font-heading text-3xl font-semibold text-forest">
                2. Save a reading session
              </h3>
              <p className="mt-3 text-sm leading-6 text-forest/60">
                Send back the same reading document with timestamps, visits,
                answers, and interactions filled. The service locates the
                assigned record, uses its retained internal identifiers,
                reconstructs immutable content, scores answers, and appends
                normalized events.
              </p>
              <div className="mt-6 rounded-2xl bg-mint p-5 text-sm leading-6 text-forest/70">
                <strong>Retry rule:</strong> replaying the same answers and
                behavioral telemetry returns the original receipt. Changing
                those result fields after acceptance is a conflict.
              </div>
              <div className="mt-5 space-y-3 text-sm leading-6 text-forest/62">
                <p>
                  <strong>Completed:</strong> every chunk needs timing; every
                  question needs an answer and{' '}
                  <code className="font-mono text-xs">timeSpentMs</code>.
                </p>
                <p>
                  <strong>Abandoned:</strong> partial timing and answers are
                  accepted; unanswered questions do not become failed attempts.
                </p>
                <p>
                  <strong>Events:</strong>{' '}
                  <code className="font-mono text-xs">word_lookup</code>,{' '}
                  <code className="font-mono text-xs">word_tap</code>,{' '}
                  <code className="font-mono text-xs">pause</code>,{' '}
                  <code className="font-mono text-xs">resume</code>, and{' '}
                  <code className="font-mono text-xs">reread</code>.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <CodeBlock label="Request · shortened only for display">
                {postSessionExample}
              </CodeBlock>
              <CodeBlock label="Receipt · no frontend session ID">
                {sessionReceipt}
              </CodeBlock>
            </div>
          </article>

          <div className="grid gap-6 lg:grid-cols-2">
            <article className="rounded-[28px] border border-forest/12 bg-white p-5 shadow-[0_14px_50px_rgba(19,70,56,0.05)] sm:p-8">
              <span className="inline-flex rounded-lg bg-forest px-2.5 py-1.5 font-mono text-xs font-bold text-mint">
                GET
              </span>
              <h3 className="mt-5 font-heading text-3xl font-semibold text-forest">
                3. Get user info
              </h3>
              <p className="mt-3 text-sm leading-6 text-forest/60">
                Return only the matching profile required by the demo. Values
                are editable learner targets—not a copy of every selected
                passage’s metrics.
              </p>
              <div className="mt-6">
                <CodeBlock label="Request + response">
                  {getUserExample}
                </CodeBlock>
              </div>
            </article>
            <article className="rounded-[28px] border border-forest/12 bg-white p-5 shadow-[0_14px_50px_rgba(19,70,56,0.05)] sm:p-8">
              <span className="inline-flex rounded-lg bg-coral px-2.5 py-1.5 font-mono text-xs font-bold text-white">
                POST
              </span>
              <h3 className="mt-5 font-heading text-3xl font-semibold text-forest">
                4. Update user info
              </h3>
              <p className="mt-3 text-sm leading-6 text-forest/60">
                A professor or demo operator updates the reading band,
                difficulty targets, categories, and topics. The server validates
                ranges and returns the complete updated profile.
              </p>
              <div className="mt-6">
                <CodeBlock label="Request + response behavior">
                  {postUserExample}
                </CodeBlock>
              </div>
            </article>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-forest/10 bg-sand/70 p-5 text-sm leading-6 text-forest/62">
          <strong>Common error envelope:</strong>{' '}
          <code className="font-mono text-xs">
            {
              '{ "error": { "code": "ERROR_CODE", "message": "Human-readable message", "details": {} } }'
            }
          </code>
          . Use 400 for validation, 404 for an unknown user/assignment, 409 for
          a changed retry, 422 when no passage is eligible, and 503 when an
          upstream store is unavailable.
        </div>
      </section>

      <section
        id="implementation"
        className="border-y border-forest/10 bg-forest py-16 text-white lg:py-24"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-mint-dark">
                Implementation bridge
              </p>
              <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight sm:text-5xl">
                Agreed interface vs. deployed API
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/55">
              The live compatibility façade reuses the proven Postgres +
              ClickHouse implementation while giving Alexandria exactly the
              four calls requested and keeping internal UUIDs server-side.
            </p>
          </div>

          <div className="mt-10 overflow-hidden rounded-2xl border border-white/12">
            <div className="hidden grid-cols-[1fr_1.25fr_1.6fr] gap-4 bg-white/8 px-5 py-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/45 md:grid">
              <span>Live interface</span>
              <span>Reused capability</span>
              <span>Implemented behavior</span>
            </div>
            {[
              [
                'GET /api/v1/passage',
                'POST /api/v1/passages/select',
                'Read users, call the existing selector, retain the internal session ID, return the document without it.',
              ],
              [
                'POST /api/v1/session',
                'PUT /api/v1/reading-sessions/:sessionId/result',
                'Resolve the hidden assignment, forward the full result, and return a receipt without the internal session ID.',
              ],
              [
                'GET /api/v1/user-info',
                'Managed Postgres users',
                'Returns the complete Lexile, difficulty, category, and topic profile.',
              ],
              [
                'POST /api/v1/user-info',
                'Managed Postgres users',
                'Validates and upserts a namespaced profile, then returns the complete saved object.',
              ],
            ].map(([target, current, work]) => (
              <div
                key={target}
                className="grid gap-2 border-t border-white/10 px-5 py-5 text-sm first:border-t-0 md:grid-cols-[1fr_1.25fr_1.6fr] md:gap-4"
              >
                <code className="font-mono text-xs font-semibold text-mint-dark">
                  {target}
                </code>
                <code className="font-mono text-xs text-white/58">
                  {current}
                </code>
                <p className="leading-5 text-white/70">{work}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              [
                '01',
                'Profile storage live',
                'Managed Postgres contains ten synthetic users plus namespaced integration profiles.',
              ],
              [
                '02',
                'Facade live',
                'All four routes reuse the proven repository and scoring code while keeping internal UUIDs server-side.',
              ],
              [
                '03',
                'Contract verified',
                'Tests cover auth, profile reads and writes, assignment keys, hidden answer keys, replay, and partial abandonment.',
              ],
            ].map(([step, title, copy]) => (
              <article key={step} className="rounded-2xl bg-white/[0.065] p-5">
                <span className="font-mono text-xs text-mint-dark">{step}</span>
                <h3 className="mt-3 font-heading text-xl font-semibold">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-white/55">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="data"
        className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-24"
      >
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
              Database layout
            </p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              Where each fact lives
            </h2>
            <p className="mt-5 text-sm leading-6 text-forest/60">
              Postgres is the transactional source of truth. Only the
              append-only reading event stream moves through ClickPipes into
              ClickHouse for analytics. The application does not dual-write.
            </p>
            <div className="mt-7 rounded-2xl bg-mint p-5 text-sm leading-6 text-forest/70">
              <strong>Current event timing:</strong> clicks, timers, lookups,
              and answers accumulate in the browser, then save as one derived
              event batch on Complete or Abandon. Closing the tab first loses
              that draft. Click-by-click persistence would require a fifth
              ingestion interface or autosave design.
            </div>
          </div>
          <div className="space-y-3">
            {[
              [
                'users',
                'NEW',
                'Learner matching profile: user ID, Lexile band, Flesch–Kincaid grade, Dale–Chall difficulty, timestamps.',
              ],
              [
                'passages',
                '4,724',
                'Corpus metadata plus descriptive metrics. The approved chunks, questions, options, answer keys, and vocabulary live in enriched_document JSONB.',
              ],
              [
                'reading_sessions',
                '7',
                'Assigned response snapshot, request profile, idempotency hashes, raw submission, server-scored summary, and status.',
              ],
              [
                'reading_events',
                '37',
                'Append-only chunk, question, lookup, pause, resume, reread, completion, and abandonment events. This is the CDC boundary.',
              ],
              [
                'ClickHouse rollups',
                'CDC',
                'UTC daily comprehension, vocabulary, active reading time, word lookups, abandonments, and replication freshness.',
              ],
            ].map(([name, count, copy]) => (
              <article
                key={name}
                className="grid gap-3 rounded-2xl border border-forest/10 bg-white p-5 sm:grid-cols-[1fr_5rem_2fr] sm:items-center"
              >
                <code className="font-mono text-sm font-bold text-forest">
                  {name}
                </code>
                <span className="w-fit rounded-full bg-sand px-2.5 py-1 font-mono text-[10px] font-bold text-forest/55">
                  {count}
                </span>
                <p className="text-sm leading-6 text-forest/58">{copy}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-forest/10 bg-white p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-coral-dark">
              Questions
            </p>
            <p className="mt-3 text-3xl font-mono font-semibold text-forest">
              3 + 3
            </p>
            <p className="mt-2 text-sm leading-6 text-forest/58">
              Three comprehension and three vocabulary questions are embedded
              per approved demo passage.
            </p>
          </div>
          <div className="rounded-2xl border border-forest/10 bg-white p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-coral-dark">
              Answers
            </p>
            <p className="mt-3 text-3xl font-mono font-semibold text-forest">
              JSONB + events
            </p>
            <p className="mt-2 text-sm leading-6 text-forest/58">
              Correct indexes live with reviewed content; raw submissions stay
              on sessions; scored answers become event rows.
            </p>
          </div>
          <div className="rounded-2xl border border-forest/10 bg-white p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-coral-dark">
              Observed results
            </p>
            <p className="mt-3 text-3xl font-mono font-semibold text-forest">
              8 / 12
            </p>
            <p className="mt-2 text-sm leading-6 text-forest/58">
              Eight correct and four incorrect answers across the current test
              data snapshot.
            </p>
          </div>
        </div>
      </section>

      <section
        id="integration"
        className="border-t border-forest/10 bg-coral-soft"
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:py-20">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-coral-dark">
              Use it now
            </p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              Integration checklist
            </h2>
            <ol className="mt-7 grid gap-3 sm:grid-cols-2">
              {[
                'Use the shared pseudonymous demo user ID.',
                'Read the profile before selecting a passage.',
                'Keep the complete passage document returned by the API.',
                'Write only timing, visits, answers, status, and interactions.',
                'POST one exact session body with a stable idempotency key.',
                'Expect ClickHouse progress to be eventually consistent.',
              ].map((item, index) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-2xl bg-white/70 p-4 text-sm leading-6 text-forest/65"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-forest font-mono text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
            <div className="mt-6 rounded-2xl border border-coral/20 bg-white/60 p-5 text-sm leading-6 text-coral-dark">
              <strong>Hosted preview caveat:</strong> the live lab uses an
              8-hour secure, same-site cookie acquired from the shared access
              link. It is demo access control, not user authorization. A
              separately hosted browser frontend should use a same-origin server
              proxy until cross-origin auth is added.
            </div>
          </div>
          <aside className="rounded-[28px] bg-white p-6 shadow-[0_18px_60px_rgba(111,58,43,0.08)] sm:p-8">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-forest/45">
              Team resources
            </p>
            <div className="mt-5 divide-y divide-forest/10">
              {[
                [
                  'Live team lab',
                  liveApp,
                  'The current end-to-end reading flow',
                ],
                [
                  'GitHub implementation',
                  repository,
                  'Branch with API, schema, UI, and runbook',
                ],
                [
                  'Passage contract artifact',
                  contractArtifact,
                  'The reviewed six-chunk passage document',
                ],
              ].map(([title, href, copy]) => (
                <a
                  key={title}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start justify-between gap-4 py-5 first:pt-0 last:pb-0"
                >
                  <span>
                    <span className="block text-sm font-extrabold text-forest group-hover:text-coral-dark">
                      {title}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-forest/50">
                      {copy}
                    </span>
                  </span>
                  <span className="text-forest/35 group-hover:text-coral-dark">
                    ↗
                  </span>
                </a>
              ))}
            </div>
            <p className="mt-7 rounded-xl bg-sand p-4 text-xs leading-5 text-forest/55">
              The protected Vercel access token is intentionally not published
              here. Ask the data team for the current invite link out of band.
            </p>
          </aside>
        </div>
      </section>

      <footer className="bg-cream">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs text-forest/45 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Read to Play · Data team interface brief · Updated Aug 28, 2026</p>
          <p>Source meeting: Granola “Catching up” · Contract v1.0 proposed</p>
        </div>
      </footer>
    </main>
  );
}
