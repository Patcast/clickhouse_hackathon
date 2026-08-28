import type {
  EnrichedPassage,
  ResultSubmission,
  SelectPassageRequest,
  SessionFacadeSubmission,
  SessionDocument,
} from "./contract.js";
import { resultSubmissionSchema } from "./contract.js";

export function buildSessionDocument(
  content: EnrichedPassage,
  request: SelectPassageRequest,
  sessionId: string,
  assignedAt: string,
): SessionDocument {
  const categoryMatched =
    !request.preferences?.categories?.length ||
    request.preferences.categories.includes(content.passage.category);

  const reasonCodes = ["READING_BAND_MATCH"];
  if (categoryMatched && request.preferences?.categories?.length) {
    reasonCodes.push("CATEGORY_PREFERENCE_MATCH");
  }
  const searchable = [
    content.passage.title,
    ...content.chunks.map((chunk) => chunk.text),
  ]
    .join(" ")
    .toLowerCase();
  if (
    request.preferences?.topics?.some((topic) =>
      searchable.includes(topic.toLowerCase()),
    )
  ) {
    reasonCodes.push("TOPIC_PREFERENCE_MATCH");
  }

  const subject = content.passage.category === "Lit" ? "story" : "passage";
  return {
    schemaVersion: "1.0",
    sessionId,
    childId: request.childId,
    assignedAt,
    sessionStatus: "assigned",
    selection: {
      algorithmVersion: "band-match-v1",
      requestedReadingBand: request.readingBand,
      reasonCodes,
      reasonText: `A ${subject} near your reading level.`,
    },
    ...structuredClone(content),
    interactionEvents: [],
  };
}

export function hydrateFacadeSubmission(
  original: SessionDocument,
  submission: SessionFacadeSubmission,
): ResultSubmission {
  const originalChunks = new Map(
    original.chunks.map((chunk) => [chunk.chunkId, chunk]),
  );
  const originalComprehension = new Map(
    original.comprehensionQuestions.map((question) => [
      question.questionId,
      question,
    ]),
  );
  const originalVocabulary = new Map(
    original.vocabQuestions.map((question) => [question.questionId, question]),
  );

  return resultSubmissionSchema.parse({
    ...structuredClone(original),
    sessionStatus: submission.sessionStatus,
    sessionStartedAt: submission.sessionStartedAt,
    sessionFinishedAt: submission.sessionFinishedAt,
    chunks: submission.chunks.map((chunk) => ({
      ...structuredClone(originalChunks.get(chunk.chunkId) ?? {}),
      chunkId: chunk.chunkId,
      readingTime: chunk.readingTime,
      visits: chunk.visits ?? [],
    })),
    comprehensionQuestions: submission.comprehensionQuestions.map(
      (question) => ({
        ...structuredClone(
          originalComprehension.get(question.questionId) ?? {},
        ),
        questionId: question.questionId,
        answer: question.answer,
        timeSpentMs: question.timeSpentMs,
      }),
    ),
    vocabQuestions: submission.vocabQuestions.map((question) => ({
      ...structuredClone(originalVocabulary.get(question.questionId) ?? {}),
      questionId: question.questionId,
      answer: question.answer,
      timeSpentMs: question.timeSpentMs,
    })),
    interactionEvents: submission.interactionEvents,
  });
}
