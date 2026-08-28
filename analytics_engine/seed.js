// Seeds ~800 sessions: 8 students x 3-5 passages per school day over 5 weeks
// (25 weekdays), POSTed through the analytics_engine endpoint.
//
// Each student follows their OWN progression curve:
//   ability(day)  -> which lexile band they read + how accurately
//   wpm(day)      -> reading fluency
// so the dashboard shows genuine, individual growth trajectories.
// Deterministic RNG: reseeding reproduces the same story.

const API = process.env.ANALYTICS_ENGINE_URL || 'http://localhost:3001';
const CLASS_ID = 'class-4b';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260828);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- 25 school days (weekdays only), Mon 2026-07-27 -> Fri 2026-08-28
const SCHOOL_DAYS = [];
for (let d = new Date(Date.UTC(2026, 6, 27)); d <= new Date(Date.UTC(2026, 7, 28)); d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay();
  if (dow >= 1 && dow <= 5) SCHOOL_DAYS.push(new Date(d));
}

// ---- personas: ability/wpm are functions of the school-day index (0..24)
// abilityGrowth is lexile points gained per school day — each kid's own slope.
const STUDENTS = [
  { id: 101, name: 'Amara Diallo', grade: 4, ability0: 600, abilityGrowth: 3.5, wpm0: 138, wpmGrowth: 0.7,  accBase: 0.90, qTime: 13000, persona: 'strong, steady climber' },
  { id: 102, name: 'Ben Ortiz',    grade: 4, ability0: 470, abilityGrowth: 4.0, wpm0: 105, wpmGrowth: 0.8,  accBase: 0.78, qTime: 17000, persona: 'average, healthy growth' },
  { id: 103, name: 'Chloe Kim',    grade: 4, ability0: 360, abilityGrowth: 2.0, wpm0: 65,  wpmGrowth: 0.5,  accBase: 0.55, qTime: 30000, persona: 'struggling, slow but real progress' },
  { id: 104, name: 'Diego Santos', grade: 4, ability0: 480, abilityGrowth: 3.0, wpm0: 150, wpmGrowth: 0.0,  accBase: 0.75, qTime: 4500,  persona: 'guesser early, turns around mid-term',
    attention: (day) => clamp(0.5 + 0.02 * day, 0.5, 0.97),          // starts guessing, learns to focus
    qTimeAt:   (day) => 4500 + 400 * day },                          // starts answering in 4s, ends ~14s
  { id: 105, name: 'Eve Nakamura', grade: 4, ability0: 520, abilityGrowth: 3.0, wpm0: 60,  wpmGrowth: 1.3,  accBase: 0.90, qTime: 34000, persona: 'accurate, fluency blooming' },
  { id: 106, name: 'Farah Hassan', grade: 4, ability0: 400, abilityGrowth: 7.0, wpm0: 82,  wpmGrowth: 1.6,  accBase: 0.68, qTime: 21000, persona: 'star improver' },
  { id: 107, name: 'Gus Miller',   grade: 4, ability0: 560, abilityGrowth: -5.0, wpm0: 122, wpmGrowth: -0.6, accBase: 0.84, qTime: 15000, persona: 'declining — the one to flag' },
  { id: 108, name: 'Hana Petrova', grade: 4, ability0: 500, abilityGrowth: 4.0, wpm0: 100, wpmGrowth: 0.8,  accBase: 0.82, qTime: 19000, persona: 'vocab gap, slowly narrowing',
    vocabDelta: (day) => -0.45 + 0.012 * day },                      // vocab lags comp, gap closes a little
];

const ability = (s, day) => s.ability0 + s.abilityGrowth * day;
const wpmAt = (s, day) => Math.max(35, s.wpm0 + s.wpmGrowth * day);

