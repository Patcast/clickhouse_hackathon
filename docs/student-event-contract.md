# Student event contract

The Little Alexandria developer drawer uses a versioned event envelope so a
person or an AI can tell what happened without reverse-engineering a vague
`type` string.

The first field is always a human-readable `VERB noun`. The structured
`operation` repeats those values for machines and states where the work ran:

- `ui` means a person selected or opened something in the interface;
- `domain` means the browser completed or derived an application operation;
- `http` means a real network request was made.

HTTP verbs are reserved for HTTP. Choosing an answer is `SELECT
onboarding_option`; it is not mislabeled as `GET student` or `PUT student`.
The current student flow does not GET or PUT a student. It derives a local
profile and finally performs `POST reading_session` to `/api/sessions`.

## Envelope

```json
{
  "event": "SELECT onboarding_option",
  "schemaVersion": "event.v1",
  "eventId": "trace_…:3",
  "traceId": "trace_…",
  "sequence": 3,
  "occurredAt": "2026-08-29T08:15:30.000Z",
  "actor": {
    "type": "student",
    "id": "104"
  },
  "operation": {
    "id": "trace_…:3",
    "code": "select_onboarding_option",
    "layer": "ui",
    "verb": "SELECT",
    "noun": "onboarding_option",
    "phase": "completed"
  },
  "target": {
    "type": "onboarding_option",
    "id": "likes:animals"
  },
  "result": {
    "status": "accepted"
  },
  "context": {
    "passageId": 2513,
    "screen": "onboarding"
  },
  "security": {
    "classification": "pseudonymous",
    "policy": "student_telemetry_v1"
  },
  "interaction": {
    "control": "button",
    "source": "pointer_or_touch"
  },
  "data": {
    "stepId": "likes",
    "selectedOptionId": "likes:animals",
    "timeSpentMs": 14132
  }
}
```

Absent values are omitted instead of represented as `null`.

## Real HTTP example

The request and outcome are two append-only records with the same operation
ID. A successful or rejected HTTP exchange has a response; a transport failure
does not. This keeps the network boundary visible and makes latency or failure
analysis possible without logging the request body.

```json
{
  "event": "POST reading_session",
  "operation": {
    "id": "op_…",
    "code": "post_reading_session",
    "layer": "http",
    "verb": "POST",
    "noun": "reading_session",
    "phase": "response"
  },
  "target": {
    "type": "endpoint",
    "id": "/api/sessions"
  },
  "http": {
    "method": "POST",
    "path": "/api/sessions"
  },
  "result": {
    "status": "succeeded",
    "httpStatus": 201
  },
  "data": {
    "sessionId": "556b1420-…",
    "wpm": 92.4
  }
}
```

## Operation vocabulary

| Stable operation code | Human-readable event | Layer | Actual meaning |
|---|---|---|---|
| `select_role` | `SELECT role` | `ui` | Student role button accepted |
| `start_onboarding` | `START onboarding` | `domain` | Browser entered the onboarding workflow |
| `select_onboarding_option` | `SELECT onboarding_option` | `ui` | One semantic option was selected |
| `derive_student_profile` | `DERIVE student_profile` | `domain` | Browser derived the synthetic starting profile; nothing was persisted |
| `open_passage` | `OPEN passage` | `ui` | Reading view opened; no GET occurs here |
| `select_passage_word` | `SELECT passage_word` | `ui` | A local word definition was opened |
| `complete_passage_chunk_visit` | `COMPLETE passage_chunk_visit` | `domain` | The current chunk visit timer was finalized |
| `complete_passage` | `COMPLETE passage` | `domain` | The last chunk was completed |
| `select_answer_option` | `SELECT answer_option` | `ui` | A comprehension or vocabulary answer was selected |
| `complete_reading_challenge` | `COMPLETE reading_challenge` | `domain` | Scores and the demo reward were derived |
| `post_reading_session` | `POST reading_session` | `http` | Request started, succeeded, or failed; `phase` and `result` distinguish the state |

An HTTP status produces a `response` phase. A fetch failure with no response
uses `transport_error` and the bounded `NETWORK_ERROR` code instead.

## Correlation and ordering

- One `traceId` identifies one run from the front door through completion.
- `sequence` is monotonic inside that trace.
- One HTTP operation ID joins its request and response events.
- A response from an earlier trace is ignored by the current drawer and cannot
  mutate its sync state. This prevents a late `session_saved` event from a
  previous run appearing beside fresh onboarding events.

## Security and efficiency

- Student IDs are synthetic or pseudonymous; names and exact ages are omitted.
- Onboarding options and the bundled passage questions use explicit immutable
  IDs, not answer labels, prompt text, exact ages, or array positions.
- Word interactions use a chunk-scoped token reference such as
  `chunk_2:token_17`; the selected passage word is not copied into telemetry.
- No passage text, request body, token, cookie, authorization header, database
  detail, stack trace, or unrestricted error string is logged.
- Errors use bounded codes such as `HTTP_503` or `NETWORK_ERROR`.
- Reserved envelope fields cannot be overwritten by event-specific data.
- The browser drawer is a contract demonstration. These individual events are
  not currently transmitted; the completed session payload is the persisted
  analytics input.
