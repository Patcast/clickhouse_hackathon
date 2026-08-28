import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  enrichedPassageSchema,
  type ResultReceipt,
  type ResultSubmission,
  type SelectPassageRequest,
  type SessionFacadeSubmission,
  type SessionDocument,
  type UserInfoEntity,
  type UserInfoUpsertRequest,
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
import {
  resultFingerprint,
  scoreSubmission,
  type ReadingEvent,
} from "./scoring.js";
import { buildSessionDocument, hydrateFacadeSubmission } from "./session.js";
import { sha256, stableStringify } from "./utils.js";

interface SessionRow {
  session_id: string;
  response_document: SessionDocument;
  submission_hash: string | null;
  result_id: string | null;
  result_summary: ResultReceipt["summary"] | null;
  result_received_at: Date | null;
  request_hash: string | null;
}

interface UserRow {
  user_id: string;
  lexile_min: number;
  lexile_target: number;
  lexile_max: number;
  flesch_kincaid_grade: number;
  dale_chall: number;
  preferred_categories: Array<"Lit" | "Info">;
  preferred_topics: string[];
  updated_at: Date;
}

export class PostgresPassageRepository implements PassageRepository {
  readonly mode = "postgres";

  constructor(private readonly pool: Pool) {}

  async selectAndAssign(
    request: SelectPassageRequest,
    idempotencyKey: string,
  ): Promise<SelectionOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requestHash = sha256(stableStringify(request));
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [request.childId],
      );
      const existing = await client.query<SessionRow>(
        `SELECT session_id, response_document, submission_hash, result_id,
                result_summary, result_received_at, request_hash
           FROM reading_sessions
          WHERE child_id = $1 AND idempotency_key = $2`,
        [request.childId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (
          existing.rows[0].request_hash &&
          existing.rows[0].request_hash !== requestHash
        ) {
          throw new IdempotencyConflictError(
            "This idempotency key was already used for another request",
          );
        }
        await client.query("COMMIT");
        return {
          document: existing.rows[0].response_document,
          replayed: true,
        };
      }

      const categories = request.preferences?.categories ?? [];
      const topics = request.preferences?.topics ?? [];
      const candidate = await client.query<{
        passage_id: number;
        enriched_document: unknown;
        last_assigned_at: Date | null;
      }>(
        `SELECT p.passage_id, p.enriched_document, history.last_assigned_at
           FROM passages p
           LEFT JOIN LATERAL (
             SELECT max(rs.assigned_at) AS last_assigned_at
               FROM reading_sessions rs
              WHERE rs.child_id = $1 AND rs.passage_id = p.passage_id
           ) history ON true
          WHERE p.enriched_document IS NOT NULL
            AND p.rights_status = 'approved'
            AND p.lexile_band BETWEEN $2 AND $3
            AND NOT (p.passage_id = ANY($6::integer[]))
          ORDER BY
            (history.last_assigned_at IS NULL) DESC,
            (cardinality($4::text[]) = 0 OR p.category = ANY($4::text[])) DESC,
            CASE
              WHEN cardinality($5::text[]) = 0 THEN 0
              ELSE (
                SELECT count(*)
                  FROM unnest($5::text[]) AS topic
                 WHERE concat_ws(' ', p.title, p.subcategory, p.excerpt)
                       ILIKE '%' || topic || '%'
              )
            END DESC,
            abs(p.lexile_band - $7),
            history.last_assigned_at ASC NULLS FIRST,
            p.passage_id
          LIMIT 1`,
        [
          request.childId,
          request.readingBand.min,
          request.readingBand.max,
          categories,
          topics,
          request.excludePassageIds,
          request.readingBand.target,
        ],
      );

      const selected = candidate.rows[0];
      if (!selected) {
        throw new NoEligiblePassageError(
          "No enriched passage matches this request",
        );
      }

      const content = enrichedPassageSchema.parse(selected.enriched_document);
      const sessionId = randomUUID();
      const lastAssignedMs = selected.last_assigned_at?.getTime() ?? 0;
      const assignedAt = new Date(
        Math.max(Date.now(), lastAssignedMs + 1),
      ).toISOString();
      const document = buildSessionDocument(
        content,
        request,
        sessionId,
        assignedAt,
      );
      await client.query(
         `INSERT INTO reading_sessions (
           session_id, child_id, passage_id, idempotency_key, request_hash,
           requested_band, requested_preferences, response_document,
           status, assigned_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
                   'assigned', $9)`,
        [
          sessionId,
          request.childId,
          selected.passage_id,
          idempotencyKey,
          requestHash,
          JSON.stringify(request.readingBand),
          JSON.stringify(request.preferences ?? {}),
          JSON.stringify(document),
          assignedAt,
        ],
      );
      await client.query("COMMIT");
      return { document, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitResult(
    sessionId: string,
    submission: ResultSubmission,
  ): Promise<ResultOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<SessionRow>(
        `SELECT session_id, response_document, submission_hash, result_id,
                result_summary, result_received_at, request_hash
           FROM reading_sessions
          WHERE session_id = $1
          FOR UPDATE`,
        [sessionId],
      );
      const session = found.rows[0];
      if (!session) throw new SessionNotFoundError("Reading session not found");

      const submissionHash = resultFingerprint(submission);
      if (session.submission_hash) {
        if (session.submission_hash !== submissionHash) {
          throw new ResultConflictError("A different result already exists");
        }
        const receipt = this.receiptFromRow(session);
        await client.query("COMMIT");
        return { receipt, replayed: true };
      }

      let scored;
      try {
        scored = scoreSubmission(session.response_document, submission);
      } catch (error) {
        throw new InvalidSubmissionError(
          error instanceof Error ? error.message : "Invalid result submission",
        );
      }

      const resultId = randomUUID();
      const receivedAt = new Date().toISOString();
      for (const event of scored.events) {
        await this.insertEvent(client, event);
      }
      await client.query(
        `UPDATE reading_sessions
            SET status = $2,
                session_started_at = $3,
                session_finished_at = $4,
                submission_hash = $5,
                result_id = $6,
                result_summary = $7::jsonb,
                raw_submission = $8::jsonb,
                result_received_at = $9
          WHERE session_id = $1`,
        [
          sessionId,
          submission.sessionStatus,
          submission.sessionStartedAt,
          submission.sessionFinishedAt,
          submissionHash,
          resultId,
          JSON.stringify(scored.summary),
          JSON.stringify(submission),
          receivedAt,
        ],
      );
      await client.query("COMMIT");

      return {
        replayed: false,
        receipt: {
          schemaVersion: "1.0",
          resultId,
          sessionId,
          status: "accepted",
          receivedAt,
          summary: scored.summary,
          analyticsSyncStatus: "pending",
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserInfo(userId: string): Promise<UserInfoEntity | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT user_id, lexile_min, lexile_target, lexile_max,
              flesch_kincaid_grade, dale_chall, preferred_categories,
              preferred_topics, updated_at
         FROM users
        WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? this.userFromRow(row) : null;
  }

  async upsertUserInfo(
    request: UserInfoUpsertRequest,
  ): Promise<UserInfoEntity> {
    const profile = request.readingProfile;
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (
         user_id, lexile_min, lexile_target, lexile_max,
         flesch_kincaid_grade, dale_chall, preferred_categories,
         preferred_topics, profile_source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], 'api')
       ON CONFLICT (user_id) DO UPDATE SET
         lexile_min = EXCLUDED.lexile_min,
         lexile_target = EXCLUDED.lexile_target,
         lexile_max = EXCLUDED.lexile_max,
         flesch_kincaid_grade = EXCLUDED.flesch_kincaid_grade,
         dale_chall = EXCLUDED.dale_chall,
         preferred_categories = EXCLUDED.preferred_categories,
         preferred_topics = EXCLUDED.preferred_topics,
         profile_source = EXCLUDED.profile_source,
         updated_at = now()
       RETURNING user_id, lexile_min, lexile_target, lexile_max,
                 flesch_kincaid_grade, dale_chall, preferred_categories,
                 preferred_topics, updated_at`,
      [
        request.userId,
        profile.lexileBand.min,
        profile.lexileBand.target,
        profile.lexileBand.max,
        profile.fleschKincaidGrade,
        profile.daleChall,
        profile.preferredCategories,
        profile.preferredTopics,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Postgres did not return the saved user");
    return this.userFromRow(row);
  }

  async submitUserResult(
    submission: SessionFacadeSubmission,
  ): Promise<ResultOutcome> {
    const found = await this.pool.query<{
      session_id: string;
      response_document: SessionDocument;
    }>(
      `SELECT session_id, response_document
         FROM reading_sessions
        WHERE child_id = $1
          AND passage_id = $2
          AND assigned_at = $3::timestamptz
        LIMIT 2`,
      [submission.userId, submission.passage.id, submission.assignedAt],
    );
    const assignment = found.rows[0];
    if (!assignment || found.rows.length !== 1) {
      throw new SessionNotFoundError("Reading assignment not found");
    }
    const normalized = hydrateFacadeSubmission(
      assignment.response_document,
      submission,
    );
    return this.submitResult(assignment.session_id, normalized);
  }

  async healthCheck(): Promise<OperationalStoreHealth> {
    const result = await this.pool.query<{ reading_event_count: string }>(
      `SELECT count(*)::text AS reading_event_count FROM reading_events`,
    );
    const readingEventCount = Number(result.rows[0]?.reading_event_count ?? 0);
    if (!Number.isSafeInteger(readingEventCount) || readingEventCount < 0) {
      throw new Error("Postgres returned an unsafe reading event count");
    }
    return { readingEventCount };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private receiptFromRow(row: SessionRow): ResultReceipt {
    if (!row.result_id || !row.result_summary || !row.result_received_at) {
      throw new Error("Stored result is incomplete");
    }
    return {
      schemaVersion: "1.0",
      resultId: row.result_id,
      sessionId: row.session_id,
      status: "accepted",
      receivedAt: row.result_received_at.toISOString(),
      summary: row.result_summary,
      analyticsSyncStatus: "pending",
    };
  }

  private userFromRow(row: UserRow): UserInfoEntity {
    return {
      id: row.user_id,
      readingProfile: {
        lexileBand: {
          min: row.lexile_min,
          target: row.lexile_target,
          max: row.lexile_max,
        },
        fleschKincaidGrade: row.flesch_kincaid_grade,
        daleChall: row.dale_chall,
        preferredCategories: row.preferred_categories,
        preferredTopics: row.preferred_topics,
      },
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async insertEvent(
    client: PoolClient,
    event: ReadingEvent,
  ): Promise<void> {
    await client.query(
      `INSERT INTO reading_events (
         event_id, occurred_at, child_id, session_id, passage_id,
         event_type, axis, chunk_id, question_id, word, answer_index,
         is_correct, score, duration_ms, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15::jsonb
       )
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.occurredAt,
        event.childId,
        event.sessionId,
        event.passageId,
        event.eventType,
        event.axis,
        event.chunkId,
        event.questionId,
        event.word,
        event.answerIndex,
        event.isCorrect,
        event.score,
        event.durationMs,
        JSON.stringify(event.payload),
      ],
    );
  }
}
