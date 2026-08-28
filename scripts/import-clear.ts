import { resolve } from "node:path";
import XLSX from "xlsx";
import { loadSeedPassage } from "../src/content.js";
import { createPostgresPool } from "../src/postgres.js";
import { sha256, stableStringify } from "../src/utils.js";

type WorkbookRow = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text !== "Link" ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.startsWith("#")) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedLexile(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  const text = nullableString(value);
  if (!text) return null;
  const range = text.match(/(\d+)\s*L?\s*-\s*(\d+)\s*L?/i);
  if (range?.[1] && range[2]) {
    const midpoint = (Number(range[1]) + Number(range[2])) / 2;
    return Math.round(midpoint / 100) * 100;
  }
  const single = text.match(/\d+/)?.[0];
  return single ? Number(single) : null;
}

function computedWordCount(excerpt: string): number {
  return excerpt.trim().split(/\s+/u).filter(Boolean).length;
}

function computedParagraphCount(excerpt: string): number {
  return Math.max(
    1,
    excerpt
      .split(/\r?\n+/u)
      .map((part) => part.trim())
      .filter(Boolean).length,
  );
}

const workbook = XLSX.readFile(resolve("CLEAR_corpus_final.xlsx"), {
  cellDates: false,
});
const dataSheet = workbook.Sheets.Data;
if (!dataSheet) throw new Error("Workbook is missing the Data sheet");

const sourceRows = XLSX.utils.sheet_to_json<WorkbookRow>(dataSheet, {
  defval: null,
  raw: true,
});
if (sourceRows.length !== 4_724) {
  throw new Error(`Expected 4,724 CLEAR rows, found ${sourceRows.length}`);
}

const ids = new Set<number>();
const rows = sourceRows.map((row) => {
  const passageId = nullableNumber(row.ID);
  const excerpt = nullableString(row.Excerpt);
  const title = nullableString(row.Title);
  const category = nullableString(row.Categ);
  if (!passageId || !Number.isInteger(passageId) || !excerpt || !title) {
    throw new Error(`Invalid core fields for CLEAR row ${String(row.ID)}`);
  }
  if (ids.has(passageId)) throw new Error(`Duplicate passage ID ${passageId}`);
  ids.add(passageId);
  if (category !== "Lit" && category !== "Info") {
    throw new Error(`Unexpected category ${String(category)} for ${passageId}`);
  }

  const normalized = {
    passage_id: passageId,
    author: nullableString(row.Author),
    title: title.replace(/\s+/gu, " "),
    anthology: nullableString(row.Anthology),
    source_url: nullableString(row.URL),
    publication_year: nullableNumber(row["Pub Year"]),
    category,
    subcategory: nullableString(row["Sub Cat"]),
    lexile_raw: nullableString(row["Lexile Band"]),
    lexile_band: normalizedLexile(row["Lexile Band"]),
    source_location: nullableString(row.Location),
    license: nullableString(row.License),
    maturity_rating: nullableString(row["MPAA Max"]),
    excerpt,
    word_count: computedWordCount(excerpt),
    sentence_count: nullableNumber(row["Sentence Count"]),
    paragraph_count: computedParagraphCount(excerpt),
    bt_easiness: nullableNumber(row.BT_easiness),
    flesch_reading_ease: nullableNumber(row["Flesch-Reading-Ease"]),
    flesch_kincaid_grade: nullableNumber(
      row["Flesch-Kincaid-Grade-Level"],
    ),
    dale_chall: nullableNumber(row["New Dale-Chall Readability Formula"]),
  };
  return {
    ...normalized,
    source_content_hash: sha256(stableStringify(normalized)),
  };
});

if (process.argv.includes("--dry-run")) {
  const enrichedCandidateCount = rows.filter(
    (row) =>
      row.lexile_band !== null &&
      row.lexile_band <= 900 &&
      row.maturity_rating === "G",
  ).length;
  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        uniqueIds: ids.size,
        firstId: Math.min(...ids),
        lastId: Math.max(...ids),
        kidSafeCandidateCount: enrichedCandidateCount,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const connectionString =
  process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_DIRECT_URL or DATABASE_URL before importing");
}

