// Seeds 8 fake students x 10 reading sessions each (80 sessions, 10 shared
// passages) by POSTing to the analytics_engine endpoint — proving the whole
// ingest pipeline end to end. Run the server first, then: npm run seed

const API = process.env.ANALYTICS_ENGINE_URL || 'http://localhost:3001';
const CLASS_ID = 'class-4b';

// deterministic RNG so reseeding produces the same story
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

// ---- personas: each student reads/answers differently so the charts tell a story
const STUDENTS = [
  { id: 101, name: 'Amara Diallo',  grade: 4, wpm: 145, comp: 0.92, vocab: 0.90, qTime: 14000, trend: 0,      persona: 'strong reader' },
  { id: 102, name: 'Ben Ortiz',     grade: 4, wpm: 110, comp: 0.75, vocab: 0.72, qTime: 18000, trend: 0,      persona: 'average' },
  { id: 103, name: 'Chloe Kim',     grade: 4, wpm: 70,  comp: 0.45, vocab: 0.40, qTime: 32000, trend: 0,      persona: 'struggling' },
  { id: 104, name: 'Diego Santos',  grade: 4, wpm: 150, comp: 0.40, vocab: 0.38, qTime: 4000,  trend: 0,      persona: 'guesser (fast + wrong)' },
  { id: 105, name: 'Eve Nakamura',  grade: 4, wpm: 62,  comp: 0.88, vocab: 0.85, qTime: 38000, trend: 0,      persona: 'slow but accurate' },
  { id: 106, name: 'Farah Hassan',  grade: 4, wpm: 85,  comp: 0.55, vocab: 0.50, qTime: 22000, trend: 0.045,  persona: 'improving fast' },
  { id: 107, name: 'Gus Miller',    grade: 4, wpm: 120, comp: 0.82, vocab: 0.78, qTime: 16000, trend: -0.035, persona: 'declining (flag me)' },
  { id: 108, name: 'Hana Petrova',  grade: 4, wpm: 105, comp: 0.80, vocab: 0.35, qTime: 20000, trend: 0,      persona: 'vocab gap' },
];

// ---- 10 fake passages in the passage_2513.json shape
const SUBJECTS = ['the clever fox', 'a small turtle', 'the old baobab tree', 'two curious sisters', 'the fisherman', 'a young shepherd', 'the market woman', 'the little sparrow'];
const ACTIONS = ['walked slowly across the wide valley', 'found something shiny near the river', 'decided to help a stranger on the road', 'waited patiently for the rain to stop', 'shared the last piece of bread', 'learned an important lesson that day', 'told a story that nobody believed at first', 'worked from morning until the stars came out'];
const CLOSERS = ['Everyone in the village remembered it for years.', 'And that is how the trouble began.', 'Nothing was ever quite the same again.', 'It was a day worth remembering.', 'The answer would come sooner than expected.'];

function makeChunkText() {
  const s1 = `One morning, ${pick(SUBJECTS)} ${pick(ACTIONS)}.`;
  const s2 = `Later, ${pick(SUBJECTS)} ${pick(ACTIONS)}, even though the wind was cold and the path was long.`;
  const s3 = pick(CLOSERS);
  return `${s1} ${s2} ${s3}`;
}

const VOCAB_BANK = [
  ['patient', 'Waiting calmly without complaining'], ['gather', 'To bring things together'],
  ['ancient', 'Very, very old'], ['whisper', 'To speak very quietly'],
  ['brave', 'Not afraid of danger'], ['harvest', 'To pick crops when they are ready'],
  ['journey', 'A long trip'], ['clever', 'Quick at understanding things'],
  ['shelter', 'A place that protects from weather'], ['promise', 'To say you will surely do something'],
  ['curious', 'Wanting to know more about things'], ['generous', 'Happy to give and share'],
  ['distant', 'Far away'], ['gentle', 'Soft and kind'], ['drought', 'A long time with no rain'],
];

const PASSAGE_TITLES = [
  'The River That Sang', 'A Basket of Stars', 'The Longest Market Day', 'Turtle and the Moon',
  'The Baobab\'s Secret', 'When the Rains Came Late', 'The Shepherd\'s Whistle', 'Two Sisters, One Canoe',
  'The Sparrow\'s Message', 'The Night the Drums Stopped',
];

