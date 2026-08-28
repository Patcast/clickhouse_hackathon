import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/create-app.js";
import { loadSeedPassage } from "../src/content.js";
import {
  resultSubmissionSchema,
  type SessionDocument,
} from "../src/contract.js";
import { MemoryPassageRepository } from "../src/memory-repository.js";
import { scoreSubmission } from "../src/scoring.js";

let app: FastifyInstance;

beforeEach(async () => {
  const repository = new MemoryPassageRepository([await loadSeedPassage()]);
  app = createApp({ repository, repositoryMode: "memory" });
});

afterEach(async () => {
  await app.close();
});

test("reports probed store readiness and keeps the team lab opt-in", async () => {
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    status: "ok",
    operationalStore: "memory",
    analyticsStore: "not-configured",
    checks: {
      operationalStore: { status: "reachable", readingEventCount: 0 },
      analyticsStore: { status: "not-configured" },
    },
    schemaVersion: "1.0",
  });

  const root = await app.inject({ method: "GET", url: "/" });
  assert.equal(root.statusCode, 404);
});

test("does not report configured cloud stores as ready when probes fail", async () => {
  const repository = new MemoryPassageRepository([await loadSeedPassage()]);
  repository.healthCheck = async () => {
    throw new Error("postgres unavailable");
  };
  const degradedApp = createApp({
    repository,
    repositoryMode: "postgres",
    analytics: {
      childProgress: async () => [],
      healthCheck: async () => {
        throw new Error("clickhouse unavailable");
      },
    },
  });

  try {
    const health = await degradedApp.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), {
      status: "degraded",
      operationalStore: "postgres",
      analyticsStore: "clickhouse",
      checks: {
        operationalStore: { status: "unreachable" },
        analyticsStore: { status: "unreachable" },
      },
      schemaVersion: "1.0",
    });
  } finally {
    await degradedApp.close();
  }
});

test("protects remote team-lab APIs with a fragment-exchanged cookie", async () => {
  const protectedApp = createApp({
    repository: new MemoryPassageRepository([await loadSeedPassage()]),
    repositoryMode: "memory",
    serveTeamLab: true,
    teamLabAccessToken: "test-access-token-1234",
    secureTeamLabCookie: true,
  });

  try {
    const root = await protectedApp.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200);

    const unauthorized = await protectedApp.inject({
      method: "GET",
      url: "/health",
    });
    assert.equal(unauthorized.statusCode, 401);

    const rejected = await protectedApp.inject({
      method: "POST",
      url: "/api/team-lab/auth",
      payload: { token: "wrong" },
    });
    assert.equal(rejected.statusCode, 401);

    const authorized = await protectedApp.inject({
      method: "POST",
      url: "/api/team-lab/auth",
      payload: { token: "test-access-token-1234" },
    });
    assert.equal(authorized.statusCode, 204);
    const cookie = String(authorized.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);

    const health = await protectedApp.inject({
      method: "GET",
      url: "/health",
      headers: { cookie: cookie.split(";", 1)[0]! },
    });
    assert.equal(health.statusCode, 200);
  } finally {
    await protectedApp.close();
  }
});

async function selectPassage(
  key = "maya-demo-1",
): Promise<{ statusCode: number; document: SessionDocument; replay: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/passages/select",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    payload: {
      schemaVersion: "1.0",
      childId: "child_maya",
      readingBand: { system: "lexile", min: 400, max: 600, target: 500 },
      preferences: { categories: ["Lit"], topics: ["animals"] },
    },
  });
  return {
    statusCode: response.statusCode,
    document: response.json<SessionDocument>(),
    replay: String(response.headers["x-idempotent-replay"]),
  };
}

test("selects exactly one backward-compatible enriched passage", async () => {
  const selected = await selectPassage();
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.replay, "false");
  assert.equal(selected.document.passage.id, 2513);
  assert.equal(selected.document.passage.coverImageUrl, null);
  assert.match(selected.document.passage.contentVersion ?? "", /^sha256:/);
  assert.equal(selected.document.chunks.length, 6);
  assert.equal(selected.document.comprehensionQuestions.length, 3);
  assert.equal(selected.document.vocabQuestions.length, 3);
  assert.equal(selected.document.sessionStatus, "assigned");

  const replay = await selectPassage();
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.replay, "true");
  assert.deepEqual(replay.document, selected.document);
});

test("rejects a reading band with no enriched passage", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/passages/select",
    payload: {
      schemaVersion: "1.0",
      childId: "child_leo",
      readingBand: { system: "lexile", min: 900, max: 1100, target: 1000 },
    },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "NO_ELIGIBLE_PASSAGE");
});

test("treats category preferences as ranking signals with fallback", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/passages/select",
    payload: {
      schemaVersion: "1.0",
      childId: "child_fallback",
      readingBand: { system: "lexile", min: 400, max: 600, target: 500 },
      preferences: { categories: ["Info"] },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().passage.category, "Lit");
});

test("rejects reuse of a selection key for a different request", async () => {
  const selected = await selectPassage("maya-reused-key");
  assert.equal(selected.statusCode, 200);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/passages/select",
    headers: { "idempotency-key": "maya-reused-key" },
    payload: {
      schemaVersion: "1.0",
      childId: "child_maya",
      readingBand: { system: "lexile", min: 400, max: 700, target: 600 },
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "IDEMPOTENCY_CONFLICT");
});

