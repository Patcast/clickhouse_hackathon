import type {
  ResultReceipt,
  ResultSubmission,
  SelectPassageRequest,
  SessionDocument,
} from "./contract.js";

export class NoEligiblePassageError extends Error {}
export class IdempotencyConflictError extends Error {}
export class SessionNotFoundError extends Error {}
export class ResultConflictError extends Error {}
export class InvalidSubmissionError extends Error {}

export interface SelectionOutcome {
  document: SessionDocument;
  replayed: boolean;
}

export interface ResultOutcome {
  receipt: ResultReceipt;
  replayed: boolean;
}

export interface OperationalStoreHealth {
  readingEventCount: number;
}

export interface PassageRepository {
  selectAndAssign(
    request: SelectPassageRequest,
    idempotencyKey: string,
  ): Promise<SelectionOutcome>;
  submitResult(
    sessionId: string,
    submission: ResultSubmission,
  ): Promise<ResultOutcome>;
  healthCheck?(): Promise<OperationalStoreHealth>;
  close?(): Promise<void>;
}
