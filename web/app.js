const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const personas = {
  maya: { childId: "child_maya", min: 400, target: 500, max: 600, topics: "animals, folktales", categories: ["Lit"] },
  sam: { childId: "child_sam", min: 420, target: 520, max: 620, topics: "animals, adventure", categories: ["Lit"] },
};

const wordDefinitions = {
  horned: "Having one or more horns on the head.",
  commanded: "Gave an order that should be followed.",
  snout: "An animal’s nose and mouth that project forward.",
  wax: "A soft material that melts when it gets warm.",
  clever: "Quick to understand, learn, or solve something.",
  flattened: "Made level, smooth, or less rounded.",
};

const analyticsMetrics = [
  ["activeReadingMs", "Reading time", (value) => seconds(value)],
  ["comprehensionAttempts", "Comprehension", (value) => String(value)],
  ["comprehensionCorrect", "Comp. correct", (value) => String(value)],
  ["vocabularyAttempts", "Vocabulary", (value) => String(value)],
  ["vocabularyCorrect", "Vocab. correct", (value) => String(value)],
  ["wordLookups", "Word lookups", (value) => String(value)],
  ["abandonments", "Abandonments", (value) => String(value)],
];
const analyticsPollIntervalMs = 3_000;
const analyticsPollTimeoutMs = 90_000;

const state = {
  health: null,
  session: null,
  selectionRequest: null,
  startedAtMs: null,
  activeVisit: null,
  lastActiveChunkId: null,
  paused: false,
  pauseStartedMs: null,
  pausedTotalMs: 0,
  activeQuestionId: null,
  questionStartedAtMs: null,
  resumeQuestionId: null,
  exchanges: [],
  activeExchange: -1,
  preparedPayload: null,
  receipt: null,
  resultStatus: null,
  submitted: false,
  analyticsBaseline: null,
  analyticsExpected: null,
  analyticsActualDelta: null,
  analyticsDays: [],
  analyticsSync: { status: "idle", attempts: 0, startedAtMs: null, message: "" },
  analyticsPollTimer: null,
  analyticsPollGeneration: 0,
  diagnostics: [],
};

let toastTimer;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function nowMs() {
  const assigned = state.session ? Date.parse(state.session.assignedAt) + 1 : 0;
  return Math.max(Date.now(), assigned);
}

function seconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  const minutes = Math.floor(ms / 60_000);
  const remainder = Math.floor((ms % 60_000) / 1_000);
  return `${minutes}m ${remainder}s`;
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1_000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function newKey() {
  return `team-lab-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function applyPersona(name) {
  const profile = personas[name];
  if (!profile) return;
  $("#childId").value = profile.childId;
  $("#lexileMin").value = profile.min;
  $("#lexileTarget").value = profile.target;
  $("#lexileMax").value = profile.max;
  $("#topics").value = profile.topics;
  $$("input[name='category']").forEach((input) => { input.checked = profile.categories.includes(input.value); });
}

async function fetchJson(path, options = {}, { record = true, allowError = false } = {}) {
  const method = options.method ?? "GET";
  const requestHeaders = Object.fromEntries(new Headers(options.headers ?? {}).entries());
  let requestBody = null;
  if (options.body) {
    try { requestBody = JSON.parse(options.body); } catch { requestBody = options.body; }
  }
  const exchange = {
    at: new Date().toISOString(),
    method,
    path,
    request: { headers: requestHeaders, ...(requestBody === null ? {} : { body: requestBody }) },
    response: null,
    status: null,
  };

  try {
    const response = await fetch(path, options);
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    exchange.status = response.status;
    exchange.response = {
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
    if (record) recordExchange(exchange);
    if (!response.ok && !allowError) {
      const message = body?.error?.message ?? `${method} ${path} returned ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return { body, response };
  } catch (error) {
    if (exchange.status === null) {
      exchange.response = { networkError: error instanceof Error ? error.message : String(error) };
      if (record) recordExchange(exchange);
    }
    throw error;
  }
}

function recordExchange(exchange) {
  state.exchanges.push(exchange);
  state.activeExchange = state.exchanges.length - 1;
  renderInspector();
}

function renderInspector() {
  const select = $("#exchangeSelect");
  if (state.exchanges.length) {
    select.innerHTML = state.exchanges.map((item, index) =>
      `<option value="${index}" ${index === state.activeExchange ? "selected" : ""}>${escapeHtml(`${index + 1}. ${item.method} ${item.path}`)}</option>`,
    ).join("");
    const exchange = state.exchanges[state.activeExchange];
    $("#requestCode").textContent = pretty({ method: exchange.method, path: exchange.path, ...exchange.request });
    $("#responseCode").textContent = pretty(exchange.response);
    const status = $("#exchangeStatus");
    status.textContent = exchange.status === null ? "NETWORK ERROR" : `HTTP ${exchange.status}`;
    status.className = exchange.status && exchange.status < 400 ? "is-ok" : "is-error";
  }

  const events = state.session?.interactionEvents ?? [];
  $("#eventCountBadge").textContent = String(events.length);
  $("#eventTableBody").innerHTML = events.length
    ? [...events].reverse().map((event) => `<tr>
        <td>${escapeHtml(shortTime(event.occurredAt))}</td>
        <td>${escapeHtml(event.type)}</td>
        <td>${escapeHtml(event.chunkId ?? "—")}</td>
        <td>${escapeHtml(event.word ?? (event.durationMs === undefined ? "—" : seconds(event.durationMs)))}</td>
      </tr>`).join("")
    : '<tr><td colspan="4">No client interactions captured yet.</td></tr>';
  $("#payloadCode").textContent = state.preparedPayload ? pretty(state.preparedPayload) : "Complete or abandon a session to inspect the submitted document.";
}

