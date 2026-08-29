# analytics_mcp

MCP server that exposes the ClickHouse teacher analytics as tools, so the
professor can ask questions in **LibreChat** ("who is quietly struggling this
week?") and get answers computed from real session data.

Speaks MCP over streamable HTTP at `http://localhost:3004/mcp`. Reads the same
repo-root `.env` ClickHouse Cloud credentials as `analytics_engine` and
`teacher_data_room`, and reuses the data room's queries.

## Run

```bash
npm install
npm start          # http://localhost:3004/mcp  (health: /health)
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
    url: http://host.docker.internal:3004/mcp
```

LibreChat runs in Docker; `host.docker.internal` reaches this process on the
host. In the LibreChat UI, create an **Agent**, attach the four
`reading-analytics` tools, and ask away.

## Smoke test without LibreChat

```bash
curl -s http://localhost:3004/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"class_overview","arguments":{}}}'
```
