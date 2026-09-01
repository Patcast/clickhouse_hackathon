# Little Alexandria operations runbook

This is the operational source of truth for the Vercel-hosted student app,
professor data room, and reading-analytics MCP. It covers access custody,
deployment, verification, rotation, rollback, and incident handling.

## Quick reference

| Component | Vercel project | Source directory | Production URL | Access |
|---|---|---|---|---|
| Student app and session writer | `little-alexandria-student` | `analytics_engine/` | <https://little-alexandria-student.vercel.app/> | Public; hosted writer accepts only synthetic student 104 and passage 2513 |
| Professor data room | `little-alexandria-professor` | `teacher_data_room/` | <https://little-alexandria-professor.vercel.app/> | UI shell is public; every `/api/*` request requires the professor/MCP token |
| Analytics MCP | `little-alexandria-mcp` | `analytics_mcp/` | `https://little-alexandria-mcp.vercel.app/mcp` | Bearer token; four read-only ClickHouse tools |
| Four-interface data/API lab | `read-to-play-alex` | repository root | <https://read-to-play-alex.vercel.app/> | Separate token and cookie-exchange flow; do not confuse it with the professor/MCP token |

All learner identities and performance records in this hackathon deployment are
synthetic fixtures.

## Ownership and open handoff items

| Area | Current primary | Backup |
|---|---|---|
| Vercel projects | `jymiller` workspace owner | **TBD — assign before team handoff** |
| ClickHouse Cloud organization and billing | **TBD — record the named account owner** | **TBD** |
| Professor/MCP token and password-manager record | Data team operator | **TBD — add a second vault member** |
| LibreChat Docker checkout and provider key | Patricio's laptop operator | **TBD** |

Do not treat a laptop path or one person's browser session as ownership. Before
the next handoff, replace every `TBD` with a named person and confirm they can
sign in, find the password-manager record, and execute production verification.

## Access custody

The local private handoff is always located at:

```text
<repository-root>/.vercel/little-alexandria-access.txt
```

In the current primary checkout that resolves to:

```text
/Users/johnmiller/Downloads/source/hack-click-2/.vercel/little-alexandria-access.txt
```

The file contains the public student URL, the complete private professor URL,
the MCP URL, and its Authorization header. It must be mode `0600` and is ignored
by Git. Confirm both properties without printing its contents:

```bash
git check-ignore -v .vercel/little-alexandria-access.txt
stat -f '%Sp %N' .vercel/little-alexandria-access.txt
```

This file is a convenience handoff, not a durable source of truth. `.vercel/`
is disposable and is not recreated by cloning the repository. Keep the
authoritative professor/MCP token in the team password manager under a record
such as `Read to Play / Little Alexandria / Professor + MCP`. Until that record
exists, the local handoff file is the only readable recovery copy; Vercel
Sensitive Environment Variables cannot be pulled back in plaintext.

The same professor/MCP token is stored in these two Vercel projects as the
Sensitive Environment Variable `TEAM_LAB_ACCESS_TOKEN`:

- `little-alexandria-professor`
- `little-alexandria-mcp`

It is deliberately not used by the public student project or by the separate
`read-to-play-alex` data/API lab.

Never commit or paste any of the following into source, a PR, a ticket, or a
public chat:

- the professor/MCP token or complete professor fragment URL;
- ClickHouse URL, username, password, or database value;
- Postgres connection strings or CA material;
- Vercel OIDC tokens or `.vercel/*.local` files;
- LibreChat provider keys or its uncommitted `.env`.

## Runtime environment

All three Little Alexandria Vercel projects require these Sensitive Environment
Variables for production, preview, and development:

```text
CLICKHOUSE_URL
CLICKHOUSE_USERNAME
CLICKHOUSE_PASSWORD
CLICKHOUSE_DATABASE
```

Professor and MCP additionally require:

```text
TEAM_LAB_ACCESS_TOKEN
```

Student additionally supports this non-secret emergency control:

```text
STUDENT_WRITES_ENABLED=true
```