async function refreshHealth() {
  const header = $("#headerStatus");
  header.className = "status-pill is-loading";
  header.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Checking API';
  try {
    const { body } = await fetchJson("/health", {}, { record: false });
    state.health = body;
    const operationalReachable = body.checks?.operationalStore?.status === "reachable";
    const analyticsReachable = body.checks?.analyticsStore?.status === "reachable";
    const postgresReady = body.operationalStore === "postgres" && operationalReachable;
    const clickhouseReady = body.analyticsStore === "clickhouse" && analyticsReachable;
    const cloudReady = body.status === "ok" && postgresReady && clickhouseReady;
    const readingEventCount = body.checks?.operationalStore?.readingEventCount;
    const replicatedEventCount = body.checks?.analyticsStore?.replicatedEventCount;
    if (!$("#selectButton").classList.contains("is-busy")) $("#selectButton").disabled = false;
    header.className = `status-pill ${cloudReady ? "is-ok" : body.status === "degraded" ? "is-error" : "is-warning"}`;
    header.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${cloudReady ? "Cloud probes healthy" : body.status === "degraded" ? "Cloud probes degraded" : "Local demo online"}`;
    $("#readinessList").innerHTML = [
      readinessRow(cloudReady || body.operationalStore === "memory" ? "ok" : "warning", "Backend API", `${body.status === "ok" ? "Healthy" : "Degraded"} · contract ${body.schemaVersion ?? "1.0"}`),
      readinessRow(postgresReady ? "ok" : body.operationalStore === "memory" ? "warning" : "error", "Managed Postgres", postgresReady ? `Reachable · ${Number(readingEventCount ?? 0).toLocaleString()} reading events` : body.operationalStore === "memory" ? "Memory demo mode · no persistence" : "Configured but probe failed"),
      readinessRow(clickhouseReady ? "ok" : body.analyticsStore === "not-configured" ? "warning" : "error", "ClickHouse analytics", clickhouseReady ? `Reachable · ${Number(replicatedEventCount ?? 0).toLocaleString()} replicated events` : body.analyticsStore === "not-configured" ? "Not configured · progress will return 503" : "Configured but probe failed"),
    ].join("");
    $("#statusNote").innerHTML = cloudReady
      ? `<strong>End-to-end probes passed.</strong><span>Postgres reports ${escapeHtml(Number(readingEventCount ?? 0).toLocaleString())} source events; ClickHouse reports ${escapeHtml(Number(replicatedEventCount ?? 0).toLocaleString())} replicated events.</span>`
      : "<strong>Local-first by design.</strong><span>The full passage flow still works. Connect the cloud stores to test persistence and analytics.</span>";
  } catch (error) {
    state.health = null;
    if (error.status === 401) {
      showAccessRequired("This browser does not have an active team-lab access cookie. Open the protected link supplied by the project owner.");
      return;
    }
    header.className = "status-pill is-error";
    header.innerHTML = '<span class="status-dot" aria-hidden="true"></span>API offline';
    $("#readinessList").innerHTML = [
      readinessRow("error", "Backend API", "Could not reach /health"),
      readinessRow("error", "Managed Postgres", "Backend unavailable"),
      readinessRow("error", "ClickHouse analytics", "Backend unavailable"),
    ].join("");
    $("#statusNote").innerHTML = `<strong>Start the local API.</strong><span>${escapeHtml(error.message)}. Run the project dev command, then refresh.</span>`;
  }
}

function showAccessRequired(message) {
  const header = $("#headerStatus");
  header.className = "status-pill is-warning";
  header.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Access required';
  $("#selectButton").disabled = true;
  $("#readinessList").innerHTML = [
    readinessRow("warning", "Protected team lab", "Access cookie required"),
    readinessRow("warning", "Managed Postgres", "Hidden until access is granted"),
    readinessRow("warning", "ClickHouse analytics", "Hidden until access is granted"),
  ].join("");
  $("#statusNote").innerHTML = `<strong>Access required.</strong><span>${escapeHtml(message)} The URL token is exchanged for a secure cookie and is never kept in the page or inspector.</span>`;
}

function takeFragmentAccessToken() {
  const parameters = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const token = parameters.get("access_token");
  if (token !== null) history.replaceState(null, "", `${location.pathname}${location.search}`);
  return token;
}

async function exchangeAccessToken(token) {
  const header = $("#headerStatus");
  header.className = "status-pill is-loading";
  header.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Verifying access';
  try {
    const response = await fetch("/api/team-lab/auth", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.status === 204) return true;
    showAccessRequired(response.status === 401 ? "That protected link is invalid or has expired." : `Access exchange returned HTTP ${response.status}.`);
    return false;
  } catch {
    showAccessRequired("The access exchange could not reach the team-lab server.");
    return false;
  }
}

function readinessRow(status, title, note) {
  const symbol = status === "ok" ? "✓" : status === "warning" ? "!" : "×";
  return `<div class="readiness-row is-${status}"><span class="readiness-icon">${symbol}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(note)}</small></div></div>`;
}

function cloudHealthReady() {
  return Boolean(
    state.health?.status === "ok" &&
    state.health?.operationalStore === "postgres" &&
    state.health?.analyticsStore === "clickhouse" &&
    state.health?.checks?.operationalStore?.status === "reachable" &&
    state.health?.checks?.analyticsStore?.status === "reachable"
  );
}

function selectionBody() {
  const min = Number($("#lexileMin").value);
  const target = Number($("#lexileTarget").value);
  const max = Number($("#lexileMax").value);
  if (!Number.isInteger(min) || !Number.isInteger(target) || !Number.isInteger(max) || min > target || target > max) {
    throw new Error("Lexile values must be whole numbers ordered minimum ≤ target ≤ maximum.");
  }
  const categories = $$("input[name='category']:checked").map((input) => input.value);
  const topics = $("#topics").value.split(",").map((value) => value.trim()).filter(Boolean);
  const excludePassageIds = $("#excludeIds").value.split(",").map((value) => value.trim()).filter(Boolean).map(Number);
  if (excludePassageIds.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("Excluded passage IDs must be positive whole numbers.");
  }
  return {
    schemaVersion: "1.0",
    childId: $("#childId").value.trim(),
    readingBand: { system: "lexile", min, max, target },
    ...(categories.length || topics.length ? { preferences: { ...(categories.length ? { categories } : {}), ...(topics.length ? { topics } : {}) } } : {}),
    excludePassageIds,
  };
}

function renderSelectionRequestPreview() {
  const preview = $("#selectionRequestPreview");
  if (!preview) return;
  const key = $("#idempotencyKey").value.trim() || "(required)";
  const requestLine = "POST /api/v1/passages/select";
  const headers = `Content-Type: application/json\nIdempotency-Key: ${key}`;
  try {
    preview.textContent = `${requestLine}\n${headers}\n\n${pretty(selectionBody())}`;
    preview.classList.remove("is-invalid");
  } catch (error) {
    preview.textContent = `${requestLine}\n${headers}\n\nRequest body is invalid: ${error.message}`;
    preview.classList.add("is-invalid");
  }
}

async function selectPassage(event) {
  event.preventDefault();
  showError($("#selectionError"), "");
  const button = $("#selectButton");
  try {
    const body = selectionBody();
    if (!body.childId) throw new Error("Child ID is required.");
    const key = $("#idempotencyKey").value.trim();
    if (!key) throw new Error("Idempotency key is required.");
    button.disabled = true;
    button.classList.add("is-busy");
    const result = await fetchJson("/api/v1/passages/select", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
    });
    resetSessionState();
    state.session = structuredClone(result.body);
    state.selectionRequest = body;
    renderAssignment();
    const replay = result.response.headers.get("x-idempotent-replay") === "true";
    toast(replay ? "Safe retry confirmed — the same assignment was replayed." : "One matched passage assigned.");
    $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError($("#selectionError"), error.message);
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
  }
}

function resetSessionState() {
  stopAnalyticsPolling();
  state.session = null;
  state.startedAtMs = null;
  state.activeVisit = null;
  state.lastActiveChunkId = null;
  state.paused = false;
  state.pauseStartedMs = null;
  state.pausedTotalMs = 0;
  state.activeQuestionId = null;
  state.questionStartedAtMs = null;
  state.resumeQuestionId = null;
  state.preparedPayload = null;
  state.receipt = null;
  state.resultStatus = null;
  state.submitted = false;
  state.analyticsBaseline = null;
  state.analyticsExpected = null;
  state.analyticsActualDelta = null;
  state.analyticsDays = [];
  state.analyticsSync = { status: "idle", attempts: 0, startedAtMs: null, message: "" };
  state.diagnostics = [];
  $("#resultsArea").hidden = true;
  showError($("#submitError"), "");
}

function stopAnalyticsPolling() {
  clearTimeout(state.analyticsPollTimer);
  state.analyticsPollTimer = null;
  state.analyticsPollGeneration += 1;
}

function renderAssignment() {
  const session = state.session;
  $("#emptyWorkspace").hidden = true;
  $("#readingWorkspace").hidden = false;
  $("#passageCategory").textContent = session.passage.category === "Lit" ? "Literature" : "Informational";
  $("#passageLexile").textContent = session.passage.lexileBand === null ? "No Lexile" : `${session.passage.lexileBand}L`;
  $("#passageWordCount").textContent = `${session.passage.wordCount} words`;
  $("#passageTitle").textContent = session.passage.title;
  $("#passageByline").textContent = [session.passage.author, session.passage.source].filter(Boolean).join(" · ");
  $("#copySessionButton").textContent = `${session.sessionId.slice(0, 8)}…`;
  $("#copySessionButton").dataset.copyValue = session.sessionId;
  $("#matchReason").innerHTML = `<strong>Why this match:</strong> ${escapeHtml(session.selection.reasonText)} <span>(${escapeHtml(session.selection.reasonCodes.join(", "))})</span>`;
  $("#sessionLaunch").hidden = false;
  $("#readingProgress").hidden = true;
  $("#headerStatus").title = `Session ${session.sessionId}`;
  renderChunks();
  renderQuestions();
  renderTelemetry();
  renderInspector();
  updateSubmissionReadiness();
}

function beginSession() {
  if (!state.session || state.startedAtMs) return;
  state.startedAtMs = nowMs();
  state.session.sessionStartedAt = toIso(state.startedAtMs);
  state.paused = false;
  $("#sessionLaunch").hidden = true;
  $("#readingProgress").hidden = false;
  $("#sessionClock").hidden = false;
  $("#pauseButton").hidden = false;
  $("#captureState").className = "pulse-label is-live";
  $("#captureState").innerHTML = "<i></i> Capturing";
  renderChunks();
  renderQuestions();
  toast("Session timing started. Open the first chunk when the reader is ready.");
}

function pushInteraction(type, details = {}, occurredAtMs = nowMs()) {
  if (!state.session || !state.startedAtMs) return;
  state.session.interactionEvents.push({
    eventId: crypto.randomUUID(),
    type,
    occurredAt: toIso(Math.max(occurredAtMs, state.startedAtMs)),
    ...details,
  });
  renderTelemetry();
  renderInspector();
}

function startChunk(chunkId, { reread = false, quiet = false } = {}) {
  if (!state.startedAtMs) beginSession();
  if (state.paused) {
    toast("Resume the session before opening another chunk.");
    return;
  }
  if (state.activeVisit?.chunkId === chunkId) return;
  closeActiveVisit(nowMs(), { quiet: true });
  const chunk = state.session.chunks.find((item) => item.chunkId === chunkId);
  if (!chunk) return;
  const startedAtMs = nowMs();
  if (!chunk.readingTime.startedAt) chunk.readingTime.startedAt = toIso(startedAtMs);
  state.activeVisit = { chunkId, startedAtMs, visitId: crypto.randomUUID() };
  state.lastActiveChunkId = chunkId;
  if (reread) pushInteraction("reread", { chunkId }, startedAtMs);
  renderChunks();
  renderTelemetry();
  if (!quiet) toast(reread ? `Reread visit started for chunk ${chunkId}.` : `Chunk ${chunkId} timing started.`);
}

function closeActiveVisit(finishedAtMs = nowMs(), { quiet = false } = {}) {
  const active = state.activeVisit;
  if (!active || !state.session) return;
  const chunk = state.session.chunks.find((item) => item.chunkId === active.chunkId);
  if (!chunk) return;
  const finished = Math.max(finishedAtMs, active.startedAtMs);
  const visit = {
    visitId: active.visitId,
    startedAt: toIso(active.startedAtMs),
    finishedAt: toIso(finished),
    durationMs: Math.max(0, Math.round(finished - active.startedAtMs)),
  };
  chunk.visits = [...(chunk.visits ?? []), visit];
  chunk.readingTime.finishedAt = visit.finishedAt;
  chunk.readingTime.durationMs = chunk.visits.reduce((sum, item) => sum + item.durationMs, 0);
  state.activeVisit = null;
  renderChunks();
  renderTelemetry();
  updateSubmissionReadiness();
  if (!quiet) toast(`Chunk ${chunk.chunkId} visit saved (${seconds(visit.durationMs)}).`);
}

function togglePause() {
  if (!state.startedAtMs || state.submitted) return;
  const button = $("#pauseButton");
  if (!state.paused) {
    const at = nowMs();
    closeActiveVisit(at, { quiet: true });
    state.resumeQuestionId = state.activeQuestionId;
    freezeActiveQuestion(at);
    state.paused = true;
    state.pauseStartedMs = at;
    pushInteraction("pause", {}, at);
    button.textContent = "Resume session";
    $("#captureState").className = "pulse-label";
    $("#captureState").innerHTML = "<i></i> Paused";
    toast("Session paused. Active reading time is stopped.");
  } else {
    const at = nowMs();
    const durationMs = Math.max(0, at - state.pauseStartedMs);
    state.pausedTotalMs += durationMs;
    state.paused = false;
    state.pauseStartedMs = null;
    pushInteraction("resume", { durationMs }, at);
    if (state.resumeQuestionId) {
      state.activeQuestionId = state.resumeQuestionId;
      state.questionStartedAtMs = at;
      state.resumeQuestionId = null;
    }
    button.textContent = "Pause session";
    $("#captureState").className = "pulse-label is-live";
    $("#captureState").innerHTML = "<i></i> Capturing";
    toast("Session resumed.");
  }
  renderChunks();
  renderQuestions();
}

function wordsHtml(text, chunkId) {
  return text.split(/(\s+)/u).map((part) => {
    if (/^\s+$/u.test(part)) return part;
    const word = part.match(/[A-Za-z][A-Za-z'’\-]*/u)?.[0];
    if (!word) return escapeHtml(part);
    return `<button class="word-button" type="button" data-word="${escapeHtml(word)}" data-chunk-id="${chunkId}" ${!state.startedAtMs || state.paused || state.submitted ? "disabled" : ""} aria-label="Look up ${escapeHtml(word)}">${escapeHtml(part)}</button>`;
  }).join("");
}

function renderChunks() {
  if (!state.session) return;
  $("#chunkList").innerHTML = state.session.chunks.map((chunk, index) => {
    const active = state.activeVisit?.chunkId === chunk.chunkId;
    const complete = chunk.readingTime.durationMs !== null;
    const visits = chunk.visits?.length ?? 0;
    const duration = (chunk.readingTime.durationMs ?? 0) + (active ? nowMs() - state.activeVisit.startedAtMs : 0);
    return `<section class="chunk-card ${active ? "is-active" : ""} ${complete ? "is-complete" : ""}" data-chunk="${chunk.chunkId}">
      <div class="chunk-card-header">
        <span class="chunk-number"><b>${index + 1}</b> Chunk ${chunk.chunkId}</span>
        <span class="chunk-stats">${visits} ${visits === 1 ? "visit" : "visits"} · ${escapeHtml(seconds(duration))}</span>
      </div>
      <p class="chunk-text">${wordsHtml(chunk.text, chunk.chunkId)}</p>
      <div class="chunk-actions">
        <span class="chunk-state ${active ? "is-live" : ""}">${active ? "● Reading timer live" : complete ? "✓ Visit captured" : state.startedAtMs ? "Ready to open" : "Start the session first"}</span>
        <div class="chunk-action-buttons">
          ${complete && !active ? `<button class="chunk-button" type="button" data-action="reread" data-chunk-id="${chunk.chunkId}" ${state.paused || state.submitted ? "disabled" : ""}>Reread</button>` : ""}
          <button class="chunk-button ${active ? "is-stop" : ""}" type="button" data-action="${active ? "stop-chunk" : "start-chunk"}" data-chunk-id="${chunk.chunkId}" ${!state.startedAtMs || state.paused || state.submitted ? "disabled" : ""}>${active ? "Done for now" : complete ? "Open again" : "Open chunk"}</button>
        </div>
      </div>
    </section>`;
  }).join("");
  const completed = state.session.chunks.filter((chunk) => chunk.readingTime.durationMs !== null).length;
  $("#chunkCompletion").textContent = `${completed} of ${state.session.chunks.length} read`;
  updateOverallProgress();
}

function lookupWord(word, chunkId) {
  if (!state.startedAtMs || state.paused || state.submitted) return;
  const normalized = word.toLowerCase().replace(/[^a-z'’-]/gu, "");
  pushInteraction("word_lookup", { chunkId, word: normalized, metadata: { source: "team-lab-inline" } });
  $("#lookupWord").textContent = normalized;
  $("#lookupDefinition").textContent = wordDefinitions[normalized] ?? `“${normalized}” was saved for a teacher or dictionary follow-up.`;
  toast(`Word lookup captured: ${normalized}`);
}

function allQuestions() {
  if (!state.session) return [];
  return [...state.session.comprehensionQuestions, ...state.session.vocabQuestions];
}

function findQuestion(questionId) {
  return allQuestions().find((question) => question.questionId === questionId);
}

function freezeActiveQuestion(finishedAtMs = nowMs()) {
  if (!state.activeQuestionId || state.questionStartedAtMs === null) return;
  const question = findQuestion(state.activeQuestionId);
  if (question) {
    const elapsed = Math.max(1, Math.round(finishedAtMs - state.questionStartedAtMs));
    question.timeSpentMs = (question.timeSpentMs ?? 0) + elapsed;
  }
  state.activeQuestionId = null;
  state.questionStartedAtMs = null;
}

function renderQuestions() {
  if (!state.session) return;
  $("#comprehensionQuestions").innerHTML = state.session.comprehensionQuestions.map(questionHtml).join("");
  $("#vocabQuestions").innerHTML = state.session.vocabQuestions.map(questionHtml).join("");
  const questions = allQuestions();
  const answered = questions.filter((question) => question.answer !== null).length;
  $("#questionCompletion").textContent = `${answered} of ${questions.length} answered`;
  updateOverallProgress();
  updateSubmissionReadiness();
}

function questionHtml(question, index) {
  const active = state.activeQuestionId === question.questionId;
  const answered = question.answer !== null;
  const elapsed = (question.timeSpentMs ?? 0) + (active && state.questionStartedAtMs !== null ? nowMs() - state.questionStartedAtMs : 0);
  const enabled = Boolean(state.startedAtMs) && !state.paused && !state.submitted;
  const hasTiming = question.timeSpentMs !== null;
  return `<article class="question-card ${answered ? "is-answered" : ""} ${active ? "is-timing" : ""}" data-question-id="${escapeHtml(question.questionId)}">
    ${question.word ? `<span class="question-word">${escapeHtml(question.word)}</span>` : ""}
    <div class="question-top"><p>${escapeHtml(question.prompt)}</p><span class="question-timer" data-question-clock="${escapeHtml(question.questionId)}">${clock(elapsed)}</span></div>
    ${active || answered ? `<div class="options-list">${question.options.map((option, optionIndex) => `<label class="option-label">
      <input type="radio" name="question-${escapeHtml(question.questionId)}" value="${optionIndex}" ${question.answer === optionIndex ? "checked" : ""} ${!enabled || !active ? "disabled" : ""} />
      <span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span>
    </label>`).join("")}</div>` : `<button class="button button-quiet button-small start-question" type="button" data-start-question="${escapeHtml(question.questionId)}" ${!enabled ? "disabled" : ""}>${hasTiming ? "Continue question" : "Start question"}</button>`}
    ${active ? '<div class="answer-meta"><span>● Response timer live</span><span>Choose one answer</span></div>' : answered ? `<div class="answer-meta"><span>Answer locked · ${escapeHtml(seconds(question.timeSpentMs))}</span><button class="text-button" type="button" data-change-question="${escapeHtml(question.questionId)}" ${!enabled ? "disabled" : ""}>Change answer</button></div>` : hasTiming ? `<div class="answer-meta"><span>Timer paused at ${escapeHtml(seconds(question.timeSpentMs))}</span><span>Continue when ready</span></div>` : ""}
  </article>`;
}

function beginQuestion(questionId) {
  if (!state.startedAtMs || state.paused || state.submitted) return;
  if (state.activeQuestionId === questionId) return;
  const at = nowMs();
  freezeActiveQuestion(at);
  state.activeQuestionId = questionId;
  state.questionStartedAtMs = at;
  state.resumeQuestionId = null;
  renderQuestions();
}

function answerQuestion(questionId, answer) {
  const question = findQuestion(questionId);
  if (!question || !state.startedAtMs || state.paused || state.activeQuestionId !== questionId || state.questionStartedAtMs === null) return;
  const now = nowMs();
  const elapsed = Math.max(1, Math.round(now - state.questionStartedAtMs));
  question.answer = answer;
  question.isCorrect = null;
  question.score = 0;
  question.timeSpentMs = (question.timeSpentMs ?? 0) + elapsed;
  state.activeQuestionId = null;
  state.questionStartedAtMs = null;
  state.resumeQuestionId = null;
  renderQuestions();
  toast(`Answer captured for ${questionId}.`);
}

function updateOverallProgress() {
  if (!state.session) return;
  const chunksDone = state.session.chunks.filter((chunk) => chunk.readingTime.durationMs !== null).length;
  const questions = allQuestions();
  const questionsDone = questions.filter((question) => question.answer !== null).length;
  const total = state.session.chunks.length + questions.length;
  const percent = total ? ((chunksDone + questionsDone) / total) * 100 : 0;
  $("#readingProgressBar").style.width = `${percent}%`;
}

function activeReadingMs() {
  if (!state.session) return 0;
  const finished = state.session.chunks.reduce((sum, chunk) => sum + (chunk.readingTime.durationMs ?? 0), 0);
  const live = state.activeVisit ? nowMs() - state.activeVisit.startedAtMs : 0;
  return finished + Math.max(0, live);
}

function renderTelemetry() {
  if (!state.session) return;
  const events = state.session.interactionEvents;
  $("#activeReadingMetric").textContent = seconds(activeReadingMs());
  $("#visitMetric").textContent = String(state.session.chunks.reduce((sum, chunk) => sum + (chunk.visits?.length ?? 0), 0) + (state.activeVisit ? 1 : 0));
  $("#lookupMetric").textContent = String(events.filter((event) => ["word_lookup", "word_tap"].includes(event.type)).length);
  $("#rereadMetric").textContent = String(events.filter((event) => event.type === "reread").length);
  const latest = [...events].reverse().slice(0, 4);
  $("#eventMiniList").innerHTML = latest.length ? latest.map((event) => `<div class="mini-event"><b>${escapeHtml(event.type.replaceAll("_", " "))}${event.word ? ` · ${escapeHtml(event.word)}` : ""}</b><time>${escapeHtml(shortTime(event.occurredAt))}</time></div>`).join("") : "<p>No interactions yet.</p>";
}

function updateSubmissionReadiness() {
  if (!state.session) return;
  const missingChunks = state.session.chunks.filter((chunk) => chunk.readingTime.durationMs === null).length;
  const missingQuestions = allQuestions().filter((question) => question.answer === null).length;
  const ready = missingChunks === 0 && missingQuestions === 0;
  $("#submissionReadiness").textContent = ready
    ? "This document is complete and ready for server-side grading."
    : `${missingChunks} unread ${missingChunks === 1 ? "chunk" : "chunks"} and ${missingQuestions} unanswered ${missingQuestions === 1 ? "question" : "questions"} remain. You can still test abandonment.`;
  $("#completeButton").disabled = state.submitted || !state.startedAtMs;
  $("#abandonButton").disabled = state.submitted || !state.startedAtMs;
}

function fillDemoRun() {
  if (!state.session || state.submitted) return;
  closeActiveVisit(nowMs(), { quiet: true });
  const end = nowMs();
  const assigned = Date.parse(state.session.assignedAt) + 1;
  const start = Math.max(assigned, end - 90_000);
  const available = Math.max(1, end - start);
  const readingWindow = Math.max(1, Math.floor(available * 0.72));
  const slot = Math.max(0, Math.floor(readingWindow / state.session.chunks.length));
  state.startedAtMs = start;
  state.session.sessionStartedAt = toIso(start);
  state.session.chunks.forEach((chunk, index) => {
    const visitStart = Math.min(end, start + index * slot);
    const visitEnd = Math.min(end, visitStart + slot);
    const visit = { visitId: crypto.randomUUID(), startedAt: toIso(visitStart), finishedAt: toIso(visitEnd), durationMs: visitEnd - visitStart };
    chunk.visits = [visit];
    chunk.readingTime = { startedAt: visit.startedAt, finishedAt: visit.finishedAt, durationMs: visit.durationMs };
  });
  allQuestions().forEach((question, index) => {
    question.answer = index % 3 === 2 ? (question.correctIndex + 1) % question.options.length : question.correctIndex;
    question.isCorrect = null;
    question.score = 0;
    question.timeSpentMs = 900 + index * 180;
  });
  const eventAt = (ratio) => Math.min(end, Math.round(start + available * ratio));
  const helperEvents = [
    { eventId: crypto.randomUUID(), type: "word_lookup", occurredAt: toIso(eventAt(.2)), chunkId: state.session.chunks[0].chunkId, word: "horned", metadata: { source: "team-lab-helper" } },
    { eventId: crypto.randomUUID(), type: "pause", occurredAt: toIso(eventAt(.45)) },
    { eventId: crypto.randomUUID(), type: "resume", occurredAt: toIso(eventAt(.5)), durationMs: Math.max(0, eventAt(.5) - eventAt(.45)) },
    { eventId: crypto.randomUUID(), type: "reread", occurredAt: toIso(eventAt(.75)), chunkId: state.session.chunks[1]?.chunkId ?? state.session.chunks[0].chunkId },
  ];
  state.session.interactionEvents = helperEvents;
  state.activeVisit = null;
  state.paused = false;
  state.pauseStartedMs = null;
  state.pausedTotalMs = helperEvents.find((event) => event.type === "resume")?.durationMs ?? 0;
  state.activeQuestionId = null;
  state.questionStartedAtMs = null;
  state.resumeQuestionId = null;
  $("#sessionLaunch").hidden = true;
  $("#readingProgress").hidden = false;
  $("#sessionClock").hidden = false;
  $("#pauseButton").hidden = false;
  $("#pauseButton").textContent = "Pause session";
  $("#captureState").className = "pulse-label is-live";
  $("#captureState").innerHTML = "<i></i> Capturing";
  renderChunks();
  renderQuestions();
  renderTelemetry();
  renderInspector();
  toast("Valid mixed-score test data filled. Review it, then submit.");
}

function validateCompleted() {
  const missingChunks = state.session.chunks.filter((chunk) => chunk.readingTime.startedAt === null || chunk.readingTime.finishedAt === null || chunk.readingTime.durationMs === null);
  const missingQuestions = allQuestions().filter((question) => question.answer === null || question.timeSpentMs === null);
  if (missingChunks.length || missingQuestions.length) {
    throw new Error(`Completed results need every item: ${missingChunks.length} chunks and ${missingQuestions.length} questions are incomplete.`);
  }
}

function prepareSubmission(status) {
  if (!state.session) throw new Error("Select a passage first.");
  if (!state.startedAtMs) beginSession();
  const finishedAtMs = nowMs();
  closeActiveVisit(finishedAtMs, { quiet: true });
  freezeActiveQuestion(finishedAtMs);
  state.resumeQuestionId = null;
  if (status === "completed") validateCompleted();
  const payload = structuredClone(state.session);
  payload.sessionStatus = status;
  payload.sessionStartedAt = toIso(state.startedAtMs);
  payload.sessionFinishedAt = toIso(finishedAtMs);
  state.preparedPayload = payload;
  renderInspector();
  return payload;
}

function emptyAnalyticsTotals() {
  return Object.fromEntries(analyticsMetrics.map(([key]) => [key, 0]));
}

function aggregateProgress(days) {
  const totals = emptyAnalyticsTotals();
  for (const day of days) {
    for (const [key] of analyticsMetrics) totals[key] += Number(day[key] ?? 0);
  }
  return totals;
}

function expectedAnalyticsDelta(payload) {
  const comprehension = payload.comprehensionQuestions.filter((question) => question.answer !== null);
  const vocabulary = payload.vocabQuestions.filter((question) => question.answer !== null);
  return {
    activeReadingMs: payload.chunks.reduce((total, chunk) => total + (chunk.readingTime.durationMs ?? 0), 0),
    comprehensionAttempts: comprehension.length,
    comprehensionCorrect: comprehension.filter((question) => question.answer === question.correctIndex).length,
    vocabularyAttempts: vocabulary.length,
    vocabularyCorrect: vocabulary.filter((question) => question.answer === question.correctIndex).length,
    wordLookups: payload.interactionEvents.filter((event) => event.type === "word_lookup" || event.type === "word_tap").length,
    abandonments: payload.sessionStatus === "abandoned" ? 1 : 0,
  };
}

function subtractAnalyticsTotals(current, baseline) {
  return Object.fromEntries(
    analyticsMetrics.map(([key]) => [key, Math.max(0, current[key] - baseline[key])]),
  );
}

function analyticsDeltaConfirmed(actual, expected) {
  const required = analyticsMetrics.filter(([key]) => expected[key] > 0);
  return required.length > 0 && required.every(([key]) => actual[key] >= expected[key]);
}

async function queryChildProgress({ record = true } = {}) {
  const { body } = await fetchJson(
    `/api/v1/analytics/children/${encodeURIComponent(state.session.childId)}/progress`,
    {},
    { record },
  );
  return body.days ?? [];
}

async function captureAnalyticsBaseline(payload) {
  state.analyticsExpected = expectedAnalyticsDelta(payload);
  state.analyticsActualDelta = emptyAnalyticsTotals();
  if (!state.health) await refreshHealth();
  if (!cloudHealthReady()) {
    state.analyticsSync = {
      status: "unavailable",
      attempts: 0,
      startedAtMs: null,
      message: state.health?.operationalStore === "memory"
        ? "Memory mode has no persistent CDC destination."
        : "The Postgres and ClickHouse health probes are not both reachable.",
    };
    return;
  }
  try {
    const days = await queryChildProgress({ record: true });
    state.analyticsDays = days;
    state.analyticsBaseline = {
      totals: aggregateProgress(days),
      capturedAtMs: Date.now(),
    };
    state.analyticsSync = {
      status: "baseline",
      attempts: 0,
      startedAtMs: null,
      message: "Pre-submit ClickHouse totals captured.",
    };
  } catch (error) {
    state.analyticsSync = {
      status: "baseline-error",
      attempts: 0,
      startedAtMs: null,
      message: `Could not capture a trustworthy baseline: ${error.message}`,
    };
  }
}

async function submitResult(status) {
  showError($("#submitError"), "");
  const button = status === "completed" ? $("#completeButton") : $("#abandonButton");
  try {
    const payload = prepareSubmission(status);
    state.resultStatus = status;
    button.disabled = true;
    button.classList.add("is-busy");
    $("#submissionReadiness").textContent = "Capturing the pre-submit ClickHouse baseline…";
    await captureAnalyticsBaseline(payload);
    const { body } = await fetchJson(`/api/v1/reading-sessions/${encodeURIComponent(payload.sessionId)}/result`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.receipt = body;
    state.submitted = true;
    state.paused = false;
    state.activeQuestionId = null;
    state.questionStartedAtMs = null;
    state.resumeQuestionId = null;
    $("#pauseButton").hidden = true;
    $("#captureState").className = "pulse-label";
    $("#captureState").innerHTML = "<i></i> Submitted";
    renderChunks();
    renderQuestions();
    updateSubmissionReadiness();
    renderReceipt(body, status);
    renderAnalyticsProgress();
    $("#resultsArea").hidden = false;
    $("#resultsArea").scrollIntoView({ behavior: "smooth", block: "start" });
    startAnalyticsPolling();
  } catch (error) {
    showError($("#submitError"), error.message);
    $("#submitError").scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    button.classList.remove("is-busy");
    if (!state.submitted) {
      button.disabled = false;
      updateSubmissionReadiness();
    }
  }
}

function receiptEnvironment() {
  const postgresReady = state.health?.operationalStore === "postgres" && state.health?.checks?.operationalStore?.status === "reachable";
  if (cloudHealthReady()) return "cloud";
  if (postgresReady) return "postgres";
  return "memory";
}

function renderReceipt(receipt, status) {
  const environment = receiptEnvironment();
  if (status === "abandoned") {
    $("#receiptTitle").textContent = environment === "cloud" ? "The partial session is stored. CDC confirmation is next." : "The abandonment signal was captured.";
    $("#receiptMessage").textContent = environment === "cloud"
      ? "Postgres preserved the incomplete session. The lab is comparing ClickHouse against its pre-submit baseline for this abandonment."
      : environment === "postgres"
        ? "Postgres preserved the incomplete session. ClickHouse is not currently available to confirm its analytics event."
        : "The in-memory demo preserved this partial session for the current process only; no cloud sync is expected.";
  } else {
    $("#receiptTitle").textContent = environment === "cloud" ? "Postgres accepted it. ClickHouse confirmation is next." : environment === "postgres" ? "The result is safely stored in Postgres." : "The demo result was accepted in memory.";
    $("#receiptMessage").textContent = environment === "cloud"
      ? "The API graded the completed document on the server. The lab is now watching for this run’s exact metric delta in ClickHouse."
      : environment === "postgres"
        ? "The API graded and stored the completed document, but analytics confirmation is unavailable until ClickHouse is connected."
        : "The API graded the completed document, but this in-memory result is not persistent and will not reach ClickHouse.";
  }

  const scoreValues = status === "abandoned"
    ? [
        ["Active reading", `Incomplete · ${seconds(receipt.summary.totalActiveReadingMs)}`, true],
        ["Comprehension", "Not graded", true],
        ["Vocabulary", "Not graded", true],
      ]
    : [
        ["Active reading", seconds(receipt.summary.totalActiveReadingMs), false],
        ["Comprehension", `${receipt.summary.comprehension.percent}%`, false],
        ["Vocabulary", `${receipt.summary.vocabulary.percent}%`, false],
      ];
  $("#scoreGrid").innerHTML = scoreValues.map(([label, value, incomplete]) => `<div class="score-card"><small>${escapeHtml(label)}</small><strong class="${incomplete ? "is-incomplete" : ""}">${escapeHtml(value)}</strong></div>`).join("");
  $("#receiptDetails").innerHTML = `
    <div><dt>Result ID</dt><dd>${escapeHtml(receipt.resultId)}</dd></div>
    <div><dt>Received</dt><dd>${escapeHtml(new Date(receipt.receivedAt).toLocaleString())}</dd></div>
    <div><dt>Storage</dt><dd>${escapeHtml(environment === "cloud" ? "Managed Postgres" : environment === "postgres" ? "Postgres only" : "Process memory only")}</dd></div>
    <div><dt>Analytics</dt><dd id="receiptAnalyticsValue">${escapeHtml(environment === "cloud" ? "baseline captured · polling" : "not available in this environment")}</dd></div>`;
  renderDiagnosticLog();
}

function updateReceiptAnalyticsStatus() {
  const target = $("#receiptAnalyticsValue");
  if (!target) return;
  const status = state.analyticsSync.status;
  target.textContent = status === "confirmed"
    ? `confirmed in ClickHouse after ${state.analyticsSync.attempts} ${state.analyticsSync.attempts === 1 ? "check" : "checks"}`
    : status === "polling"
      ? `pending · check ${state.analyticsSync.attempts}`
      : status === "timeout"
        ? "not confirmed within 90 seconds"
        : status === "unavailable"
          ? "not available in this environment"
          : status === "baseline-error"
            ? "unverified · no pre-submit baseline"
            : "pending";
}

function renderSyncStatus() {
  const target = $("#syncStatus");
  const sync = state.analyticsSync;
  let className = "is-idle";
  let icon = "···";
  let title = "Waiting for a result";
  let detail = "A pre-submit baseline will separate this run from older child totals.";
  if (sync.status === "polling") {
    className = "is-polling";
    icon = "↻";
    title = "Waiting for this result in ClickHouse";
    const elapsed = sync.startedAtMs ? Math.min(90, Math.floor((Date.now() - sync.startedAtMs) / 1_000)) : 0;
    detail = `Baseline captured before PUT · check ${sync.attempts} · ${elapsed}s of 90s${sync.message ? ` · ${sync.message}` : ""}`;
  } else if (sync.status === "confirmed") {
    className = "is-confirmed";
    icon = "✓";
    title = "This result is confirmed in ClickHouse";
    detail = `The post-submit totals contain every expected metric delta after ${sync.attempts} ${sync.attempts === 1 ? "check" : "checks"}.`;
  } else if (sync.status === "timeout") {
    className = "is-timeout";
    icon = "!";
    title = "This result was not confirmed within 90 seconds";
    detail = "The totals below are still useful context, but they must not be treated as proof that this run synced.";
  } else if (sync.status === "unavailable") {
    className = "is-idle";
    icon = "—";
    title = "Current-run analytics confirmation is unavailable";
    detail = sync.message;
  } else if (sync.status === "baseline-error") {
    className = "is-error";
    icon = "×";
    title = "No trustworthy pre-submit baseline";
    detail = sync.message;
  }
  target.className = `sync-status ${className}`;
  target.innerHTML = `<span class="sync-icon" aria-hidden="true">${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  updateReceiptAnalyticsStatus();
}

function renderAnalyticsProgress() {
  renderSyncStatus();
  const container = $("#analyticsContent");
  const days = state.analyticsDays;
  const hasBaseline = Boolean(state.analyticsBaseline && state.analyticsExpected && state.analyticsActualDelta);
  const deltaHtml = hasBaseline ? `<div class="delta-summary">
    <strong>Current-run delta from the pre-submit baseline</strong>
    <div class="delta-grid">${analyticsMetrics.map(([key, label, format]) => {
      const actual = state.analyticsActualDelta[key];
      const expected = state.analyticsExpected[key];
      const met = actual >= expected;
      return `<div class="delta-chip ${met ? "is-met" : "is-waiting"}"><small>${escapeHtml(label)}</small><b>+${escapeHtml(format(actual))} / +${escapeHtml(format(expected))}</b></div>`;
    }).join("")}</div>
  </div>` : "";
  if (!days.length) {
    container.innerHTML = `${deltaHtml}<div class="analytics-empty"><div><strong>No child totals returned yet</strong><p>${hasBaseline ? "The baseline was empty. Confirmation requires the expected current-run delta to appear during polling." : "No ClickHouse rows are available for this child, and this run cannot be attributed without a baseline."}</p></div></div>`;
    return;
  }
  const latest = days.at(-1);
  container.innerHTML = `${deltaHtml}
    <div class="analytics-total-label"><span>All-time child totals</span><span>${state.analyticsSync.status === "confirmed" ? "current run confirmed" : "not current-run proof"}</span></div>
    <div class="event-table-wrap"><table class="progress-table"><thead><tr><th>Date</th><th>Reading</th><th>Comp.</th><th>Vocab.</th><th>Lookups</th><th>Abandoned</th></tr></thead><tbody>${days.map((day) => `<tr>
      <td>${escapeHtml(day.activityDate)}</td>
      <td>${escapeHtml(seconds(day.activeReadingMs))}</td>
      <td>${day.comprehensionCorrect}/${day.comprehensionAttempts}</td>
      <td>${day.vocabularyCorrect}/${day.vocabularyAttempts}</td>
      <td>${day.wordLookups}</td>
      <td>${day.abandonments}</td>
    </tr>`).join("")}</tbody></table></div>
    <p class="freshness-note">Latest synced ${escapeHtml(new Date(latest.latestSyncedAt).toLocaleString())} · last event age ${escapeHtml(seconds(latest.lastSyncedEventAgeSeconds * 1000))} · max observed CDC transfer ${escapeHtml(seconds(latest.maxObservedCdcTransferLagMs))}</p>`;
}

async function checkAnalyticsOnce({ record = false } = {}) {
  const days = await queryChildProgress({ record });
  state.analyticsDays = days;
  if (state.analyticsBaseline && state.analyticsExpected) {
    state.analyticsActualDelta = subtractAnalyticsTotals(
      aggregateProgress(days),
      state.analyticsBaseline.totals,
    );
    if (analyticsDeltaConfirmed(state.analyticsActualDelta, state.analyticsExpected)) {
      state.analyticsSync.status = "confirmed";
      state.analyticsSync.message = "";
    }
  }
  renderAnalyticsProgress();
  return state.analyticsSync.status === "confirmed";
}

function startAnalyticsPolling() {
  if (!state.analyticsBaseline) {
    renderAnalyticsProgress();
    return;
  }
  stopAnalyticsPolling();
  const generation = state.analyticsPollGeneration;
  state.analyticsSync = { status: "polling", attempts: 0, startedAtMs: Date.now(), message: "" };
  renderAnalyticsProgress();
  const poll = async () => {
    if (generation !== state.analyticsPollGeneration || !state.submitted) return;
    state.analyticsSync.attempts += 1;
    try {
      const confirmed = await checkAnalyticsOnce({ record: false });
      if (confirmed) {
        state.analyticsPollTimer = null;
        return;
      }
      state.analyticsSync.message = "";
    } catch (error) {
      state.analyticsSync.message = `Last check failed: ${error.message}`;
      renderAnalyticsProgress();
    }
    const elapsed = Date.now() - state.analyticsSync.startedAtMs;
    if (elapsed >= analyticsPollTimeoutMs) {
      state.analyticsSync.status = "timeout";
      state.analyticsPollTimer = null;
      renderAnalyticsProgress();
      return;
    }
    state.analyticsPollTimer = setTimeout(poll, analyticsPollIntervalMs);
  };
  state.analyticsPollTimer = setTimeout(poll, 750);
}

async function refreshProgress() {
  if (!state.session) return;
  const button = $("#refreshProgressButton");
  button.disabled = true;
  try {
    await checkAnalyticsOnce({ record: true });
  } catch (error) {
    const expected = error.status === 503;
    if (!state.analyticsBaseline) {
      state.analyticsSync.status = expected ? "unavailable" : "baseline-error";
      state.analyticsSync.message = error.message;
    } else {
      state.analyticsSync.message = `Manual refresh failed: ${error.message}`;
    }
    renderAnalyticsProgress();
  } finally {
    button.disabled = false;
  }
}

function diagnosticPayload(kind) {
  const payload = structuredClone(state.preparedPayload);
  if (kind !== "mutated") return payload;
  const question = [...payload.comprehensionQuestions, ...payload.vocabQuestions][0];
  if (question) {
    question.answer = question.answer === null ? 0 : (question.answer + 1) % question.options.length;
    if (payload.sessionStatus === "completed" && question.timeSpentMs === null) question.timeSpentMs = 1;
  } else {
    payload.sessionFinishedAt = toIso(Date.parse(payload.sessionFinishedAt) + 1);
  }
  return payload;
}

async function runResultDiagnostic(kind) {
  if (!state.preparedPayload || !state.submitted) return;
  const expectedStatus = kind === "exact" ? 200 : kind === "mutated" ? 409 : 400;
  const label = kind === "exact" ? "Exact retry" : kind === "mutated" ? "Changed retry" : "Wrong session path";
  const buttons = $$("[data-diagnostic]");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const payload = diagnosticPayload(kind);
    const pathSessionId = kind === "wrong-path" ? crypto.randomUUID() : payload.sessionId;
    const { response } = await fetchJson(`/api/v1/reading-sessions/${encodeURIComponent(pathSessionId)}/result`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, { allowError: true });
    const passed = response.status === expectedStatus;
    state.diagnostics.push({ label, expectedStatus, actualStatus: response.status, passed });
  } catch (error) {
    state.diagnostics.push({ label, expectedStatus, actualStatus: "network error", passed: false });
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    renderDiagnosticLog();
  }
}

