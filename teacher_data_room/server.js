import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.TEACHER_DATA_ROOM_PORT || 3002;

async function q(query, params = {}) {
  const rs = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' });
  return rs.json();
}

// Difficulty axes from the CLEAR corpus (dataset_reference.md):
// fk_grade_max = Flesch-Kincaid syntax ceiling, dale_chall_max = Dale-Chall
// vocabulary ceiling, bt_easiness_min = human-judged easiness floor.
const DIFFICULTY_DEFAULTS = { fk_grade_max: 6, dale_chall_max: 7, bt_easiness_min: 0 };
const DIFFICULTY_RANGES = {
  fk_grade_max: [1, 12],
  dale_chall_max: [4, 12],
  bt_easiness_min: [-3, 2],
};

await clickhouse.command({
  query: `
    CREATE TABLE IF NOT EXISTS student_difficulty
    (
        student_id      UInt32,
        fk_grade_max    Float32,
        dale_chall_max  Float32,
        bt_easiness_min Float32,
        updated_at      DateTime64(3)
    )
    ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY student_id`,
});

// ---- Class overview: one row per student + class daily trend
app.get('/api/overview', async (_req, res) => {
  try {
    const [students, trend, itemAnalysis] = await Promise.all([
      q(`
        SELECT
            s.student_id                                        AS student_id,
            any(st.name)                                        AS name,
            count()                                             AS sessions,
            round(avg(s.wpm), 1)                                AS avg_wpm,
            round(100 * sum(s.comp_correct) / sum(s.comp_total), 1)   AS comp_pct,
            round(100 * sum(s.vocab_correct) / sum(s.vocab_total), 1) AS vocab_pct,
            max(s.finished_at)                                  AS last_active,
            round(avg(s.lexile_band))                           AS avg_band,
            round(100 * arrayAvg(arraySlice(groupArray(
                (s.comp_correct + s.vocab_correct) / (s.comp_total + s.vocab_total)), -20)), 1) AS recent_pct,
            round(100 * arrayAvg(arraySlice(groupArray(
                (s.comp_correct + s.vocab_correct) / (s.comp_total + s.vocab_total)), 1, 20)), 1) AS baseline_pct,
            round(arrayAvg(arraySlice(groupArray(s.lexile_band), -20))
                - arrayAvg(arraySlice(groupArray(s.lexile_band), 1, 20))) AS band_growth
        FROM (SELECT * FROM sessions ORDER BY started_at) AS s
        LEFT JOIN (SELECT student_id, name FROM students FINAL) AS st USING (student_id)
        GROUP BY s.student_id
        ORDER BY comp_pct ASC`),
      q(`
        SELECT toDate(started_at) AS day,
               round(avg(wpm), 1) AS avg_wpm,
               round(100 * sum(comp_correct + vocab_correct) / sum(comp_total + vocab_total), 1) AS accuracy_pct,
               count() AS sessions
        FROM sessions
        GROUP BY day ORDER BY day`),
      q(`
        SELECT passage_id, any(prompt) AS prompt, question_id, axis,
               count() AS answers,
               round(100 * sum(is_correct) / count(), 1) AS pct_correct
        FROM question_events
        GROUP BY passage_id, question_id, axis
        HAVING answers >= 5
        ORDER BY pct_correct ASC
        LIMIT 5`),
    ]);
    res.json({ students, trend, hardestQuestions: itemAnalysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---- Single-student detail
app.get('/api/student/:id', async (req, res) => {
  const student_id = Number(req.params.id);
  try {
    const [info, sessions, vocabGaps, timing, difficulty] = await Promise.all([
      q(`SELECT student_id, name, class_id, grade FROM students FINAL WHERE student_id = {student_id:UInt32}`, { student_id }),
      q(`
        SELECT session_id, passage_id, passage_title, lexile_band,
               toDate(started_at) AS day, started_at, wpm,
               comp_correct, comp_total, vocab_correct, vocab_total,
               round(total_reading_ms / 1000) AS reading_secs
        FROM sessions
        WHERE student_id = {student_id:UInt32}
        ORDER BY started_at`, { student_id }),
      q(`
        SELECT vocab_word, count() AS misses
        FROM question_events
        WHERE student_id = {student_id:UInt32} AND axis = 'vocabulary' AND is_correct = 0 AND vocab_word != ''
        GROUP BY vocab_word ORDER BY misses DESC`, { student_id }),
      q(`
        SELECT time_spent_ms, is_correct, axis
        FROM question_events
        WHERE student_id = {student_id:UInt32}`, { student_id }),
      q(`
        SELECT fk_grade_max, dale_chall_max, bt_easiness_min, updated_at
        FROM student_difficulty FINAL
        WHERE student_id = {student_id:UInt32}`, { student_id }),
    ]);
    res.json({
      info: info[0] || null,
      sessions,
      vocabGaps,
      timing,
      difficulty: difficulty[0] || { ...DIFFICULTY_DEFAULTS, updated_at: null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---- Teacher adjusts a student's three difficulty targets
app.post('/api/student/:id/difficulty', async (req, res) => {
  const student_id = Number(req.params.id);
  if (!Number.isInteger(student_id) || student_id <= 0) {
    return res.status(400).json({ error: 'Invalid student id' });
  }
  const row = { student_id };
  for (const [key, [min, max]] of Object.entries(DIFFICULTY_RANGES)) {
    const value = Number(req.body?.[key]);
    if (!Number.isFinite(value) || value < min || value > max) {
      return res.status(400).json({ error: `${key} must be a number between ${min} and ${max}` });
    }
    row[key] = value;
  }
  try {
    row.updated_at = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await clickhouse.insert({ table: 'student_difficulty', values: [row], format: 'JSONEachRow' });
    res.json({ ok: true, difficulty: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`teacher_data_room listening on http://localhost:${PORT}`);
});