test("grades a returned document and makes result retries idempotent", async () => {
  const { document } = await selectPassage();
  const start = new Date(Date.parse(document.assignedAt) + 1_000).toISOString();
  const finish = new Date(Date.parse(start) + 300_000).toISOString();
  const result = resultSubmissionSchema.parse({
    ...document,
    sessionStatus: "completed",
    sessionStartedAt: start,
    sessionFinishedAt: finish,
    chunks: document.chunks.map((chunk, index) => ({
      ...chunk,
      readingTime: {
        startedAt: start,
        finishedAt: finish,
        durationMs: 20_000 + index * 1_000,
      },
    })),
    comprehensionQuestions: document.comprehensionQuestions.map(
      (question, index) => ({
        ...question,
        answer: [1, 0, 0][index],
        isCorrect: false,
        score: 0,
        timeSpentMs: 5_000,
      }),
    ),
    vocabQuestions: document.vocabQuestions.map((question) => ({
      ...question,
      answer: question.correctIndex,
      isCorrect: false,
      score: 0,
      timeSpentMs: 4_000,
    })),
  });

  const first = await app.inject({
    method: "PUT",
    url: `/api/v1/reading-sessions/${document.sessionId}/result`,
    payload: result,
  });
  assert.equal(first.statusCode, 201);
  const receipt = first.json();
  assert.deepEqual(receipt.summary.comprehension, {
    correct: 2,
    possible: 3,
    percent: 66.7,
  });
  assert.deepEqual(receipt.summary.vocabulary, {
    correct: 3,
    possible: 3,
    percent: 100,
  });
  assert.equal(receipt.summary.totalActiveReadingMs, 135_000);

  const replay = await app.inject({
    method: "PUT",
    url: `/api/v1/reading-sessions/${document.sessionId}/result`,
    payload: result,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), receipt);

  const selectionReplay = await selectPassage();
  assert.equal(selectionReplay.replay, "true");
  assert.equal(selectionReplay.document.sessionStatus, "assigned");
  assert.equal(selectionReplay.document.sessionStartedAt, undefined);

  const conflicting = structuredClone(result);
  conflicting.comprehensionQuestions[0]!.answer = 0;
  const conflict = await app.inject({
    method: "PUT",
    url: `/api/v1/reading-sessions/${document.sessionId}/result`,
    payload: conflicting,
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, "RESULT_CONFLICT");
});

test("does not turn unanswered abandoned questions into failed attempts", async () => {
  const { document } = await selectPassage("maya-abandoned");
  const start = new Date(Date.parse(document.assignedAt) + 1_000).toISOString();
  const finish = new Date(Date.parse(start) + 30_000).toISOString();
  const abandoned = resultSubmissionSchema.parse({
    ...document,
    sessionStatus: "abandoned",
    sessionStartedAt: start,
    sessionFinishedAt: finish,
  });

  const scored = scoreSubmission(document, abandoned);
  assert.equal(
    scored.events.filter((event) => event.eventType === "question_answer").length,
    0,
  );
  assert.equal(
    scored.events.filter((event) => event.eventType === "session_abandoned")
      .length,
    1,
  );
});

test("allows the browser result PUT in a CORS preflight", async () => {
  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/reading-sessions/00000000-0000-4000-8000-000000000000/result",
    headers: {
      origin: "http://127.0.0.1:5173",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.match(String(response.headers["access-control-allow-methods"]), /PUT/);
});

test("rejects incomplete or temporally impossible completed results", async () => {
  const { document } = await selectPassage("maya-invalid-1");
  const start = new Date(Date.parse(document.assignedAt) + 1_000).toISOString();
  const finish = new Date(Date.parse(start) + 60_000).toISOString();
  const invalid = resultSubmissionSchema.parse({
    ...document,
    sessionStatus: "completed",
    sessionStartedAt: start,
    sessionFinishedAt: finish,
    chunks: document.chunks,
    comprehensionQuestions: document.comprehensionQuestions,
    vocabQuestions: document.vocabQuestions,
  });
  const response = await app.inject({
    method: "PUT",
    url: `/api/v1/reading-sessions/${document.sessionId}/result`,
    payload: invalid,
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "INVALID_RESULT");

  const { document: reversedDocument } = await selectPassage("maya-invalid-2");
  const reversedStart = new Date(
    Date.parse(reversedDocument.assignedAt) + 60_000,
  ).toISOString();
  const reversedFinish = new Date(
    Date.parse(reversedDocument.assignedAt) + 30_000,
  ).toISOString();
  const reversed = resultSubmissionSchema.parse({
    ...reversedDocument,
    sessionStatus: "completed",
    sessionStartedAt: reversedStart,
    sessionFinishedAt: reversedFinish,
    chunks: reversedDocument.chunks.map((chunk) => ({
      ...chunk,
      readingTime: {
        startedAt: reversedFinish,
        finishedAt: reversedStart,
        durationMs: 30_000,
      },
    })),
    comprehensionQuestions: reversedDocument.comprehensionQuestions.map(
      (question) => ({
        ...question,
        answer: question.correctIndex,
        timeSpentMs: 1_000,
      }),
    ),
    vocabQuestions: reversedDocument.vocabQuestions.map((question) => ({
      ...question,
      answer: question.correctIndex,
      timeSpentMs: 1_000,
    })),
  });
  const reversedResponse = await app.inject({
    method: "PUT",
    url: `/api/v1/reading-sessions/${reversedDocument.sessionId}/result`,
    payload: reversed,
  });
  assert.equal(reversedResponse.statusCode, 422);
});