function renderDiagnosticLog() {
  const target = $("#diagnosticLog");
  if (!target) return;
  if (!state.diagnostics.length) {
    target.className = "diagnostic-log";
    target.textContent = "No diagnostics run yet.";
    return;
  }
  const allPassed = state.diagnostics.every((result) => result.passed);
  target.className = `diagnostic-log ${allPassed ? "is-ok" : "is-error"}`;
  target.textContent = state.diagnostics.map((result) => `${result.passed ? "PASS" : "FAIL"} · ${result.label}: expected ${result.expectedStatus}, got ${result.actualStatus}`).join("\n");
}

function tick() {
  if (!state.startedAtMs || state.submitted) return;
  const now = nowMs();
  const currentPause = state.paused && state.pauseStartedMs ? now - state.pauseStartedMs : 0;
  $("#sessionClock").textContent = clock(now - state.startedAtMs - state.pausedTotalMs - currentPause);
  $("#activeReadingMetric").textContent = seconds(activeReadingMs());
  if (state.activeVisit) {
    const card = $(`[data-chunk="${state.activeVisit.chunkId}"]`);
    const chunk = state.session.chunks.find((item) => item.chunkId === state.activeVisit.chunkId);
    if (card && chunk) {
      const stat = $(".chunk-stats", card);
      const visits = (chunk.visits?.length ?? 0) + 1;
      stat.textContent = `${visits} ${visits === 1 ? "visit" : "visits"} · ${seconds((chunk.readingTime.durationMs ?? 0) + now - state.activeVisit.startedAtMs)}`;
    }
  }
  if (state.activeQuestionId && state.questionStartedAtMs !== null) {
    const question = findQuestion(state.activeQuestionId);
    const element = $(`[data-question-clock="${CSS.escape(state.activeQuestionId)}"]`);
    if (question && element) element.textContent = clock((question.timeSpentMs ?? 0) + now - state.questionStartedAtMs);
  }
}