Setting it to `false` and redeploying makes `POST /api/sessions` return `503`
while leaving the student UI and health endpoint available.

List names and targets without revealing values by running `vercel env ls` from
the corresponding source directory.

## Workstation bootstrap

Prerequisites:

1. Clone the repository and install Node.js 22, pnpm, and the Vercel CLI.
2. Sign into the owning Vercel account and verify it with `vercel whoami`.
3. Retrieve the professor/MCP token from the team password manager.
4. Link each source directory to the existing project. Never relink the
   repository root; it belongs to the separate `read-to-play-alex` project.

```bash
cd analytics_engine
vercel link --yes --project little-alexandria-student

cd ../teacher_data_room
vercel link --yes --project little-alexandria-professor

cd ../analytics_mcp
vercel link --yes --project little-alexandria-mcp
```

The generated `.vercel/` directories and `.env.local` files are ignored and
must stay uncommitted.

## Write or refresh the private access file

Enter the token without placing it in shell history, export it for the two
operations scripts, then clear it:

```bash
read -s "PROFESSOR_MCP_TOKEN?Professor/MCP token: "
echo
export PROFESSOR_MCP_TOKEN
pnpm ops:write-vercel-access
pnpm ops:verify-vercel
unset PROFESSOR_MCP_TOKEN
```

The writer validates the token, atomically replaces the handoff file, sets mode
`0600`, and never prints the secret.

## Deploy

Production deploys are currently manual CLI deployments. Git-triggered Vercel
deployment is not configured for these three nested projects. Merge reviewed
source before or immediately after a manual production deployment so Git and
production do not drift.

Run the root regression suite first:

```bash
pnpm install --frozen-lockfile
pnpm check
```

For each changed service, build locally with Vercel and deploy the exact
prebuilt output. Run these commands from that service directory, not from the
repository root:

```bash
cd analytics_engine
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

```bash
cd teacher_data_room
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

```bash
cd analytics_mcp
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

Record the source commit, PR, operator, date, and resulting production aliases
in the PR description. Do not record secret values.

## Verify production

Set `PROFESSOR_MCP_TOKEN` as described above and run:

```bash
pnpm ops:verify-vercel
```

The check fails unless all of these are true:

- student page and ClickHouse health return `200`;
- professor APIs return `401` without the token;
- authenticated professor health and overview return `200` with synthetic data;
- MCP returns `401` without the token;
- authenticated MCP returns all four expected tools.

Also perform a browser smoke test:

1. Open the public student URL and complete one reading flow.
2. Open the full private professor link from the handoff file.
3. Confirm the new student-104 session appears after the dashboard refresh.
4. Open student 104 and confirm charts and the last 30 sessions render.
5. On the Steam Deck, confirm the public student URL works at 1280×800.

The professor dashboard refreshes every 30 seconds only while its tab is
visible. Close it after a demo to avoid unnecessary ClickHouse queries.

## LibreChat Docker configuration

LibreChat remains the Dockerized client; the MCP itself is hosted on Vercel.
Configure the sibling LibreChat checkout without placing the token in YAML:

```yaml
mcpServers:
  reading-analytics:
    type: streamable-http
    url: https://little-alexandria-mcp.vercel.app/mcp
    headers:
      Authorization: 'Bearer ${READ_TO_PLAY_MCP_TOKEN}'
    requiresOAuth: false
