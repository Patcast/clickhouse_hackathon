import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { createClient } from '@clickhouse/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const PORT = process.env.ANALYTICS_MCP_PORT || 3004;

async function q(query, params = {}) {
  const rs = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' });
  return rs.json();
}

function asResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf8');

function buildServer() {
  const server = new McpServer(
    { name: 'reading-analytics', version: '1.0.0' },
    { instructions: SYSTEM_PROMPT }
  );

  server.registerTool(
    'class_overview',
    {
      title: 'Class overview',
      description:
        'One row per student in the class: name, session count, average words-per-minute, ' +
        'comprehension % and vocabulary % (all-time), average Lexile band, Lexile band growth ' +
        '(recent 20 sessions vs first 20), recent vs baseline accuracy, and last active date. ' +
        'Sorted weakest comprehension first. Use this first to find student ids by name and to ' +
        'spot who is struggling (recent_pct well below baseline_pct, or low comp_pct).',
      inputSchema: {},
    },
    async () => {
      const students = await q(`
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
        ORDER BY comp_pct ASC`);
      return asResult({ students });
    },
  );

  server.registerTool(
    'student_detail',
    {
      title: 'Student detail',
      description:
        'Everything about one student: profile, full session timeline (passage, Lexile band, wpm, ' +
        'comprehension and vocabulary scores per session), vocabulary words they keep missing, and ' +
        'their current teacher-set difficulty targets. Get student_id from class_overview.',
      inputSchema: { student_id: z.number().int().positive().describe('Numeric student id, e.g. 101') },
    },
    async ({ student_id }) => {
      const [info, sessions, vocabGaps, difficulty] = await Promise.all([
        q(`SELECT student_id, name, class_id, grade FROM students FINAL WHERE student_id = {student_id:UInt32}`, { student_id }),
        q(`
          SELECT passage_id, passage_title, lexile_band,
                 toDate(started_at) AS day, wpm,
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
          SELECT fk_grade_max, dale_chall_max, bt_easiness_min, updated_at
          FROM student_difficulty FINAL
          WHERE student_id = {student_id:UInt32}`, { student_id }),
      ]);
      return asResult({
        info: info[0] || null,
        sessions,
        vocabGaps,
        difficulty: difficulty[0] || null,
      });
    },
  );

  server.registerTool(
    'class_trend',
    {
      title: 'Class daily trend',
      description:
        'Class-wide daily trend: average words-per-minute, overall accuracy %, and session count per day. ' +
        'Use for "how is the class doing over time" questions.',
      inputSchema: {},
    },
    async () => {
      const trend = await q(`
        SELECT toDate(started_at) AS day,
               round(avg(wpm), 1) AS avg_wpm,
               round(100 * sum(comp_correct + vocab_correct) / sum(comp_total + vocab_total), 1) AS accuracy_pct,
               count() AS sessions
        FROM sessions
        GROUP BY day ORDER BY day`);
      return asResult({ trend });
    },
  );

  server.registerTool(
    'hardest_questions',
    {
      title: 'Hardest questions',
      description:
        'Item analysis: the questions the class gets wrong most often (with prompt, passage id, axis, ' +
        'answer count and % correct). Use for "what should I re-teach" questions.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10).describe('How many questions to return'),
      },
    },
    async ({ limit }) => {
      const hardest = await q(`
        SELECT passage_id, any(prompt) AS prompt, question_id, axis,
               count() AS answers,
               round(100 * sum(is_correct) / count(), 1) AS pct_correct
        FROM question_events
        GROUP BY passage_id, question_id, axis
        HAVING answers >= 5
        ORDER BY pct_correct ASC
        LIMIT {limit:UInt32}`, { limit });
      return asResult({ hardest });
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Stateless streamable-http: a fresh server+transport pair per request.
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('mcp request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
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
  console.log(`analytics_mcp (MCP streamable-http) listening on http://localhost:${PORT}/mcp`);
});