// ---- 24 fake passages spanning 350L..810L, in the passage_2513.json shape
const SUBJECTS = ['the clever fox', 'a small turtle', 'the old baobab tree', 'two curious sisters', 'the fisherman', 'a young shepherd', 'the market woman', 'the little sparrow'];
const ACTIONS = ['walked slowly across the wide valley', 'found something shiny near the river', 'decided to help a stranger on the road', 'waited patiently for the rain to stop', 'shared the last piece of bread', 'learned an important lesson that day', 'told a story that nobody believed at first', 'worked from morning until the stars came out'];
const CLOSERS = ['Everyone in the village remembered it for years.', 'And that is how the trouble began.', 'Nothing was ever quite the same again.', 'It was a day worth remembering.', 'The answer would come sooner than expected.'];

function makeChunkText() {
  const s1 = `One morning, ${pick(SUBJECTS)} ${pick(ACTIONS)}.`;
  const s2 = `Later, ${pick(SUBJECTS)} ${pick(ACTIONS)}, even though the wind was cold and the path was long.`;
  return `${s1} ${s2} ${pick(CLOSERS)}`;
}

const VOCAB_BANK = [
  ['patient', 'Waiting calmly without complaining'], ['gather', 'To bring things together'],
  ['ancient', 'Very, very old'], ['whisper', 'To speak very quietly'],
  ['brave', 'Not afraid of danger'], ['harvest', 'To pick crops when they are ready'],
  ['journey', 'A long trip'], ['clever', 'Quick at understanding things'],
  ['shelter', 'A place that protects from weather'], ['promise', 'To say you will surely do something'],
  ['curious', 'Wanting to know more about things'], ['generous', 'Happy to give and share'],
  ['distant', 'Far away'], ['gentle', 'Soft and kind'], ['drought', 'A long time with no rain'],
  ['harbor', 'A safe place for boats'], ['stubborn', 'Refusing to change your mind'],
  ['flourish', 'To grow strong and healthy'], ['timid', 'Easily frightened'], ['vast', 'Extremely large'],
];

const TITLE_A = ['The River', 'A Basket', 'The Market', 'Turtle', 'The Baobab', 'The Rains', 'The Shepherd', 'Two Sisters', 'The Sparrow', 'The Drums', 'The Moonlit', 'A Long'];
const TITLE_B = ['That Sang', 'of Stars', 'at Dawn', 'and the Moon', 'Secret', 'Came Late', 'Whistle', 'One Canoe', 'Message', 'at Night', 'Road Home', 'Way North'];

const PASSAGES = Array.from({ length: 24 }, (_, i) => {
  const title = `${TITLE_A[i % 12]} ${TITLE_B[(i * 7 + Math.floor(i / 12)) % 12]}`;
  const chunks = Array.from({ length: 5 }, (_, c) => ({ chunkId: c + 1, text: makeChunkText() }));
  const words = [pick(VOCAB_BANK), pick(VOCAB_BANK), pick(VOCAB_BANK)];
  const band = 350 + i * 20; // 350 -> 810
  return {
    passage: {
      id: 3001 + i,
      title,
      author: 'Seed Story Collective',
      source: 'African Storybook Level 4',
      license: 'CC BY 4.0',
      category: 'Lit',
      lexileBand: band,
      fleschKincaidGrade: +(1.5 + i * 0.18).toFixed(2),
      wordCount: chunks.reduce((s, c) => s + c.text.split(/\s+/).length, 0),
      coverImageUrl: `https://placeholder.example.com/passages/${3001 + i}/cover.png`,
    },
    chunks,
    comprehensionQuestions: [1, 2, 3].map((n) => ({
      questionId: `c${n}`,
      axis: 'comprehension',
      prompt: `What happened in part ${n} of "${title}"?`,
      options: ['They went to the river', 'They waited for the rain', 'They shared what they had', 'They walked home in the dark'],
      correctIndex: Math.floor(rand() * 4),
    })),
    vocabQuestions: words.map(([word, right], n) => ({
      questionId: `v${n + 1}`,
      axis: 'vocabulary',
      word,
      imageUrl: `https://placeholder.example.com/vocab/${word}.png`,
      prompt: `What does "${word}" mean?`,
      options: [right, 'A kind of food', 'A loud noise', 'A place to sleep'],
      correctIndex: 0,
    })),
  };
});