const pool = createPostgresPool(connectionString);
try {
  const batchSize = 400;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    await pool.query(
      `INSERT INTO passages (
         passage_id, author, title, anthology, source_url, publication_year,
         category, subcategory, lexile_raw, lexile_band, source_location, license,
         maturity_rating, excerpt, word_count, sentence_count, paragraph_count,
         bt_easiness, flesch_reading_ease, flesch_kincaid_grade, dale_chall,
         source_content_hash
       )
       SELECT
         x.passage_id, x.author, x.title, x.anthology, x.source_url,
         x.publication_year, x.category, x.subcategory, x.lexile_raw,
         x.lexile_band,
         x.source_location, x.license, x.maturity_rating, x.excerpt,
         x.word_count, x.sentence_count, x.paragraph_count, x.bt_easiness,
         x.flesch_reading_ease, x.flesch_kincaid_grade, x.dale_chall,
         x.source_content_hash
       FROM jsonb_to_recordset($1::jsonb) AS x(
         passage_id integer, author text, title text, anthology text,
         source_url text, publication_year integer, category text,
         subcategory text, lexile_raw text, lexile_band integer, source_location text,
         license text, maturity_rating text, excerpt text, word_count integer,
         sentence_count integer, paragraph_count integer,
         bt_easiness double precision, flesch_reading_ease double precision,
         flesch_kincaid_grade double precision, dale_chall double precision,
         source_content_hash text
       )
       ON CONFLICT (passage_id) DO UPDATE SET
         author = EXCLUDED.author,
         title = EXCLUDED.title,
         anthology = EXCLUDED.anthology,
         source_url = EXCLUDED.source_url,
         publication_year = EXCLUDED.publication_year,
         category = EXCLUDED.category,
         subcategory = EXCLUDED.subcategory,
         lexile_raw = EXCLUDED.lexile_raw,
         lexile_band = EXCLUDED.lexile_band,
         source_location = EXCLUDED.source_location,
         license = EXCLUDED.license,
         maturity_rating = EXCLUDED.maturity_rating,
         excerpt = EXCLUDED.excerpt,
         word_count = EXCLUDED.word_count,
         sentence_count = EXCLUDED.sentence_count,
         paragraph_count = EXCLUDED.paragraph_count,
         bt_easiness = EXCLUDED.bt_easiness,
         flesch_reading_ease = EXCLUDED.flesch_reading_ease,
         flesch_kincaid_grade = EXCLUDED.flesch_kincaid_grade,
         dale_chall = EXCLUDED.dale_chall,
         enriched_document = CASE
           WHEN passages.source_content_hash IS DISTINCT FROM EXCLUDED.source_content_hash
             THEN NULL
           ELSE passages.enriched_document
         END,
         content_version = CASE
           WHEN passages.source_content_hash IS DISTINCT FROM EXCLUDED.source_content_hash
             THEN NULL
           ELSE passages.content_version
         END,
         rights_status = CASE
           WHEN passages.source_content_hash IS DISTINCT FROM EXCLUDED.source_content_hash
             THEN 'unreviewed'
           ELSE passages.rights_status
         END,
         source_content_hash = EXCLUDED.source_content_hash,
         imported_at = now()`,
      [JSON.stringify(batch)],
    );
    console.log(`Imported ${Math.min(start + batchSize, rows.length)}/${rows.length}`);
  }

  const seed = await loadSeedPassage();
  const updated = await pool.query(
    `UPDATE passages
        SET enriched_document = $2::jsonb,
            content_version = $3,
            rights_status = 'approved'
      WHERE passage_id = $1`,
    [seed.passage.id, JSON.stringify(seed), seed.passage.contentVersion],
  );
  if (updated.rowCount !== 1) {
    throw new Error("Could not attach enrichment to passage 2513");
  }
  console.log("Attached enriched JSON to passage 2513");
} finally {
  await pool.end();
}
