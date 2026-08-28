import { z } from "zod";

const POSTGRES_INT_MAX = 2_147_483_647;
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();
const nullableDuration = z
  .number()
  .int()
  .nonnegative()
  .max(POSTGRES_INT_MAX)
  .nullable();
const positivePostgresInt = z
  .number()
  .int()
  .positive()
  .max(POSTGRES_INT_MAX);

export const readingBandSchema = z
  .object({
    system: z.literal("lexile"),
    min: z.number().int().nonnegative().max(3_000),
    max: z.number().int().nonnegative().max(3_000),
    target: z.number().int().nonnegative().max(3_000),
  })
  .superRefine((band, context) => {
    if (band.min > band.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "readingBand.min must be less than or equal to max",
        path: ["min"],
      });
    }
    if (band.target < band.min || band.target > band.max) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "readingBand.target must be between min and max",
        path: ["target"],
      });
    }
  });

export const selectPassageRequestSchema = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  childId: z.string().trim().min(1).max(128),
  readingBand: readingBandSchema,
  preferences: z
    .object({
      categories: z.array(z.enum(["Lit", "Info"])).max(2).optional(),
      topics: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    })
    .optional(),
  excludePassageIds: z.array(positivePostgresInt).max(500).default([]),
});

const readingTimeSchema = z.object({
  startedAt: nullableTimestamp,
  finishedAt: nullableTimestamp,
  durationMs: nullableDuration,
});

const visitSchema = z.object({
  visitId: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative().max(POSTGRES_INT_MAX),
});

export const chunkSchema = z
  .object({
    chunkId: positivePostgresInt,
    text: z.string().min(1),
    readingTime: readingTimeSchema,
    visits: z.array(visitSchema).optional(),
  })
  .passthrough();

const questionBaseSchema = z
  .object({
    questionId: z.string().min(1),
    chunkId: positivePostgresInt,
    axis: z.enum(["comprehension", "vocabulary"]),
    prompt: z.string().min(1),
    options: z.array(z.string()).min(2),
    correctIndex: z.number().int().nonnegative(),
    answer: z.number().int().nonnegative().nullable(),
    isCorrect: z.boolean().nullable().optional(),
    score: z.number().nonnegative(),
    maxScore: z.number().positive().optional(),
    timeSpentMs: nullableDuration,
  })
  .passthrough();

export const comprehensionQuestionSchema = questionBaseSchema.extend({
  axis: z.literal("comprehension"),
});

export const vocabQuestionSchema = questionBaseSchema.extend({
  axis: z.literal("vocabulary"),
  word: z.string().min(1),
  imageUrl: z.string().url().nullable(),
});

export const enrichedPassageSchema = z.object({
  passage: z
    .object({
      id: positivePostgresInt,
      contentVersion: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
      title: z.string().min(1),
      author: z.string().nullable(),
      source: z.string().nullable(),
      license: z.string().nullable(),
      category: z.enum(["Lit", "Info"]),
      lexileBand: z.number().int().nonnegative().max(3_000).nullable(),
      fleschKincaidGrade: z.number().nullable(),
      daleChall: z.number().nullable(),
      wordCount: positivePostgresInt,
      coverImageUrl: z.string().url().nullable(),
      attribution: z
        .object({
          sourceUrl: z.string().url(),
          licenseUrl: z.string().url(),
          changesMade: z.string().min(1).max(500),
        })
        .optional(),
    })
    .passthrough(),
  chunks: z.array(chunkSchema).min(1).max(500),
  comprehensionQuestions: z.array(comprehensionQuestionSchema),
  vocabQuestions: z.array(vocabQuestionSchema),
}).superRefine((document, context) => {
  const chunkIds = document.chunks.map((chunk) => chunk.chunkId);
  if (new Set(chunkIds).size !== chunkIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "chunkId values must be unique",
      path: ["chunks"],
    });
  }

  const validChunkIds = new Set(chunkIds);
  const questions = [
    ...document.comprehensionQuestions.map((question, index) => ({
      question,
      path: ["comprehensionQuestions", index] as const,
    })),
    ...document.vocabQuestions.map((question, index) => ({
      question,
      path: ["vocabQuestions", index] as const,
    })),
  ];
  const questionIds = questions.map(({ question }) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "questionId values must be unique across both question sets",
      path: ["comprehensionQuestions"],
    });
  }
  for (const { question, path } of questions) {
    if (question.correctIndex >= question.options.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correctIndex must point to an option",
        path: [...path, "correctIndex"],
      });
    }
    if (!validChunkIds.has(question.chunkId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "question chunkId must reference an assigned chunk",
        path: [...path, "chunkId"],
      });
    }
  }
});

const interactionEventSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    type: z.enum(["word_lookup", "word_tap", "pause", "resume", "reread"]),
    occurredAt: z.string().datetime({ offset: true }),
    chunkId: positivePostgresInt.optional(),
    questionId: z.string().min(1).max(128).optional(),
    word: z.string().trim().min(1).max(128).optional(),
    durationMs: z.number().int().nonnegative().max(POSTGRES_INT_MAX).optional(),
    metadata: z
      .record(z.string().max(80), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 8_192, {
        message: "interaction metadata must be no larger than 8 KiB",
      })
      .optional(),
  })
  .passthrough()
  .superRefine((event, context) => {
    if (
      (event.type === "word_lookup" || event.type === "word_tap") &&
      (!event.word || !event.chunkId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "word interactions require word and chunkId",
      });
    }
  });

export const sessionDocumentSchema = enrichedPassageSchema.safeExtend({
  schemaVersion: z.literal("1.0"),
  sessionId: z.string().uuid(),
  childId: z.string().min(1),
  assignedAt: z.string().datetime({ offset: true }),
  sessionStatus: z.enum(["assigned", "completed", "abandoned"]),
  sessionStartedAt: z.string().datetime({ offset: true }).nullable().optional(),
  sessionFinishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  selection: z.object({
    algorithmVersion: z.literal("band-match-v1"),
    requestedReadingBand: readingBandSchema,
    reasonCodes: z.array(z.string()),
    reasonText: z.string(),
  }),
  interactionEvents: z.array(interactionEventSchema).max(1_000).default([]),
});

export const resultSubmissionSchema = sessionDocumentSchema.safeExtend({
  sessionStatus: z.enum(["completed", "abandoned"]),
  sessionStartedAt: z.string().datetime({ offset: true }),
  sessionFinishedAt: z.string().datetime({ offset: true }),
});

export type SelectPassageRequest = z.infer<typeof selectPassageRequestSchema>;
export type EnrichedPassage = z.infer<typeof enrichedPassageSchema>;
export type SessionDocument = z.infer<typeof sessionDocumentSchema>;
export type ResultSubmission = z.infer<typeof resultSubmissionSchema>;

export interface AxisSummary {
  correct: number;
  possible: number;
  percent: number;
}

export interface ResultSummary {
  totalActiveReadingMs: number;
  comprehension: AxisSummary;
  vocabulary: AxisSummary;
}

export interface ResultReceipt {
  schemaVersion: "1.0";
  resultId: string;
  sessionId: string;
  status: "accepted";
  receivedAt: string;
  summary: ResultSummary;
  analyticsSyncStatus: "pending";
}
