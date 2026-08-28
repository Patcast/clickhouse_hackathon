import type {
  EnrichedPassage,
  SelectPassageRequest,
  SessionDocument,
} from "./contract.js";

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