```

Store `READ_TO_PLAY_MCP_TOKEN` only in LibreChat's uncommitted `.env`, restart
Docker Compose, attach the four `reading-analytics` tools to the Reading Coach
agent, and run a class-overview question.

## Rotate the professor/MCP token

Rotate immediately after suspected disclosure, when a team member loses access,
and at the end of the hackathon. Both projects must change together.

1. Generate and save a new 32-byte-or-longer token in the team password manager.
2. Export it locally as `PROFESSOR_MCP_TOKEN` without placing it in shell history.
3. From `teacher_data_room/`, replace `TEAM_LAB_ACCESS_TOKEN` for
   `production,preview,development` using `vercel env add ... --force --sensitive`.
4. Repeat from `analytics_mcp/` with the same token.
5. Redeploy both projects; Vercel environment changes apply to new deployments.
6. Run `pnpm ops:write-vercel-access` and `pnpm ops:verify-vercel`.
7. Update LibreChat's uncommitted `.env`, restart it, and verify a tool call.
8. Share the new professor link privately and delete obsolete copies.

Never rotate only one of the two projects; that breaks either the professor UI
or LibreChat while making the handoff file ambiguous.

## Rollback

1. Identify the last known-good deployment in the Vercel dashboard or with
   `vercel ls` from the affected service directory.
2. Inspect it with `vercel inspect <deployment-url-or-id>`.
3. Run `vercel rollback <deployment-url-or-id> --yes`.
4. Run `pnpm ops:verify-vercel` and the browser smoke test.
5. Revert or fix the source in Git so the next deploy does not reintroduce the
   incident.

A rollback changes code, not environment variables. If the incident is caused
by a bad or exposed secret, rotate the secret and deploy again instead.

## Usage and availability guardrails

- Check the ClickHouse Cloud and Vercel usage views when investigating unusual
  activity or degraded service.
- Keep the professor dashboard closed when it is not being demonstrated.
- Do not add aggressive polling or background MCP calls.
- Investigate unexpected session-write volume, repeated `401` traffic, or a
  sudden increase in ClickHouse queries before increasing service size.
- The student writer is intentionally restricted in Vercel to synthetic user
  104 and passage 2513; do not remove that boundary from a public demo.

If session writes spike unexpectedly outside a planned demo or load test, set
`STUDENT_WRITES_ENABLED=false` in the student project and redeploy. Investigate
before re-enabling it.

## Incident response

### Professor or MCP returns `401`

1. Confirm the private handoff and LibreChat use the current token.
2. Confirm `TEAM_LAB_ACCESS_TOKEN` exists in both Vercel projects.
3. Redeploy both projects if the token was recently changed.
4. Regenerate the access file and rerun production verification.

### A service returns `500` or ClickHouse is disconnected

1. Run `pnpm ops:verify-vercel` to isolate the failing surface.
2. Inspect Vercel function logs without printing environment values.
3. Check ClickHouse Cloud service health, credentials, database name, and
   query/insert permissions.
4. If credentials changed, update all three Little Alexandria projects and
   redeploy them together.

### Unexpected public session-write volume

1. Set `STUDENT_WRITES_ENABLED=false` for production in
   `little-alexandria-student` and redeploy it.
2. Confirm `/api/health` reports `writesEnabled: false` and a session POST
   returns `503`.
3. Review Vercel request logs and ClickHouse insert volume without copying
   request bodies or credentials into an incident ticket.
4. Add an appropriate firewall or rate limit before setting the variable back
   to `true` and redeploying.

### Suspected token exposure

1. Treat the professor data room and MCP as compromised even though their data
   is synthetic.
2. Rotate the shared token in both projects immediately.
3. Redeploy, regenerate the access file, update LibreChat, and verify.
4. Review Vercel logs for unexpected authenticated traffic and preserve the
   relevant timestamps.

### Laptop or checkout lost

1. Restore the token from the team password manager; Vercel cannot reveal a
   Sensitive Environment Variable in plaintext.
2. Relink the three projects in a fresh clone.
3. Export the token and run `pnpm ops:write-vercel-access`.
4. Run `pnpm ops:verify-vercel` before sharing the recreated link.

## Initial deployment record

| Date | Source | Change | Result |
|---|---|---|---|
| 2026-08-29 | commit `7ecc90c`, PR [#6](https://github.com/Patcast/clickhouse_hackathon/pull/6) | Replaced Patricio's laptop/ngrok student, professor, and host-run MCP endpoints with three Vercel projects | All production API, MCP, ClickHouse, auth, and 1280×800 browser checks passed |
