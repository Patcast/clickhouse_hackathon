import type {
  ResultSubmission,
  ResultSummary,
  SessionDocument,
} from "./contract.js";
import { roundToOne, sha256, stableStringify, uuidFromSeed } from "./utils.js";

export interface ReadingEvent {
  eventId: string;
  occurredAt: string;
  childId: string;
  sessionId: string;
  passageId: number;
  eventType: string;
  axis: "comprehension" | "vocabulary" | null;
  chunkId: number | null;
  questionId: string | null;
  word: string | null;
  answerIndex: number | null;
  isCorrect: boolean | null;
  score: number | null;
  durationMs: number | null;
  payload: Record<string, unknown>;
}

export function resultFingerprint(submission: ResultSubmission): string {
  return sha256(
    stableStringify({
      sessionId: submission.sessionId,
      childId: submission.childId,
      passageId: submission.passage.id,
      sessionStatus: submission.sessionStatus,
      sessionStartedAt: submission.sessionStartedAt,
      sessionFinishedAt: submission.sessionFinishedAt,
      chunks: submission.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        readingTime: chunk.readingTime,
        visits: chunk.visits ?? [],
      })),
      comprehensionQuestions: submission.comprehensionQuestions.map(
        (question) => ({
          questionId: question.questionId,
          answer: question.answer,
          timeSpentMs: question.timeSpentMs,
        }),
      ),
      vocabQuestions: submission.vocabQuestions.map((question) => ({
        questionId: question.questionId,
        answer: question.answer,
        timeSpentMs: question.timeSpentMs,
      })),
      interactionEvents: submission.interactionEvents,
    }),
  );
}

function assertSameIds(
  label: string,
  expected: Array<string | number>,
  submitted: Array<string | number>,
): void {
  const expectedSet = new Set(expected);
  const submittedSet = new Set(submitted);
  if (
    expectedSet.size !== expected.length ||
    submittedSet.size !== submitted.length ||
    expectedSet.size !== submittedSet.size ||
    [...expectedSet].some((id) => !submittedSet.has(id))
  ) {
    throw new Error(`${label} must contain exactly the assigned IDs once each`);
  }
}

function timestampMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`);
  return parsed;
}

function validateSubmission(
  original: SessionDocument,
  submission: ResultSubmission,
): void {
  assertSameIds(
    "chunks",
    original.chunks.map((chunk) => chunk.chunkId),
    submission.chunks.map((chunk) => chunk.chunkId),
  );
  assertSameIds(
    "comprehensionQuestions",
    original.comprehensionQuestions.map((question) => question.questionId),
    submission.comprehensionQuestions.map((question) => question.questionId),
  );
  assertSameIds(
    "vocabQuestions",
    original.vocabQuestions.map((question) => question.questionId),
    submission.vocabQuestions.map((question) => question.questionId),
  );

  const assignedAt = timestampMs(original.assignedAt, "assignedAt");
  const sessionStartedAt = timestampMs(
    submission.sessionStartedAt,
    "sessionStartedAt",
  );
  const sessionFinishedAt = timestampMs(
    submission.sessionFinishedAt,
    "sessionFinishedAt",
  );
  if (sessionStartedAt < assignedAt) {
    throw new Error("sessionStartedAt cannot be before assignedAt");
  }
  if (sessionFinishedAt < sessionStartedAt) {
    throw new Error("sessionFinishedAt cannot be before sessionStartedAt");
  }
  if (sessionFinishedAt > Date.now() + 10 * 60 * 1_000) {
    throw new Error("sessionFinishedAt is too far in the future");
  }

  for (const chunk of submission.chunks) {
    const { startedAt, finishedAt, durationMs } = chunk.readingTime;
    if (submission.sessionStatus === "completed" && !startedAt) {
      throw new Error(`Completed chunk ${chunk.chunkId} needs startedAt`);
    }
    if (submission.sessionStatus === "completed" && !finishedAt) {
      throw new Error(`Completed chunk ${chunk.chunkId} needs finishedAt`);
    }
    if (submission.sessionStatus === "completed" && durationMs === null) {
      throw new Error(`Completed chunk ${chunk.chunkId} needs durationMs`);
    }
    if ((startedAt === null) !== (finishedAt === null)) {
      throw new Error(
        `Chunk ${chunk.chunkId} must provide both startedAt and finishedAt`,
      );
    }
    if (startedAt && finishedAt) {
      const started = timestampMs(startedAt, `chunk ${chunk.chunkId} startedAt`);
      const finished = timestampMs(
        finishedAt,
        `chunk ${chunk.chunkId} finishedAt`,
      );
      if (finished < started) {
        throw new Error(`Chunk ${chunk.chunkId} finishes before it starts`);
      }
      if (started < sessionStartedAt || finished > sessionFinishedAt) {
        throw new Error(`Chunk ${chunk.chunkId} falls outside the session window`);
      }
    }
  }

  for (const question of [
    ...submission.comprehensionQuestions,
    ...submission.vocabQuestions,
  ]) {
    if (submission.sessionStatus === "completed" && question.answer === null) {
      throw new Error(`Completed question ${question.questionId} needs an answer`);
    }
    if (
      submission.sessionStatus === "completed" &&
      question.timeSpentMs === null
    ) {
      throw new Error(`Completed question ${question.questionId} needs timeSpentMs`);
    }
  }

  for (const interaction of submission.interactionEvents) {
    const occurredAt = timestampMs(
      interaction.occurredAt,
      `interaction ${interaction.eventId}`,
    );
    if (occurredAt < sessionStartedAt || occurredAt > sessionFinishedAt) {
      throw new Error(
        `Interaction ${interaction.eventId} falls outside the session window`,
      );
    }
  }
  const interactionIds = submission.interactionEvents.map(
    (interaction) => interaction.eventId,
  );
  if (new Set(interactionIds).size !== interactionIds.length) {
    throw new Error("interactionEvents must use unique eventId values");
  }
}

function questionSummary(
  questions: Array<{ answer: number | null; isCorrect?: boolean | null }>,
) {
  const correct = questions.filter((question) => question.isCorrect === true).length;
  const possible = questions.length;
  return {
    correct,
    possible,
    percent: possible === 0 ? 0 : roundToOne((correct / possible) * 100),
  };
}

function scoreQuestionSet<
  T extends {
    questionId: string;
    correctIndex: number;
    answer: number | null;
    timeSpentMs: number | null;
    options: string[];
  },
>(originalQuestions: T[], submittedQuestions: T[]): T[] {
  const submittedById = new Map(
    submittedQuestions.map((question) => [question.questionId, question]),
  );

  return originalQuestions.map((original) => {
    const submitted = submittedById.get(original.questionId);
    const answer = submitted?.answer ?? null;
    const inRange = answer === null || (answer >= 0 && answer < original.options.length);
    if (!inRange) {
      throw new Error(`Answer for ${original.questionId} is outside its option range`);
    }
    const isCorrect = answer === null ? null : answer === original.correctIndex;
    return {
      ...original,
      answer,
      isCorrect,
      score: isCorrect === true ? 1 : 0,
      maxScore: 1,
      timeSpentMs: submitted?.timeSpentMs ?? null,
    };
  });
}

export function scoreSubmission(
  original: SessionDocument,
  submission: ResultSubmission,
): {
  scoredDocument: ResultSubmission;
  summary: ResultSummary;
  events: ReadingEvent[];
} {
  if (
    submission.sessionId !== original.sessionId ||
    submission.childId !== original.childId ||
    submission.passage.id !== original.passage.id
  ) {
    throw new Error("Session, child, or passage identity does not match assignment");
  }
  validateSubmission(original, submission);

  const submittedChunks = new Map(
    submission.chunks.map((chunk) => [chunk.chunkId, chunk]),
  );
  const chunks = original.chunks.map((chunk) => {
    const submitted = submittedChunks.get(chunk.chunkId);
    return {
      ...chunk,
      readingTime: submitted?.readingTime ?? chunk.readingTime,
      visits: submitted?.visits ?? chunk.visits ?? [],
    };
  });

  const comprehensionQuestions = scoreQuestionSet(
    original.comprehensionQuestions,
    submission.comprehensionQuestions,
  );
  const vocabQuestions = scoreQuestionSet(
    original.vocabQuestions,
    submission.vocabQuestions,
  );

  const scoredDocument: ResultSubmission = {
    ...structuredClone(original),
    sessionStatus: submission.sessionStatus,
    sessionStartedAt: submission.sessionStartedAt,
    sessionFinishedAt: submission.sessionFinishedAt,
    chunks,
    comprehensionQuestions,
    vocabQuestions,
    interactionEvents: submission.interactionEvents ?? [],
  };

  const summary: ResultSummary = {
    totalActiveReadingMs: chunks.reduce(
      (total, chunk) => total + (chunk.readingTime.durationMs ?? 0),
      0,
    ),
    comprehension: questionSummary(comprehensionQuestions),
    vocabulary: questionSummary(vocabQuestions),
  };

  const base = {
    childId: original.childId,
    sessionId: original.sessionId,
    passageId: original.passage.id,
  };
  const events: ReadingEvent[] = [];

  for (const chunk of chunks) {
    if (chunk.readingTime.durationMs === null) continue;
    events.push({
      eventId: uuidFromSeed(`${original.sessionId}:chunk:${chunk.chunkId}`),
      occurredAt: chunk.readingTime.finishedAt ?? submission.sessionFinishedAt,
      ...base,
      eventType: "chunk_completed",
      axis: null,
      chunkId: chunk.chunkId,
      questionId: null,
      word: null,
      answerIndex: null,
      isCorrect: null,
      score: null,
      durationMs: chunk.readingTime.durationMs,
      payload: { visits: chunk.visits ?? [] },
    });
  }

  for (const question of [...comprehensionQuestions, ...vocabQuestions]) {
    if (question.answer === null) continue;
    events.push({
      eventId: uuidFromSeed(`${original.sessionId}:question:${question.questionId}`),
      occurredAt: submission.sessionFinishedAt,
      ...base,
      eventType: "question_answer",
      axis: question.axis,
      chunkId: question.chunkId ?? null,
      questionId: question.questionId,
      word: "word" in question ? String(question.word) : null,
      answerIndex: question.answer,
      isCorrect: question.isCorrect ?? null,
      score: question.score,
      durationMs: question.timeSpentMs,
      payload: {},
    });
  }

  for (const interaction of scoredDocument.interactionEvents) {
    events.push({
      eventId: uuidFromSeed(
        `${original.sessionId}:interaction:${interaction.eventId}`,
      ),
      occurredAt: interaction.occurredAt,
      ...base,
      eventType: interaction.type === "word_tap" ? "word_lookup" : interaction.type,
      axis: null,
      chunkId: interaction.chunkId ?? null,
      questionId: interaction.questionId ?? null,
      word: interaction.word ?? null,
      answerIndex: null,
      isCorrect: null,
      score: null,
      durationMs: interaction.durationMs ?? null,
      payload: interaction.metadata ?? {},
    });
  }

  events.push({
    eventId: uuidFromSeed(`${original.sessionId}:session:${submission.sessionStatus}`),
    occurredAt: submission.sessionFinishedAt,
    ...base,
    eventType:
      submission.sessionStatus === "completed"
        ? "session_completed"
        : "session_abandoned",
    axis: null,
    chunkId: null,
    questionId: null,
    word: null,
    answerIndex: null,
    isCorrect: null,
    score: null,
    durationMs: summary.totalActiveReadingMs,
    payload: { summary },
  });

  return { scoredDocument, summary, events };
}
