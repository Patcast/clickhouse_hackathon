import { readFileSync } from "node:fs";
import { enrichedPassageSchema, type EnrichedPassage } from "./contract.js";
import { sha256, stableStringify } from "./utils.js";

const questionChunkIds: Record<string, number> = {
  c1: 2,
  c2: 4,
  c3: 6,
  v1: 1,
  v2: 5,
  v3: 6,
};

export function loadSeedPassage(): EnrichedPassage {
  const path = new URL("../passage_2513.json", import.meta.url);
  const bytes = readFileSync(path);
  const raw = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const passage = structuredClone(raw) as any;

  delete passage.passage.contentVersion;
  if (String(passage.passage.coverImageUrl ?? "").includes("placeholder.example.com")) {
    passage.passage.coverImageUrl = null;
  }
  passage.passage.attribution = {
    sourceUrl: "https://www.africanstorybook.org/",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    changesMade:
      "Excerpt chunked and supplemented with comprehension and vocabulary questions.",
  };

  passage.chunks = passage.chunks.map((chunk: any) => ({
    ...chunk,
    visits: chunk.visits ?? [],
  }));

  for (const key of ["comprehensionQuestions", "vocabQuestions"] as const) {
    passage[key] = passage[key].map((question: any) => ({
      ...question,
      chunkId: question.chunkId ?? questionChunkIds[question.questionId],
      isCorrect: question.isCorrect ?? null,
      maxScore: question.maxScore ?? 1,
      ...(key === "vocabQuestions" &&
      String(question.imageUrl ?? "").includes("placeholder.example.com")
        ? { imageUrl: null }
        : {}),
    }));
  }

  passage.passage.contentVersion = `sha256:${sha256(stableStringify(passage))}`;

  return enrichedPassageSchema.parse(passage);
}
