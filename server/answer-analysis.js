// answer-analysis.js — VoiceTwin Day 3: THE DIFFERENTIATOR.
// Analyzes a candidate's answer deterministically (no LLM, no credits) and
// picks the exact challenging follow-up — the "What made you choose React?"
// moment. Pressure levels stay, but now they're driven by evidence signals,
// not just word counts.
//
// Signals (all cheap, all inspectable — we can defend every follow-up):
//   hedging       "I guess", "kind of", "maybe", "stuff like that"
//   vagueness     pronoun-heavy, no named tech/metrics
//   passive voice "was built", "was done" (contribution ambiguity)
//   no metric     zero digits/percentages/timeframes
//   no first-person singular contribution ("I" vs "we")

const HEDGES = [
  'i guess', 'i think', 'kind of', 'sort of', 'maybe', 'probably',
  'some kind of', 'something like', 'stuff like that', 'or whatever',
  'and so on', 'etc', 'i believe', 'basically just', 'just basically',
];

const TECH_HINTS = [
  'react', 'node', 'python', 'java', 'go ', 'rust', 'sql', 'nosql', 'mongo', 'postgres', 'mysql',
  'redis', 'kafka', 'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'api', 'rest', 'graphql',
  'websocket', 'cache', 'caching', 'queue', 'microservice', 'monolith', 'test', 'ci', 'cd',
  'profiling', 'profiler', 'benchmark', 'latency', 'throughput', 'p95', 'p99', 'index', 'shard',
  'load balancer', 'cdn', 'oauth', 'jwt', 'async', 'thread', 'memory', 'garbage collection',
];

const METRIC_RE = /\b\d+(\.\d+)?\s*(%|percent|ms|s\b|sec|seconds|minutes|hours|users|requests|rps|qps|x\b|gb|mb|kb)/i;
const TIMEFRAME_RE = /\b(monday|tuesday|wednesday|thursday|friday|last week|last month|last year|this year|Q[1-4]\b|\d{4})\b/i;
const FIRST_PERSON_RE = /\b(i|my|me|mine|i'd|i've|i'm)\b/i;
const TEAM_RE = /\b(we|our|us)\b/i;
const PASSIVE_RE = /\b(was|were|been|being)\s+\w+ed\b/i;

export function analyzeAnswer(rawText) {
  const text = String(rawText || '').toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // --- signals ---
  const hedgeHits = HEDGES.filter((h) => text.includes(h));
  const techHits = TECH_HINTS.filter((t) => text.includes(t));
  const hasMetric = METRIC_RE.test(text) || /\b\d+\b/.test(text);
  const hasTimeframe = TIMEFRAME_RE.test(text);
  const firstPerson = FIRST_PERSON_RE.test(text);
  const teamHeavy = TEAM_RE.test(text) && !firstPerson;
  const passiveHits = text.match(new RegExp(PASSIVE_RE.source, 'gi')) || [];

  // --- specificity score 0-10 ---
  let specificity = 0;
  if (wordCount >= 25) specificity += 2;
  else if (wordCount >= 12) specificity += 1;
  if (techHits.length >= 3) specificity += 3;
  else if (techHits.length >= 1) specificity += 1;
  if (hasMetric) specificity += 2;
  if (firstPerson) specificity += 2;
  if (hasTimeframe) specificity += 1;
  if (hedgeHits.length === 0 && wordCount > 5) specificity += 1;
  if (passiveHits.length >= 2) specificity -= 1;
  specificity = Math.max(0, Math.min(10, specificity));

  // --- weaknesses (categorized, drives follow-up choice) ---
  const weaknesses = [];
  if (hedgeHits.length >= 1) weaknesses.push('hedging');
  if (!firstPerson) weaknesses.push('no_personal_contribution');
  if (!hasMetric) weaknesses.push('no_measurable_result');
  if (techHits.length === 0) weaknesses.push('no_technical_depth');
  if (passiveHits.length >= 2) weaknesses.push('passive_voice');
  if (wordCount < 10) weaknesses.push('too_short');

  // --- decision ---
  const STRONG = 7;
  const followUpNeeded = specificity < STRONG && wordCount >= 1;
  const category = pickCategory(weaknesses);

  return {
    specificity,
    strong: specificity >= STRONG,
    wordCount,
    signals: {
      hedgeHits, techHits: techHits.slice(0, 6), hasMetric, hasTimeframe,
      firstPerson, teamHeavy, passiveCount: passiveHits.length,
    },
    weaknesses,
    category,
    followUpNeeded,
  };
}

// Priority order: the most damaging weakness gets the follow-up.
function pickCategory(weaknesses) {
  const ORDER = [
    'no_personal_contribution',  // "we did it" — dig for THEIR part
    'no_measurable_result',      // no numbers — dig for impact
    'no_technical_depth',        // no tech named — dig for the how
    'hedging',                   // unsure — dig for confidence
    'passive_voice',             // ambiguous agency
    'too_short',                 // barely an answer
  ];
  return ORDER.find((c) => weaknesses.includes(c)) || null;
}

// The follow-up lines, per weakness category. Each is ONE spoken sentence,
// demanding and specific — never rude.
const FOLLOW_UPS = {
  no_personal_contribution: [
    'That sounds like a team effort — what did YOU personally build in it?',
    'I hear "we" a lot. What was your specific contribution?',
    'Set the team aside for a second: which part of that was yours?',
  ],
  no_measurable_result: [
    'What changed because of your work — give me a number.',
    'How did you measure that improvement?',
    'What was the before and after, in numbers?',
  ],
  no_technical_depth: [
    'Walk me through how that actually worked technically.',
    'What specific technology or technique made that possible?',
    'How did you implement that, step by step?',
  ],
  hedging: [
    "That's a broad answer. What specific technical advantage did that give you in this project?",
    'Drop the qualifiers — what exactly did you do?',
    'What are you certain about in that answer?',
  ],
  passive_voice: [
    'Who made that decision — and was that you?',
    'What did you decide, as opposed to what just happened?',
  ],
  too_short: [
    'Give me the full picture: what was the problem, what did you do, and what happened?',
  ],
};

export function buildFollowUp(category, { level = 1, usedCount = 0 } = {}) {
  const pool = FOLLOW_UPS[category] || FOLLOW_UPS.too_short;
  // Escalate phrasing with usage: first ask -> probe -> demand.
  const idx = Math.min(pool.length - 1, usedCount + (level >= 3 ? 1 : 0));
  return pool[idx];
}

// Pressure delta from analysis (replaces Day 2 word-count heuristic).
export function pressureDelta(analysis) {
  if (analysis.strong) return -1;
  if (analysis.specificity <= 3) return +1;
  if (analysis.weaknesses.length >= 2) return +1;
  return 0;
}