// adaptive passage choice: read near your current level (a little stretch)
function pickPassage(studentAbility) {
  const target = studentAbility + (rand() * 70 - 30);
  let best = PASSAGES[0], bestDist = Infinity;
  for (const p of PASSAGES) {
    const dist = Math.abs(p.passage.lexileBand - target);
    if (dist < bestDist) { best = p; bestDist = dist; }
  }
  return best;
}

function accuracyFor(student, day, band, axis) {
  let acc = student.accBase + (ability(student, day) - band) / 250;
  if (axis === 'vocabulary' && student.vocabDelta) acc += student.vocabDelta(day);
  if (student.attention) acc *= student.attention(day);
  return clamp(acc + (rand() * 0.12 - 0.06), 0.08, 0.97);
}

function answerQuestion(q, acc, baseTimeMs) {
  const correct = rand() < acc;
  const answer = correct ? q.correctIndex : pick([0, 1, 2, 3].filter((i) => i !== q.correctIndex));
  const timeSpentMs = Math.max(1500, Math.round(baseTimeMs * (0.6 + rand() * 0.8)));
  return { ...q, answer, score: correct ? 1 : 0, timeSpentMs };
}

function buildSession(student, template, dayDate, day, slot) {
  const wpm = wpmAt(student, day) * (0.92 + rand() * 0.16);
  const band = template.passage.lexileBand;
  const qTimeBase = student.qTimeAt ? student.qTimeAt(day) : student.qTime;

  // sessions spread through the school day: slot 0 ~13:00, slot 4 ~17:30
  const start = new Date(dayDate);
  start.setUTCHours(13 + slot, Math.floor(rand() * 55), Math.floor(rand() * 60), 0);
  let cursor = start.getTime();

  const chunks = template.chunks.map((c) => {
    const nWords = c.text.split(/\s+/).length;
    const durationMs = Math.round((nWords / wpm) * 60000 * (0.85 + rand() * 0.3));
    const startedAt = new Date(cursor).toISOString();
    cursor += durationMs;
    const finishedAt = new Date(cursor).toISOString();
    cursor += 500 + Math.round(rand() * 2000);
    return { ...c, readingTime: { startedAt, finishedAt, durationMs } };
  });

  const compAcc = accuracyFor(student, day, band, 'comprehension');
  const vocabAcc = accuracyFor(student, day, band, 'vocabulary');

  const comprehensionQuestions = template.comprehensionQuestions.map((q) => {
    const a = answerQuestion(q, compAcc, qTimeBase);
    cursor += a.timeSpentMs;
    return a;
  });
  const vocabQuestions = template.vocabQuestions.map((q) => {
    const a = answerQuestion(q, vocabAcc, qTimeBase);
    cursor += a.timeSpentMs;
    return a;
  });

  return {
    session: {
      studentId: student.id,
      studentName: student.name,
      classId: CLASS_ID,
      grade: student.grade,
      startedAt: start.toISOString(),
      finishedAt: new Date(cursor).toISOString(),
      completed: true,
    },
    passage: template.passage,
    chunks,
    comprehensionQuestions,
    vocabQuestions,
  };
}

async function post(payload) {
  const res = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function seedStudent(student) {
  let count = 0;
  for (let day = 0; day < SCHOOL_DAYS.length; day++) {
    const nSessions = 3 + Math.floor(rand() * 3); // 3-5 passages a day
    for (let slot = 0; slot < nSessions; slot++) {
      const template = pickPassage(ability(student, day));
      await post(buildSession(student, template, SCHOOL_DAYS[day], day, slot));
      count++;
    }
  }
  const a0 = ability(student, 0), a1 = ability(student, SCHOOL_DAYS.length - 1);
  console.log(`  ${student.name} (${student.persona}) — ${count} sessions, ${Math.round(a0)}L -> ${Math.round(a1)}L`);
  return count;
}

async function main() {
  console.log(`Seeding ${STUDENTS.length} students x 3-5 sessions/day x ${SCHOOL_DAYS.length} school days -> ${API}/api/sessions`);
  const counts = await Promise.all(STUDENTS.map(seedStudent)); // students seed concurrently
  console.log(`Seed complete: ${counts.reduce((a, b) => a + b, 0)} sessions inserted.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
