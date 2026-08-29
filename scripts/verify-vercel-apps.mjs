const token = process.env.PROFESSOR_MCP_TOKEN?.trim();
if (!token) throw new Error('Set PROFESSOR_MCP_TOKEN before running production verification');

const urls = {
  student: 'https://little-alexandria-student.vercel.app',
  professor: 'https://little-alexandria-professor.vercel.app',
  mcp: 'https://little-alexandria-mcp.vercel.app',
};

async function request(name, url, options = {}, expectedStatus = 200) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${name}: expected HTTP ${expectedStatus}, received ${response.status}`);
  }
  return { name, response, text };
}

const results = [];

const studentPage = await request('student page', `${urls.student}/`);
if (
  !studentPage.text.includes('<title>Little Alexandria</title>')
  || !studentPage.text.includes('class="front-door__hero"')
  || !studentPage.text.includes('data-go="student" data-door-role')
  || !studentPage.text.includes('data-go="professor" data-door-role')
  || !studentPage.text.includes('Event contract (')
  || !studentPage.text.includes('schemaVersion: "event.v1"')
  || !studentPage.text.includes('verb: "POST",     noun: "reading_session"')
) {
  throw new Error('student page: expected Little Alexandria front door or event contract not found');
}
results.push(['student page', 200, 'front door and verb-noun event contract']);

const studentHealth = await request('student health', `${urls.student}/api/health`);
const studentHealthBody = JSON.parse(studentHealth.text);
if (studentHealthBody.clickhouse !== 'connected' || studentHealthBody.writesEnabled !== true) {
  throw new Error('student health: ClickHouse is disconnected or session writes are paused');
}
results.push(['student health', 200, 'ClickHouse connected; writes enabled']);

await request('professor unauthorized check', `${urls.professor}/api/overview`, {}, 401);
results.push(['professor unauthorized', 401, 'fails closed']);

const authorization = { authorization: `Bearer ${token}` };
const professorHealth = await request(
  'professor health',
  `${urls.professor}/api/health`,
  { headers: authorization },
);
if (JSON.parse(professorHealth.text).clickhouse !== 'connected') {
  throw new Error('professor health: ClickHouse is not connected');
}
results.push(['professor health', 200, 'ClickHouse connected']);

const professorOverview = await request(
  'professor overview',
  `${urls.professor}/api/overview`,
  { headers: authorization },
);
const studentCount = JSON.parse(professorOverview.text).students?.length;
if (!studentCount) throw new Error('professor overview: no synthetic students returned');
results.push(['professor overview', 200, `${studentCount} synthetic students`]);

const mcpHeaders = {
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};
const toolsRequest = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
await request('MCP unauthorized check', `${urls.mcp}/mcp`, {
  method: 'POST',
  headers: { accept: mcpHeaders.accept, 'content-type': mcpHeaders['content-type'] },
  body: toolsRequest,
}, 401);
results.push(['MCP unauthorized', 401, 'fails closed']);

const mcpTools = await request('MCP tools', `${urls.mcp}/mcp`, {
  method: 'POST',
  headers: mcpHeaders,
  body: toolsRequest,
});
const expectedTools = ['class_overview', 'student_detail', 'class_trend', 'hardest_questions'];
if (!expectedTools.every((name) => mcpTools.text.includes(`\"name\":\"${name}\"`))) {
  throw new Error('MCP tools: expected four-tool surface was not returned');
}
results.push(['MCP tools', 200, 'four tools available']);

for (const [name, status, detail] of results) {
  console.log(`${String(status).padEnd(3)}  ${name.padEnd(24)} ${detail}`);
}
