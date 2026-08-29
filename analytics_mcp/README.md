# analytics_mcp

MCP server that exposes the ClickHouse teacher analytics as tools, so the
professor can ask questions in **LibreChat** ("who is quietly struggling this
week?") and get answers computed from real session data.

Speaks MCP over streamable HTTP locally at `http://localhost:3004/mcp` and in
production at `https://little-alexandria-mcp.vercel.app/mcp`. Reads the same
repo-root `.env` ClickHouse Cloud credentials as `analytics_engine` and
`teacher_data_room`, and reuses the data room's queries.

Production requires `Authorization: Bearer <PROFESSOR_MCP_TOKEN>`. The
secret is stored as `TEAM_LAB_ACCESS_TOKEN` in Vercel and is never committed.

## Run

```bash
npm install
TEAM_LAB_ACCESS_TOKEN=local-only-token npm start  # http://localhost:3004/mcp
```

## Tools

| tool                | args         | answers                                                        |
|---------------------|--------------|----------------------------------------------------------------|
| `class_overview`    | —            | per-student roll-up: wpm, comp %, vocab %, band growth, recent-vs-baseline accuracy; weakest first |
| `student_detail`    | `student_id` | profile, full session timeline, missed vocab words, difficulty targets |
| `class_trend`       | —            | class-wide daily wpm / accuracy / session counts               |
| `hardest_questions` | `limit`      | item analysis: questions the class misses most                 |

## LibreChat wiring

`../../LibreChat/librechat.yaml` registers this server:

```yaml
mcpServers:
  reading-analytics:
    type: streamable-http
    url: https://little-alexandria-mcp.vercel.app/mcp
    headers:
      Authorization: 'Bearer ${READ_TO_PLAY_MCP_TOKEN}'
    requiresOAuth: false
```

Set `READ_TO_PLAY_MCP_TOKEN` in LibreChat's uncommitted `.env`, restart its
Docker Compose stack, then create an **Agent**, attach the four
`reading-analytics` tools, and ask away. The old `host.docker.internal:3004`
configuration is only needed when running the MCP locally.

## Smoke test without LibreChat

```bash
curl -s http://localhost:3004/mcp \
  -H 'authorization: Bearer local-only-token' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"class_overview","arguments":{}}}'
```
