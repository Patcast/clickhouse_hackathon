import { randomUUID } from "node:crypto";
import type {
  EnrichedPassage,
  ResultReceipt,
  ResultSubmission,
  SelectPassageRequest,
  SessionDocument,
} from "./contract.js";
import {
  IdempotencyConflictError,
  InvalidSubmissionError,
  NoEligiblePassageError,
  ResultConflictError,
  SessionNotFoundError,
  type PassageRepository,
  type OperationalStoreHealth,
  type ResultOutcome,
  type SelectionOutcome,
} from "./repository.js";
import { resultFingerprint, scoreSubmission } from "./scoring.js";
import { buildSessionDocument } from "./session.js";
import { sha256, stableStringify } from "./utils.js";

interface StoredSession {
  document: SessionDocument;
  childId: string;
  idempotencyKey: string;
  requestHash: string;
  submissionHash?: string;
  receipt?: ResultReceipt;
}

export class MemoryPassageRepository implements PassageRepository {
  readonly mode = "memory";
  private readonly sessions = new Map<string, StoredSession>();
  private readonly idempotencyIndex = new Map<string, string>();

  constructor(private readonly passages: EnrichedPassage[]) {}

  async selectAndAssign(
    request: SelectPassageRequest,
    idempotencyKey: string,
  ): Promise<SelectionOutcome> {
    const indexKey = `${request.childId}:${idempotencyKey}`;
    const requestHash = sha256(stableStringify(request));
    const existingId = this.idempotencyIndex.get(indexKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError(
            "This idempotency key was already used for another request",
          );
        }
        return { document: existing.document, replayed: true };
      }
    }

    const categories = request.preferences?.categories;
    const topics = request.preferences?.topics?.map((topic) =>
      topic.toLowerCase(),
    );
    const excluded = new Set(request.excludePassageIds);
    const candidates = this.passages
      .filter((item) => {
        const lexile = item.passage.lexileBand;
        return (
          lexile !== null &&
          lexile >= request.readingBand.min &&
          lexile <= request.readingBand.max &&
          !excluded.has(item.passage.id)
        );
      })
      .sort((left, right) => {
        const leftCategoryMatch =
          !categories?.length || categories.includes(left.passage.category);
        const rightCategoryMatch =
          !categories?.length || categories.includes(right.passage.category);
        if (leftCategoryMatch !== rightCategoryMatch) {
          return leftCategoryMatch ? -1 : 1;
        }
        const topicMatches = (item: EnrichedPassage) => {
          if (!topics?.length) return 0;
          const searchable = [
            item.passage.title,
            ...item.chunks.map((chunk) => chunk.text),
          ]
            .join(" ")
            .toLowerCase();
          return topics.filter((topic) => searchable.includes(topic)).length;
        };
        const topicDifference = topicMatches(right) - topicMatches(left);
        if (topicDifference) return topicDifference;
        const leftDistance = Math.abs(
          (left.passage.lexileBand ?? 0) - request.readingBand.target,
        );
        const rightDistance = Math.abs(
          (right.passage.lexileBand ?? 0) - request.readingBand.target,
        );
        return leftDistance - rightDistance || left.passage.id - right.passage.id;
      });

    const selected = candidates[0];
    if (!selected) {
      throw new NoEligiblePassageError("No enriched passage matches this request");
    }

    const sessionId = randomUUID();
    const document = buildSessionDocument(
      selected,
      request,
      sessionId,
      new Date().toISOString(),
    );
    this.sessions.set(sessionId, {
      document,
      childId: request.childId,
      idempotencyKey,
      requestHash,
    });
    this.idempotencyIndex.set(indexKey, sessionId);
    return { document, replayed: false };
  }

  async submitResult(
    sessionId: string,
    submission: ResultSubmission,
  ): Promise<ResultOutcome> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError("Reading session not found");

    const submissionHash = resultFingerprint(submission);
    if (session.submissionHash) {
      if (session.submissionHash !== submissionHash) {
        throw new ResultConflictError("A different result already exists");
      }
      return { receipt: session.receipt!, replayed: true };
    }

    let scored;
    try {
      scored = scoreSubmission(session.document, submission);
    } catch (error) {
      throw new InvalidSubmissionError(
        error instanceof Error ? error.message : "Invalid result submission",
      );
    }

    const receipt: ResultReceipt = {
      schemaVersion: "1.0",
      resultId: randomUUID(),
      sessionId,
      status: "accepted",
      receivedAt: new Date().toISOString(),
      summary: scored.summary,
      analyticsSyncStatus: "pending",
    };

    session.submissionHash = submissionHash;
    session.receipt = receipt;
    return { receipt, replayed: false };
  }

  async healthCheck(): Promise<OperationalStoreHealth> {
    return { readingEventCount: 0 };
  }

  async close(): Promise<void> {}
}