function activateTab(name) {
  $$(".inspector-tabs [role='tab']").forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $("#apiPanel").hidden = name !== "api";
  $("#eventsPanel").hidden = name !== "events";
  $("#payloadPanel").hidden = name !== "payload";
}

function resetForNewSession() {
  resetSessionState();
  $("#readingWorkspace").hidden = true;
  $("#emptyWorkspace").hidden = false;
  $("#sessionClock").hidden = true;
  $("#pauseButton").hidden = true;
  $("#idempotencyKey").value = newKey();
  renderSelectionRequestPreview();
  $("#selectionForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindEvents() {
  $("#selectionForm").addEventListener("submit", selectPassage);
  $("#selectionForm").addEventListener("input", renderSelectionRequestPreview);
  $("#selectionForm").addEventListener("change", renderSelectionRequestPreview);
  $("#refreshHealthButton").addEventListener("click", () => void refreshHealth());
  $("#refreshKeyButton").addEventListener("click", () => {
    $("#idempotencyKey").value = newKey();
    renderSelectionRequestPreview();
    toast("New idempotency key generated.");
  });
  $("#resetDefaultsButton").addEventListener("click", () => {
    $("input[name='persona'][value='maya']").checked = true;
    applyPersona("maya");
    $("#excludeIds").value = "";
    $("#idempotencyKey").value = newKey();
    renderSelectionRequestPreview();
  });
  $$("input[name='persona']").forEach((input) => input.addEventListener("change", () => applyPersona(input.value)));
  for (const id of ["childId", "lexileMin", "lexileTarget", "lexileMax", "topics"]) {
    $(`#${id}`).addEventListener("input", () => { $("input[name='persona'][value='custom']").checked = true; });
  }
  $("#startSessionButton").addEventListener("click", beginSession);
  $("#pauseButton").addEventListener("click", togglePause);
  $("#fillDemoButton").addEventListener("click", fillDemoRun);
  $("#completeButton").addEventListener("click", () => void submitResult("completed"));
  $("#abandonButton").addEventListener("click", () => void submitResult("abandoned"));
  $("#refreshProgressButton").addEventListener("click", () => void refreshProgress());
  $("#newSessionButton").addEventListener("click", resetForNewSession);
  $$("[data-diagnostic]").forEach((button) => button.addEventListener("click", () => void runResultDiagnostic(button.dataset.diagnostic)));
  $("#copySessionButton").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(event.currentTarget.dataset.copyValue ?? "");
    toast("Session ID copied.");
  });

  $("#chunkList").addEventListener("click", (event) => {
    const wordButton = event.target.closest("[data-word]");
    if (wordButton) return lookupWord(wordButton.dataset.word, Number(wordButton.dataset.chunkId));
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const chunkId = Number(actionButton.dataset.chunkId);
    if (actionButton.dataset.action === "start-chunk") startChunk(chunkId, { reread: Boolean(state.session.chunks.find((item) => item.chunkId === chunkId)?.readingTime.finishedAt) });
    if (actionButton.dataset.action === "stop-chunk") closeActiveVisit();
    if (actionButton.dataset.action === "reread") startChunk(chunkId, { reread: true });
  });

  for (const containerId of ["comprehensionQuestions", "vocabQuestions"]) {
    $(`#${containerId}`).addEventListener("click", (event) => {
      const start = event.target.closest("[data-start-question]");
      const change = event.target.closest("[data-change-question]");
      if (start) beginQuestion(start.dataset.startQuestion);
      if (change) beginQuestion(change.dataset.changeQuestion);
    });
    $(`#${containerId}`).addEventListener("change", (event) => {
      if (event.target.matches("input[type='radio']")) {
        const card = event.target.closest("[data-question-id]");
        answerQuestion(card.dataset.questionId, Number(event.target.value));
      }
    });
  }

  $$(".inspector-tabs [role='tab']").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
  $("#exchangeSelect").addEventListener("change", (event) => { state.activeExchange = Number(event.target.value); renderInspector(); });
  $$("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    const target = button.dataset.copy === "request" ? "#requestCode" : button.dataset.copy === "response" ? "#responseCode" : "#payloadCode";
    await navigator.clipboard.writeText($(target).textContent);
    toast("Copied to clipboard.");
  }));

  window.addEventListener("beforeunload", (event) => {
    if (state.startedAtMs && !state.submitted) event.preventDefault();
  });
}

async function initialize() {
  const accessToken = takeFragmentAccessToken();
  $("#idempotencyKey").value = newKey();
  bindEvents();
  renderSelectionRequestPreview();
  renderInspector();
  setInterval(tick, 250);
  setInterval(() => void refreshHealth(), 30_000);
  if (accessToken !== null && !(await exchangeAccessToken(accessToken))) return;
  await refreshHealth();
}

void initialize();