const PASSAGES = PASSAGE_TITLES.map((title, i) => {
  const chunks = Array.from({ length: 5 }, (_, c) => ({ chunkId: c + 1, text: makeChunkText() }));
  const words = [pick(VOCAB_BANK), pick(VOCAB_BANK), pick(VOCAB_BANK)];
  return {
    passage: {
      id: 3001 + i,
      title,
      author: 'Seed Story Collective',
      source: 'African Storybook Level 4',
      license: 'CC BY 4.0',
      category: 'Lit',
      lexileBand: 420 + i * 30,               // 420 → 690, increasing difficulty
      fleschKincaidGrade: +(1.8 + i * 0.35).toFixed(2),
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
      options: [right, 'A kind of food', 'A loud noise', 'A place to sleep'].map((o, idx) => ({ o, idx }))
        .map(({ o }) => o), // options fixed order; correctIndex stays 0-based below
      correctIndex: 0,
    })),
  };
});

// difficulty penalty: reading above your level hurts accuracy a bit
function difficultyPenalty(studentWpm, lexileBand) {
  const readerLevel = 380 + studentWpm * 1.6; // rough mapping
  return Math.max(0, (lexileBand - readerLevel) / 1000);
}

function answerQuestion(q, accuracy, baseTimeMs) {
  const correct = rand() < accuracy;
  let answer;
  if (correct) answer = q.correctIndex;
  else {
    const wrong = [0, 1, 2, 3].filter((i) => i !== q.correctIndex);
    answer = pick(wrong);
  }
  const timeSpentMs = Math.max(1500, Math.round(baseTimeMs * (0.6 + rand() * 0.8)));
  return { ...q, answer, score: correct ? 1 : 0, timeSpentMs };
}

function buildSession(student, template, dayOffset, sessionIdx) {
  const progress = student.trend * sessionIdx; // improving/declining over the 10 sessions
  const wpm = Math.max(35, student.wpm * (1 + progress) * (0.9 + rand() * 0.2));
  const penalty = difficultyPenalty(student.wpm, template.passage.lexileBand);
  const compAcc = Math.min(0.98, Math.max(0.1, student.comp + progress * 2 - penalty));
  const vocabAcc = Math.min(0.98, Math.max(0.1, student.vocab + progress * 2 - penalty));

  // spread sessions over ~3 weeks, school hours
  const start = new Date(Date.UTC(2026, 7, 7 + dayOffset, 13 + Math.floor(rand() * 4), Math.floor(rand() * 60), 0));
  let cursor = start.getTime();

  const chunks = template.chunks.map((c) => {
    const nWords = c.text.split(/\s+/).length;
    const durationMs = Math.round((nWords / wpm) * 60000 * (0.85 + rand() * 0.3));
    const startedAt = new Date(cursor).toISOString();
    cursor += durationMs;
    const finishedAt = new Date(cursor).toISOString();
    cursor += 500 + Math.round(rand() * 2000); // pause between chunks
    return { ...c, readingTime: { startedAt, finishedAt, durationMs } };
  });

  const comprehensionQuestions = template.comprehensionQuestions.map((q) => {
    const a = answerQuestion(q, compAcc, student.qTime);
    cursor += a.timeSpentMs;
    return a;
  });
  const vocabQuestions = template.vocabQuestions.map((q) => {
    const a = answerQuestion(q, vocabAcc, student.qTime);
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

async function main() {
  console.log(`Seeding ${STUDENTS.length} students x ${PASSAGES.length} sessions -> ${API}/api/sessions`);
  let ok = 0, fail = 0;
  for (const student of STUDENTS) {
    for (let i = 0; i < PASSAGES.length; i++) {
      const dayOffset = i * 2 + Math.floor(rand() * 2); // roughly every other day
      const payload = buildSession(student, PASSAGES[i], dayOffset, i);
      const res = await fetch(`${API}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) ok++;
      else {
        fail++;
        console.error(`  FAILED ${student.name} / ${payload.passage.title}:`, res.status, await res.text());
      }
    }
    console.log(`  ${student.name} (${student.persona}) — done`);
  }
  console.log(`Seed complete: ${ok} sessions inserted, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
