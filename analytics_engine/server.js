import express from 'express';
import { randomUUID } from 'crypto';
import { clickhouse } from './clickhouse.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// The student app is served from another origin (progress-api / file://)
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PORT = process.env.ANALYTICS_ENGINE_PORT || 3001;

// ClickHouse DateTime64(3) wants 'YYYY-MM-DD HH:MM:SS.mmm' (UTC)
function toCh(dateLike) {
  const d = new Date(dateLike);
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * POST /api/sessions
 *
 * Body = the passage_2513.json contract, extended with a `session` block:
 * {
 *   "session": { "sessionId"?, "studentId", "studentName"?, "classId",
 *                "grade"?, "startedAt", "finishedAt", "completed"? },
 *   "passage": { ... },
 *   "chunks": [ { chunkId, text, readingTime: {startedAt, finishedAt, durationMs} } ],
 *   "comprehensionQuestions": [ { questionId, axis, prompt, options, correctIndex, answer, timeSpentMs } ],
 *   "vocabQuestions":         [ { ..., word } ]
 * }
 */
app.post('/api/sessions', async (req, res) => {
  const { session, passage, chunks = [], comprehensionQuestions = [], vocabQuestions = [] } = req.body || {};

  if (!session || !session.studentId || !session.classId) {
    return res.status(400).json({ error: 'session.studentId and session.classId are required' });
  }
  if (!passage || !passage.id) {
    return res.status(400).json({ error: 'passage.id is required' });
  }

  const sessionId = session.sessionId || randomUUID();
  const startedAt = session.startedAt || chunks[0]?.readingTime?.startedAt || new Date().toISOString();
  const finishedAt = session.finishedAt || chunks[chunks.length - 1]?.readingTime?.finishedAt || startedAt;

  const chunkRows = chunks
    .filter((c) => c.readingTime?.durationMs != null)
    .map((c) => ({
      session_id: sessionId,
      student_id: session.studentId,
      class_id: session.classId,
      passage_id: passage.id,
      chunk_id: c.chunkId,
      chunk_word_count: wordCount(c.text || ''),
      started_at: toCh(c.readingTime.startedAt || startedAt),
      finished_at: toCh(c.readingTime.finishedAt || finishedAt),
      duration_ms: c.readingTime.durationMs,
    }));

  const questions = [...comprehensionQuestions, ...vocabQuestions];
  const questionRows = questions
    .filter((q) => q.answer != null)
    .map((q) => ({
      session_id: sessionId,
      student_id: session.studentId,
      class_id: session.classId,
      passage_id: passage.id,
      lexile_band: passage.lexileBand || 0,
      question_id: q.questionId,
      axis: q.axis,
      vocab_word: q.word || '',
      prompt: q.prompt || '',
      chosen_index: q.answer,
      correct_index: q.correctIndex,
      is_correct: q.answer === q.correctIndex ? 1 : 0,
      time_spent_ms: q.timeSpentMs || 0,
      answered_at: toCh(finishedAt),
    }));

  const totalReadingMs = chunkRows.reduce((s, c) => s + c.duration_ms, 0);
  const wordsRead = chunkRows.reduce((s, c) => s + c.chunk_word_count, 0);
  const wpm = totalReadingMs > 0 ? (wordsRead / (totalReadingMs / 60000)) : 0;

  const comp = questionRows.filter((q) => q.axis === 'comprehension');
  const vocab = questionRows.filter((q) => q.axis === 'vocabulary');

  const sessionRow = {
    session_id: sessionId,
    student_id: session.studentId,
    class_id: session.classId,
    passage_id: passage.id,
    passage_title: passage.title || '',
    lexile_band: passage.lexileBand || 0,
    fk_grade: passage.fleschKincaidGrade || 0,
    word_count: passage.wordCount || wordsRead,
    category: passage.category || '',
    started_at: toCh(startedAt),
    finished_at: toCh(finishedAt),
    total_reading_ms: totalReadingMs,
    wpm: Math.round(wpm * 10) / 10,
    comp_correct: comp.filter((q) => q.is_correct).length,
    comp_total: comprehensionQuestions.length,
    vocab_correct: vocab.filter((q) => q.is_correct).length,
    vocab_total: vocabQuestions.length,
    completed: session.completed === false ? 0 : 1,
  };

  const chSettings = { date_time_input_format: 'best_effort', async_insert: 1, wait_for_async_insert: 1 };

  try {
    const inserts = [
      clickhouse.insert({ table: 'sessions', values: [sessionRow], format: 'JSONEachRow', clickhouse_settings: chSettings }),
    ];
    if (chunkRows.length) {
      inserts.push(clickhouse.insert({ table: 'chunk_events', values: chunkRows, format: 'JSONEachRow', clickhouse_settings: chSettings }));
    }
    if (questionRows.length) {
      inserts.push(clickhouse.insert({ table: 'question_events', values: questionRows, format: 'JSONEachRow', clickhouse_settings: chSettings }));
    }
    if (session.studentName) {
      inserts.push(clickhouse.insert({
        table: 'students',
        values: [{
          student_id: session.studentId,
          name: session.studentName,
          class_id: session.classId,
          grade: session.grade || 0,
          lexile_band: passage.lexileBand || 0,
          updated_at: toCh(finishedAt),
        }],
        format: 'JSONEachRow',
        clickhouse_settings: chSettings,
      }));
    }
    await Promise.all(inserts);
    res.status(201).json({
      sessionId,
      inserted: { sessions: 1, chunk_events: chunkRows.length, question_events: questionRows.length },
      wpm: sessionRow.wpm,
    });
  } catch (err) {
    console.error('insert failed:', err);
    res.status(500).json({ error: 'failed to write session to ClickHouse', detail: String(err.message || err) });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await clickhouse.query({ query: 'SELECT 1' });
    res.json({ ok: true, clickhouse: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`analytics_engine listening on http://localhost:${PORT}`);
});
