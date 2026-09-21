// interview-engine.js — VoiceTwin Day 2.
// The complete interview state lives here (server-side, session-scoped).
// Shape is exactly what the plan allows — nothing more:
//   Interview { role, question, question_rubric, pressure_level, answer_count, current_answer, weaknesses[] }
//
// Day 2 scope: question sequencing + basic pressure levels (Day 3 will add
// adaptive follow-ups driven by answer analysis; Day 4 wires rubric scoring).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAnswer, buildFollowUp, pressureDelta } from './answer-analysis.js';
import { scoreAnswer, registerProbeChecks } from './rubric-scorer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS_PATH = path.join(ROOT, 'data', 'questions.json');

// Pressure ladder (Day 3 deepens this; Day 2 ships levels 1-3).
const PRESSURE = {
  1: 'friendly — "Can you tell me more?"',
  2: 'specific — "What exactly did you do?"',
  3: 'challenging — "I\'m looking for your specific contribution."',
  4: 'pressure — "You haven\'t given me a concrete example yet. Give me one."',
};

// Difficulty behavior (same dynamic interviewer, different depth).
// Pressure comes from the QUESTIONS, never from speed or aggression.
const MODES = {
  simple: { questions: 5, startLevel: 1, follows: 1,
    priority: ['overview', 'ownership', 'result', 'implementation_how', 'unknown', 'measurement', 'tradeoff', 'decision_why', 'scale', 'failure'] },
  medium: { questions: 5, startLevel: 1, follows: 2,
    priority: ['measurement', 'implementation_how', 'unknown', 'tradeoff', 'decision_why', 'scale', 'failure', 'ownership', 'result'] },
  hard: { questions: 5, startLevel: 2, follows: 2,
    priority: ['measurement', 'tradeoff', 'implementation_how', 'unknown', 'scale', 'failure', 'decision_why', 'ownership', 'result'] },
};
// Legacy callers (hidden dev selects) map onto the same table.
MODES.normal = MODES.medium;
MODES.pressure = MODES.hard;

// Practice-Again focus: previous weakness keys boost matching dimensions.
const FOCUS_DIM = {
  no_measurable_result: ['measurement', 'result'],
  no_personal_contribution: ['ownership', 'decision_why'],
  no_technical_depth: ['implementation_how', 'scale'],
  hedging: ['measurement', 'ownership'],
  passive_voice: ['ownership'],
  too_short: ['implementation_how', 'overview'],
};

// ---------------------------------------------------------------------------
// Project-aware interviewing (no fixed bank, no LLM, no RAG).
// Screen 1's project description is distilled ONCE into context the probes
// draw from. Extraction is deliberately conservative: anything not
// confidently matched stays unknown and is simply never referenced.
// ---------------------------------------------------------------------------

// Technology/entity vocabulary (superset of the answer-analysis hints).
const PROJECT_TECHS = [
  'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'node', 'express',
  'typescript', 'javascript', 'python', 'django', 'flask', 'fastapi', 'java',
  'spring', 'go ', 'golang', 'rust', '.net', 'ruby', 'rails', 'php', 'laravel',
  'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'mongo', 'mongodb',
  'redis', 'memcached', 'cassandra', 'dynamodb', 'elasticsearch', 'kafka',
  'rabbitmq', 'graphql', 'rest', 'grpc', 'websocket', 'oauth', 'jwt',
  'docker', 'kubernetes', 'k8s', 'aws', 'lambda', 's3', 'ec2', 'gcp', 'azure',
  'nginx', 'cdn', 'terraform', 'stripe', 'twilio', 'firebase', 'supabase',
  'prisma', 'redis', 'queue', 'cache', 'caching', 'cdn', 'microservice',
  'postgres', 'rdbms', 'nosql',
];

const DECISION_RES = [
  'chose', 'chosen', 'decid', 'picked', 'went with', 'opted', 'selected',
  'migrat', 'switch', 'moved from', 'instead of', 'rather than',
];
const CLAIM_RES = [
  'faster', 'slower', '\\bfast\\b', '\\bslow\\b', '\\bquick\\b', 'reduc', 'improv', 'scal', 'saved', 'grew', 'growing',
  'handled?', 'supports?', 'serves?', '%', 'percent',
];
// Spoken numbers ("five-minute TTL") count as numbers for claim detection.
const NUMWORD_RE = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million)\b/i;
const ACTION_RES = 'built|designed|wrote|implemented|created|developed|led|owned|coded|refactored|optimized|debugged|delivered|deployed|configured|set up|scaled|migrated|shipped';

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function techsIn(text) {
  const src = String(text || '');
  const found = [];
  for (const t of PROJECT_TECHS) {
    const tok = t.trim();
    if (!tok) continue;
    // Word tokens match on boundaries only ('rest' must not hit 'restaurant').
    // Non-word tokens ('.net', 'go ') match literally. Original casing kept
    // for display ("Redis", not "redis").
    const re = /^[a-z0-9]+$/.test(tok)
      ? new RegExp(`\\b${escRe(tok)}\\b`, 'i')
      : new RegExp(escRe(tok), 'i');
    const m = src.match(re);
    if (m && !found.some((f) => f.tech.toLowerCase() === m[0].toLowerCase())) {
      found.push({ tech: m[0], idx: m.index });
    }
  }
  found.sort((a, b) => a.idx - b.idx);
  return found.map((f) => f.tech);
}

// Distill Screen 1's description once. Unknowns stay absent — never guessed.
export function extractProjectContext(description) {
  const raw = String(description || '').trim();
  const sentences = sentencesOf(raw);
  const tech = techsIn(raw);
  const decisions = [];
  const claims = [];
  let numbers = 0;
  for (const s of sentences) {
    const sl = s.toLowerCase();
    numbers += (sl.match(/\d+/g) || []).length;
    const st = techsIn(s);
    const isDecision = DECISION_RES.some((d) => sl.includes(d)) ||
      (/us(e|ed|ing)\b/.test(sl) && /(for|because|to (cache|handle|scale|solve|fix|speed|reduce|improve|store|serve))\b/.test(sl));
    if (isDecision) decisions.push({ tech: st[0] || null, sentence: s });
    const isClaim = CLAIM_RES.some((c) => new RegExp(c, 'i').test(sl)) ||
      (/\bi\b/.test(sl) && new RegExp(`\\bi\\s+(${ACTION_RES})\\b`, 'i').test(sl));
    if (isClaim) claims.push(s.length > 90 ? s.slice(0, 90) + '…' : s);
  }
  let scope = 'this project';
  const m = raw.match(/([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3})\s+(app|application|platform|service|system|website|tool|dashboard|api)\b/i);
  if (m) {
    // Drop leading verbs/articles ("I built a food delivery application" -> food delivery).
    const words = m[1].trim().split(/\s+/).filter((w) => !/^(i|built|created|made|developed|building|a|an|the|my|our)$/i.test(w));
    if (words.length) scope = `the ${words.slice(-3).join(' ')} ${m[2].toLowerCase()}`;
  }
  return { raw, tech, decisions, claims, numbers, scope };
}

// Shared-vocabulary match for brief unknowns ("cache invalidation" vs an
// answer about "caching"): content words sharing a 4+ char stem.
function topicMatches(tokens, topic) {
  const norm = (w) => String(w || '').toLowerCase().replace(/[^a-z]/g, '');
  const tw = topic.split(/\s+/).map(norm).filter((w) => w.length > 3);
  return tokens.map(norm).filter((w) => w.length > 3).some((t) =>
    tw.some((u) => t.startsWith(u.slice(0, 4)) || u.startsWith(t.slice(0, 4))));
}

function answerKeywords(answer, sig) {
  const words = String(answer || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return [...new Set([...(sig.tech || []).map((t) => t.toLowerCase()), ...words])];
}

// Entities/claims inside a live answer (drives the NEXT probe).
function answerSignals(answer) {
  const text = String(answer || '');
  const sl = text.toLowerCase();
  return {
    tech: techsIn(text),
    hasNumber: NUMWORD_RE.test(sl),
    hasClaim: CLAIM_RES.some((c) => new RegExp(c, 'i').test(sl)),
    hasDecision: new RegExp(`(${DECISION_RES.join('|')}|\\bus(e|ed|ing)\\b)`, 'i').test(sl),
  };
}

function usePhrase(answer) {
  const m = String(answer || '').match(/us(?:e|ed|ing)(?:\s+(?:it|them|that))?\s+for\s+([^.!\n]{3,60})/i) ||
    String(answer || '').match(/\bto\s+(cache|handle|serve|store|scale|process|manage)\s+([^.!\n]{3,50})/i);
  if (!m) return null;
  const phrase = (m[1] + (m[2] ? ` ${m[2]}` : '')).trim();
  return phrase.length >= 3 ? phrase : null;
}

function shortClaim(answer) {
  const s = sentencesOf(answer).find((x) => NUMWORD_RE.test(x) || CLAIM_RES.some((c) => new RegExp(c, 'i').test(x)));
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 75 ? t.slice(0, 75) + '…' : t;
}

// ---- probe text builders (entity-interpolated, never hardcoded) ----
function probeText(type, { tech = null, use = null, claim = null, scope = 'this project' } = {}) {
  switch (type) {
    case 'decision_why':
      return `Why did you choose ${tech || 'that stack'} for this project?`;
    case 'implementation_how':
      if (use && tech) return `How does ${use} work with ${tech} under the hood?`;
      if (tech) return `How does ${tech} work in your system, under the hood?`;
      return 'Walk me through how the most important piece of this works, technically.';
    case 'tradeoff':
      return tech
        ? `What did ${tech} cost you — what tradeoff or alternative did you consider?`
        : 'What tradeoff in this project hurt the most, and what alternative did you reject?';
    case 'measurement': {
      const base = claim ? `You mentioned ${claim} — how did you measure that?` : 'How did you measure whether that actually worked?';
      return /(cach|ttl|expir|stale)/i.test(`${claim || ''}`)
        ? `You mentioned ${claim || 'caching'} — how did you arrive at that setup, and what happens if data goes stale?`
        : base;
    }
    case 'scale':
      return `What breaks first in ${scope} as load grows, and why?`;
    case 'failure':
      return 'What was the worst failure you hit while building this, and what caused it?';
    case 'ownership':
      return 'Which part of this did you personally build, and what did others own?';
    case 'result':
      return 'What changed because of this project — give me a number.';
    default:
      return 'Walk me through what you built — what does it do, and what was the hardest part?';
  }
}

// ---- per-probe evidence checks (same shape as the static rubric) ----
const FAM = {
  problem: 'slow|fast|performance|latency|bottleneck|problem|needed|required|too slow|pain|issue',
  whyFit: 'because|chose|fit|right tool|compared|instead of|rather than|better than|suited',
  action: 'built|wrote|implemented|configured|set up|deployed|designed|keys?|ttl|expir|cluster|replica|index|cache|query|endpoint|service',
  tradeoff: 'trade.?off|instead of|rather than|compared to|at the cost|downside|cheaper|simpler|more complex|expensive|cost',
  metric: '\\b\\d+(\\.\\d+)?\\s*(%|percent|ms|seconds?|minutes?|hours?|users?|requests?|rps|qps|x\\b)|reduced|improved|faster|saved|from \\d+ to \\d+',
  me: '\\b(i|my|me)\\b',
};

function checksFor(type, tech, project) {
  const T = tech ? escRe(tech) : null;
  const hasT = (extra) => (T ? [`\\b${T}\\b`, extra] : [extra]);
  const M = (short) => short; // chip labels stay short
  switch (type) {
    case 'decision_why': return [
      { point: `Names the problem ${tech} had to solve`, short: M('problem'), demand: `What problem was ${tech} solving for you?`, all: [FAM.problem] },
      { point: `Explains why ${tech} fit`, short: M('why-fit'), demand: `Why ${tech} specifically — what made it the right fit?`, all: hasT(FAM.whyFit) },
      { point: `Gives an implementation detail for ${tech}`, short: M('detail'), demand: `How did you actually run ${tech} — give me an implementation detail.`, all: hasT(FAM.action) },
      { point: `Discusses a tradeoff or alternative to ${tech}`, short: M('tradeoff'), demand: `What did ${tech} cost you — what tradeoff did you accept?`, all: [FAM.tradeoff] },
      { point: 'Provides evidence or a measured result', short: M('evidence'), demand: 'What specifically improved, and how did you measure the improvement?', all: [FAM.metric] },
    ];
    case 'implementation_how':
    case 'unknown': return [
      { point: `Describes how the piece works with ${tech || 'the stack'}`, short: M('how'), demand: tech ? `Walk me through it step by step — what happens inside ${tech}?` : 'Walk me through it step by step — what happens inside?', all: T ? [`\\b${T}\\b`] : ['how|steps?|first|then|after|flow'] },
      { point: 'Names concrete components or operations', short: M('components'), demand: 'What are the moving parts — name them concretely.', all: [FAM.action] },
      { point: 'Explains a decision inside the implementation', short: M('decision'), demand: 'What decision inside that implementation mattered most?', all: ['because|chose|decided|instead of|rather than|configured|set'] },
      { point: 'Mentions an edge case or failure mode', short: M('edge-case'), demand: 'What breaks in that setup, and how did you handle it?', all: ['fail|edge|stale|expir|timeout|race|crash|wrong|missing|fallback|retry'] },
      { point: 'Provides evidence or a measured result', short: M('evidence'), demand: 'What specifically improved, and how did you measure the improvement?', all: [FAM.metric] },
    ];
    case 'tradeoff': return [
      { point: 'Names the tradeoff or cost', short: M('cost'), demand: tech ? `What did ${tech} actually cost you?` : 'What did that choice actually cost you?', all: [FAM.tradeoff] },
      { point: 'Names the alternative considered', short: M('alternative'), demand: 'What was the alternative, and why did it lose?', all: ['instead of|rather than|alternative|considered|compared|other option|versus|vs\\.?'] },
      { point: 'Explains the reasoning with a personal stake', short: M('reasoning'), demand: 'What was YOUR reasoning — why did you land there?', all: [FAM.me, FAM.whyFit] },
      { point: 'Gives an implementation consequence', short: M('consequence'), demand: 'What did that tradeoff force you to build differently?', all: [FAM.action] },
      { point: 'Provides evidence the tradeoff paid off (or not)', short: M('evidence'), demand: 'Did the tradeoff pay off — what number says so?', all: [FAM.metric] },
    ];
    case 'measurement': return [
      { point: 'States what was measured and how', short: M('method'), demand: 'How exactly did you measure it — what tool or number?', all: ['measur|profil|benchmark|timing|dashboard|metric|logged|traced|load test|before and after'] },
      { point: 'Gives before-and-after numbers', short: M('numbers'), demand: 'What was the number before, and the number after?', all: [FAM.metric] },
      { point: 'Explains why that metric is the right one', short: M('right-metric'), demand: 'Why is that the right metric for this?', all: ['because|matters|users? (feel|saw)|matters|right (metric|measure)|proxy'] },
      { point: 'Shows personal involvement in measuring', short: M('ownership'), demand: 'Was that measurement yours — what did you run yourself?', all: [FAM.me, 'measur|ran|profil|test|check|watch'] },
      { point: 'States what the number changed (decision/result)', short: M('outcome'), demand: 'What did that number make you do differently?', all: ['changed|decided|shipped|kept|reverted|tuned|fixed|proved'] },
    ];
    case 'scale': return [
      { point: 'Identifies what breaks first', short: M('first-break'), demand: 'Which component hits its limit first?', all: ['bottleneck|first|database|\\bdb\\b|cache|single|memory|connection|queue|saturat|maxes out|fall over'] },
      { point: 'Explains why with load reasoning', short: M('why'), demand: 'Why that component — what runs out?', all: ['because|load|requests|connections|memory|grows|scales|contention'] },
      { point: 'Proposes a concrete scaling technique', short: M('technique'), demand: 'What concrete technique gets past it?', all: ['shard|replica|cach|queue|horizontal|scale out|index|batch|async|load balanc|partition'] },
      { point: 'Mentions tradeoff or cost', short: M('tradeoff'), demand: 'And what does that approach cost?', all: [FAM.tradeoff] },
      { point: 'Defines how to verify scaling worked', short: M('verify'), demand: 'How would you verify the scaling actually worked?', all: ['load test|benchmark|measur|verify|p95|p99|monitor|metric|canary'] },
    ];
    case 'failure': return [
      { point: 'Describes the failure and its impact', short: M('impact'), demand: 'What broke, and who felt it?', all: ['outage|down|crash|broke|incident|downtime|impact|affected|fail'] },
      { point: 'Explains how it was detected', short: M('detection'), demand: 'How did you find out?', all: ['alert|monitor|noticed|reported|logs?|paged|dashboard|complaint'] },
      { point: 'Identifies the root cause', short: M('root-cause'), demand: 'What was the root cause?', all: ['root cause|caused by|because|due to|bug|config|race|turns? out'] },
      { point: 'Describes the fix or mitigation', short: M('fix'), demand: 'What fixed it?', all: ['fixed|rollback|revert|hot.?fix|restart|failover|patched|resolved'] },
      { point: 'States what changed afterwards', short: M('prevention'), demand: 'What changed so it cannot happen the same way again?', all: ['since then|now we|added|process|checklist|test|alert|runbook|lesson|learned'] },
    ];
    case 'ownership': return [
      { point: 'Names their personal contribution', short: M('my-part'), demand: 'Which part was yours, specifically?', all: [FAM.me, FAM.action] },
      { point: 'Distinguishes others’ contributions', short: M('their-part'), demand: 'What did others own?', all: ['they|team|colleague|teammate|other|rest of|partner'] },
      { point: 'Explains a decision they owned', short: M('my-decision'), demand: 'What decision was yours alone?', all: [FAM.me, 'decided|chose|picked|owned|led|drove'] },
      { point: 'Gives an implementation detail of their part', short: M('detail'), demand: 'Give me a technical detail from your part.', all: [FAM.action] },
      { point: 'Provides evidence of their impact', short: M('impact'), demand: 'What changed because of your part — a number?', all: [FAM.metric] },
    ];
    case 'result': return [
      { point: 'States a concrete outcome', short: M('outcome'), demand: 'What concretely changed?', all: ['shipped|launched|reduced|improved|faster|saved|grew|delivered|live|production'] },
      { point: 'Backs it with a number', short: M('number'), demand: 'Give me the number.', all: [FAM.metric] },
      { point: 'Connects outcome to their own work', short: M('mine'), demand: 'How much of that was your doing?', all: [FAM.me] },
      { point: 'Names who benefited', short: M('who'), demand: 'Who felt that improvement?', all: ['users?|customers?|team|business|client'] },
      { point: 'States what came next', short: M('next'), demand: 'What did that result unlock next?', all: ['then|next|after|since|scaled|expanded|followed|led to'] },
    ];
    default: return [ // overview fallback (extraction found almost nothing)
      { point: 'Describes what was built', short: M('what'), demand: 'What does it actually do — describe it concretely.', all: ['built|app|system|service|tool|platform|does|allows|lets'] },
      { point: 'Names the stack', short: M('stack'), demand: 'What is it built with?', all: ['react|node|python|java|go|sql|mongo|redis|api|database|frontend|backend|stack'] },
      { point: 'States the hard part', short: M('hard-part'), demand: 'What was the hardest part?', all: ['hard|difficult|challeng|complex|tricky|tough|struggl'] },
      { point: 'States their own role', short: M('role'), demand: 'What was your role in it?', all: [FAM.me] },
      { point: 'Gives any concrete detail or number', short: M('detail'), demand: 'Give me one concrete detail or number.', all: ['\\d+|because|configured|implemented|designed'] },
    ];
  }
}

// First probe: brief decisions/claims first (understood meaning), then
// strongest extracted decision, then top tech, else overview fallback.
function buildFirstProbe(project, brief) {
  const bd = brief?.technical_decisions?.find((d) => d.decision && d.decision !== 'unknown');
  if (bd) {
    const tech = techsIn(`${bd.decision} ${bd.reason || ''}`)[0] || (project.tech || [])[0] || null;
    if (tech) return { type: 'decision_why', tech, text: probeText('decision_why', { tech }), entities: [tech] };
  }
  const bc = brief?.technical_claims?.find((c) => c && c !== 'unknown');
  if (bc) {
    return { type: 'measurement', tech: techsIn(bc)[0] || null, text: probeText('measurement', { claim: bc.length > 75 ? bc.slice(0, 75) + '…' : bc }), entities: techsIn(bc) };
  }
  const withTech = project.decisions.find((d) => d.tech) || null;
  if (withTech) {
    return { type: 'decision_why', tech: withTech.tech, text: probeText('decision_why', { tech: withTech.tech }), entities: [withTech.tech] };
  }
  if (project.claims.length) {
    const claim = project.claims[0];
    return { type: 'measurement', tech: techsIn(claim)[0] || project.tech[0] || null, text: probeText('measurement', { claim }), entities: techsIn(claim) };
  }
  if (project.tech.length) {
    return { type: 'decision_why', tech: project.tech[0], text: probeText('decision_why', { tech: project.tech[0] }), entities: [project.tech[0]] };
  }
  return { type: 'overview', tech: null, text: probeText('overview', {}), entities: [] };
}

// Next probe: strongest unresolved point — new answer entities first,
// then uncovered dimensions. Deterministic order, never repeats a type.

function buildFollowProbeSpec(iv) {
  const project = iv.project;
  const answer = iv.state.current_answer || '';
  const sig = answerSignals(answer);
  const used = new Set(iv.probes.map((p) => p.type));
  const probedEnt = new Set(iv.probes.flatMap((p) => p.entities || []));
  const freshEnt = sig.tech.filter((t) => !probedEnt.has(t));
  const lastEnt = iv.probes.length ? (iv.probes[iv.probes.length - 1].entities || [])[0] || null : null;
  const use = usePhrase(answer);
  const claim = shortClaim(answer);
  // Conversation window: the unknown-matcher sees the current answer PLUS
  // what led here (last probe text + previous answer), so follow-ups stay
  // on the thread instead of going literal on one sentence.
  const lastProbe = iv.probes.length ? iv.probes[iv.probes.length - 1] : null;
  const windowKeys = answerKeywords(
    [answer, lastProbe?.text || '', iv.prevAnswer || ''].join(' '), sig,
  );

  const cands = [];
  // New claim/number in THIS answer → measure it.
  if ((sig.hasNumber || sig.hasClaim) && !used.has('measurement')) {
    cands.push({ type: 'measurement', tech: freshEnt[0] || sig.tech[0] || lastEnt, claim, score: 10 });
  }
  // Answer describes a use ("used it for X") → go under the hood.
  if (use && !used.has('implementation_how')) {
    cands.push({ type: 'implementation_how', tech: lastEnt || freshEnt[0] || sig.tech[0] || project.tech[0] || null, use, score: 9 });
  }
  // Fresh tech named → why that choice.
  if (freshEnt.length && !used.has('decision_why')) {
    cands.push({ type: 'decision_why', tech: freshEnt[0], score: 8 });
  }
  // Decision language → tradeoff.
  if (sig.hasDecision && !used.has('tradeoff')) {
    cands.push({ type: 'tradeoff', tech: freshEnt[0] || sig.tech[0] || lastEnt || project.tech[0] || null, score: 6 });
  }
  // Brief unknown the answer touches ("caching" + unknown "cache
  // invalidation") → legitimate question ABOUT the unknown, never asserting it.
  if (!used.has('unknown') && iv.projectBrief?.unknowns?.length) {
    const hit = iv.projectBrief.unknowns
      .filter((u) => typeof u === 'string' && u !== 'unknown')
      .find((u) => topicMatches(windowKeys, u));
    if (hit) {
      const ent = lastEnt || freshEnt[0] || sig.tech[0] || null;
      cands.push({
        type: 'unknown', tech: ent, topic: hit,
        use: use || claim || (ent ? `${ent} setup` : 'that setup'), score: 7,
      });
    }
  }
  if (!used.has('scale') && iv.probeCount >= 2) cands.push({ type: 'scale', tech: null, score: 4 });
  if (!used.has('failure') && iv.probeCount >= 3) cands.push({ type: 'failure', tech: null, score: 3 });
  if (!used.has('ownership') && iv.probeCount >= 3) cands.push({ type: 'ownership', tech: null, score: 2 });
  if (!used.has('result')) cands.push({ type: 'result', tech: null, score: 1 });
  if (!used.has('decision_why') && project.tech.some((t) => !probedEnt.has(t))) {
    cands.push({ type: 'decision_why', tech: project.tech.find((t) => !probedEnt.has(t)), score: 0 });
  }
  cands.sort((a, b) => b.score - a.score || iv.modeCfg.priority.indexOf(a.type) - iv.modeCfg.priority.indexOf(b.type));
  // Practice-Again focus: previously-weak dimensions outrank ties.
  if (iv.focusDims && iv.focusDims.size) {
    cands.sort((a, b) =>
      (b.score + (iv.focusDims.has(b.type) ? 4 : 0)) - (a.score + (iv.focusDims.has(a.type) ? 4 : 0)));
  }
  const win = cands[0] || { type: 'overview', tech: null };
  const entities = win.tech ? [win.tech] : [];
  return {
    type: win.type,
    tech: win.tech || null,
    text: win.type === 'unknown'
      ? `You mentioned ${String(win.use || 'that').replace(/[.!\s]+$/, '')}. How did you handle ${win.topic}?`
      : probeText(win.type, { tech: win.tech || undefined, use: win.use, claim: win.claim, scope: project.scope }),
    entities,
  };
}

export class Interview {
  constructor({ role = 'Software Engineer', mode = 'normal', projectDescription = null, focusWeaknesses = [], projectBrief = null } = {}) {
    const catalog = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
    if (catalog.role !== role) {
      // Single-role catalog on Day 2; requested role must match or fail loudly.
      throw new Error(`unknown role "${role}" (catalog has "${catalog.role}")`);
    }
    this.modeCfg = MODES[mode] || MODES.medium;
    this.modeName = MODES[mode] ? mode : 'medium';
    this.maxQuestions = 8; // legacy bank length; dynamic path uses mode count
    this.maxFollows = this.modeCfg.follows; // Simple asks once; others probe twice
    this.focusDims = new Set(
      (Array.isArray(focusWeaknesses) ? focusWeaknesses : [])
        .flatMap((w) => FOCUS_DIM[w] || []),
    );
    this.role = role;
    this.mode = mode; // 'normal' | 'pressure' (pressure starts at level 2)
    this.questions = catalog.questions.map((q) => ({
      id: q.id,
      question: q.question,
      rubric: q.rubric,
      followUpProbe: q.follow_up_probe,
    }));
    this.queue = [...this.questions];
    // Project-aware path: Screen 1's description becomes interview context.
    // Dynamic mode bypasses the bank queue (file stays on disk, untouched).
    this.projectDescription = String(projectDescription || '').trim();
    this.project = this.projectDescription.length >= 20
      ? extractProjectContext(this.projectDescription)
      : null;
    this.dynamic = Boolean(this.project);
    this.probes = [];    // dynamic history: { id, text, type, entities }
    this.probeCount = 0;
    this.lastEval = null; // last evaluateAnswer output (feeds the next probe)
    this.prevAnswer = ''; // answer behind the last probe (unknown threading)
    // ONE-per-interview brief (LLM or deterministic). Description stays source.
    this.projectBrief = projectBrief && typeof projectBrief === 'object' ? projectBrief : null;
    if (this.dynamic) this.queue = [];
    this.state = {
      role,
      question: null,          // { id, text } — current question
      question_rubric: null,   // points the Day 4 scorer will check
      pressure_level: mode === 'pressure' ? 2 : this.modeCfg.startLevel,
      answer_count: 0,
      current_answer: '',      // latest final user transcript for this question
      weaknesses: [],          // categorized signals (Day 3)
      lastRubric: null,        // Day 4: rubric score for the current question
    };
    this.rubricLog = [];       // one entry per answered question (report fuel)
    this.stats = { fillerWords: 0, vagueAnswers: 0, incompleteAnswers: 0, answers: 0 }; // Day 6 demo stats
    this.questionAskedAt = null;
    this.followUpCount = 0; // follow-ups asked for the current question
  }

  // Server-side session cap (independent of client caps).
  static MAX_QUESTIONS = 8;
  static MAX_FOLLOWS_PER_Q = 2;
  static IDLE_NUDGE_AFTER_MS = 8000; // candidate silent 8s -> gentle nudge

  get pressureLadder() { return PRESSURE; }

  currentQuestion() {
    return this.state.question;
  }

  // Pull the next question (or null when finished).
  // Dynamic mode generates exactly one probe on demand from project context
  // + conversation history — never a predetermined list.
  nextQuestion() {
    if (this.dynamic) return this.nextProbe();
    const q = this.queue.shift();
    if (!q) return null;
    this.state.question = { id: q.id, text: q.question };
    this.state.question_rubric = q.rubric;
    this.state.current_answer = '';
    this.followUpCount = 0;
    this.questionAskedAt = Date.now();
    return { ...this.state.question };
  }

  // Dynamic probe: P1/P2/… are internal identifiers only. The text and its
  // 5 evidence checks are derived from the live conversation each time.
  nextProbe() {
    if (this.probeCount >= this.modeCfg.questions) return null;
    const spec = this.probeCount === 0
      ? buildFirstProbe(this.project, this.projectBrief)
      : buildFollowProbeSpec(this);
    const id = `P${this.probeCount + 1}`;
    const checks = checksFor(spec.type, spec.tech, this.project);
    registerProbeChecks(id, checks);
    this.probeCount++;
    this.probes.push({ id, text: spec.text, type: spec.type, entities: spec.entities || [] });
    this.prevAnswer = this.state.current_answer || '';
    this.state.question = { id, text: spec.text };
    this.state.question_rubric = checks.map((c) => c.point);
    this.state.current_answer = '';
    this.followUpCount = 0;
    this.questionAskedAt = Date.now();
    return { ...this.state.question };
  }

  // Record the candidate's final utterance for the current question.
  appendAnswer(text) {
    if (!text) return;
    this.state.current_answer = this.state.current_answer
      ? `${this.state.current_answer} ${text}`
      : text;
  }

  // Day 2 pressure heuristic — REPLACED on Day 3 by analyzeAnswer(); kept as
  // a fallback for degenerate input (empty answer).
  evaluatePressure(answerText) {
    const words = (answerText || '').trim().split(/\s+/).filter(Boolean);
    const contentWords = words.filter((w) => w.length > 3).length;
    let direction = 0;
    if (contentWords < 6) direction = +1;
    else if (contentWords >= 25) direction = -1;
    const before = this.state.pressure_level;
    this.state.pressure_level = Math.min(4, Math.max(1, before + direction));
    return { level: this.state.pressure_level, direction, before, contentWords };
  }

  // Day 3+4: full adaptive evaluation. Runs the specificity analysis AND the
  // rubric scorer, adjusts pressure, appends weaknesses, and returns the exact
  // follow-up to speak. Day 4 rule: missing RUBRIC EVIDENCE outranks generic
  // signals — the agent demands the first missing evidence point (rubric order
  // = most fundamental first).
  evaluateAnswer(answerText) {
    const analysis = analyzeAnswer(answerText);
    const rubric = scoreAnswer(this.state.question?.id, this.state.current_answer);
    this.state.lastRubric = rubric;
    this.lastEval = { rubric, analysis }; // feeds the next dynamic probe

    const before = this.state.pressure_level;
    let delta = analysis.wordCount < 1 ? +1 : pressureDelta(analysis);
    if (rubric.pointsTotal > 0 && rubric.pointsEarned === 0) delta = Math.max(delta, +1); // no evidence at all
    if (rubric.pointsTotal > 0 && rubric.pointsEarned === rubric.pointsTotal) delta = Math.min(delta, -1); // full evidence
    this.state.pressure_level = Math.min(4, Math.max(1, before + delta));

    for (const w of analysis.weaknesses) {
      if (!this.state.weaknesses.includes(w)) this.state.weaknesses.push(w);
    }

    // Day 6 stats: aggregate per-answer signals for the results screen.
    this.stats.answers++;
    this.stats.fillerWords += analysis.signals?.fillerCount ?? 0;
    if (analysis.weaknesses.includes('hedging') || analysis.specificity <= 4) this.stats.vagueAnswers++;
    if (analysis.wordCount > 0 && analysis.wordCount < 10) this.stats.incompleteAnswers++;

    const missing = rubric.results.filter((r) => !r.earned);
    const allEvidencePresent = rubric.pointsTotal > 0 && missing.length === 0;

    let followUp = null;
    let followUpKind = null;
    if (!allEvidencePresent && this.followUpCount < this.maxFollows) {
      if (missing.length > 0) {
        // Day 4: demand the specific missing evidence — verbatim.
        followUp = missing[0].demand;
        followUpKind = 'missing_evidence';
      } else {
        // Rubric satisfied but specificity signals are weak — generic probe.
        followUp = buildFollowUp(analysis.category, {
          level: this.state.pressure_level,
          usedCount: this.followUpCount,
        });
        followUpKind = 'signal';
      }
      this.followUpCount++;
    }

    return {
      analysis,
      rubric,
      pressure: {
        level: this.state.pressure_level,
        direction: Math.sign(this.state.pressure_level - before),
        before,
      },
      followUp,               // string | null — agent speaks this verbatim
      followUpKind,           // 'missing_evidence' | 'signal' | null
      followUpBudget: this.maxFollows - this.followUpCount,
      moveOnRecommended:
        allEvidencePresent || this.followUpCount >= this.maxFollows,
    };
  }

  // Close out the current question: freeze its rubric score into the log.
  // Called by the /next route BEFORE serving the next question.
  recordQuestionResult() {
    const q = this.state.question;
    if (!q || this.state.lastRubric == null) return;
    const r = this.state.lastRubric;
    const missed = r.results.filter((x) => !x.earned);
    this.rubricLog.push({
      id: q.id,
      question: q.text,
      answer: this.state.current_answer || '', // persisted verbatim for history
      pointsEarned: r.pointsEarned,
      pointsTotal: r.pointsTotal,
      missed: missed.map((x) => x.point),
      missedDemands: missed.map((x) => x.demand), // grounded focus items
    });
    this.state.lastRubric = null;
  }

  // Final evidence-based report (Day 4 deliverable — replaces a vibe score).
  report() {
    // A question still open when the interview ends still deserves its score.
    this.recordQuestionResult();
    const totalEarned = this.rubricLog.reduce((s, r) => s + r.pointsEarned, 0);
    const totalPossible = this.rubricLog.reduce((s, r) => s + r.pointsTotal, 0);
    // Weakest question = lowest earned ratio (ties -> more missed evidence).
    const weakest = [...this.rubricLog].sort(
      (a, b) => (a.pointsEarned / Math.max(1, a.pointsTotal)) - (b.pointsEarned / Math.max(1, b.pointsTotal))
        || b.missed.length - a.missed.length,
    )[0] || null;
    // Tutor split — measured signals only, no invented scores.
    // Technical: missed evidence points. Communication: hedging/brevity/
    // filler signals the detectors actually recorded.
    const COMM_RE = /hedg|unclear|vague|filler|short|sentence|follow|complete|confiden/i;
    const techMissed = [];
    const commMissed = [];
    for (const r of this.rubricLog) {
      for (const m of r.missed) (COMM_RE.test(m) ? commMissed : techMissed).push(m);
    }
    const commNotes = [];
    if ((this.stats.vagueAnswers || 0) > 0 || this.state.weaknesses.includes('hedging')) {
      commNotes.push('Some answers were difficult to follow — state the decision, reason, and result in separate sentences.');
    }
    if ((this.stats.fillerWords || 0) >= 5) {
      commNotes.push('Filler words crept in — pause instead of filling silence.');
    }
    if ((this.stats.incompleteAnswers || 0) > 0 || this.state.weaknesses.includes('too_short')) {
      commNotes.push('Several answers were incomplete sentences — finish the thought, then stop.');
    }
    return {
      role: this.role,
      mode: this.mode,
      questionsAsked: this.rubricLog.length,
      perQuestion: this.rubricLog,
      totalEarned,
      totalPossible,
      evidenceScore: totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : null,
      weakest: weakest
        ? { id: weakest.id, question: weakest.question, pointsEarned: weakest.pointsEarned, pointsTotal: weakest.pointsTotal, missed: weakest.missed, missedDemands: weakest.missedDemands || [] }
        : null,
      weaknesses: [...this.state.weaknesses],
      feedback: {
        technical: [...new Set(techMissed)].slice(0, 5),
        communication: [...new Set(commMissed)].slice(0, 3),
        commNotes,
        focus: [...new Set([...(weakest?.missedDemands || []), ...techMissed])].slice(0, 3),
      },
      stats: { ...this.stats }, // Day 6: fillers / vague / incomplete counts
    };
  }

  // Escalation phrasing by level (spoken verbatim by the agent).
  pressurePhrase() {
    const p = this.state.pressure_level;
    const probe = this.queue.length >= 0 && this.currentQuestion()
      ? this.questions.find((q) => q.id === this.currentQuestion().id)?.followUpProbe
      : null;
    switch (p) {
      case 4: return "You haven't given me a concrete example yet. Give me one.";
      case 3: return probe || "I'm looking for your specific contribution.";
      case 2: return probe || 'What exactly did you do?';
      default: return 'Can you tell me more?';
    }
  }

  advanceAfterAnswer() {
    this.state.answer_count++;
  }

  isFinished() {
    if (this.dynamic) return this.probeCount >= this.modeCfg.questions;
    return this.queue.length === 0 && this.followUpCount >= this.maxFollows;
  }

  snapshot() {
    return {
      ...this.state,
      questionsRemaining: this.dynamic
        ? Math.max(0, this.modeCfg.questions - this.probeCount)
        : this.queue.length,
      maxFollowUpsPerQuestion: this.maxFollows,
      followUpsUsed: this.followUpCount,
      idleNudgeAfterMs: Interview.IDLE_NUDGE_AFTER_MS,
      mode: this.mode,
      rubricSoFar: this.rubricLog.map((r) => ({ id: r.id, pointsEarned: r.pointsEarned, pointsTotal: r.pointsTotal })),
    };
  }
}

// Session registry (in-memory; one active interview per browser session id).
const sessions = new Map();

export function getInterview(sessionId) {
  const iv = sessions.get(sessionId) || null;
  if (iv) iv.lastTouched = Date.now();
  return iv;
}

export function createInterview(sessionId, opts) {
  const iv = new Interview(opts);
  iv.lastTouched = Date.now();
  sessions.set(sessionId, iv);
  return iv;
}

export function endInterview(sessionId) {
  const iv = sessions.get(sessionId);
  sessions.delete(sessionId);
  return iv ? iv.snapshot() : null;
}

export function sessionCount() {
  return sessions.size;
}

// Live interviews owned by one user (in-flight cap). Single-process only.
export function activeCountFor(userId) {
  let n = 0;
  for (const iv of sessions.values()) {
    if (iv && iv.ownerId === userId) n++;
  }
  return n;
}

// Day 7 (Test I): a browser refresh never calls /end, so the in-memory
// interview would linger forever. Idle sessions older than 30 min are swept.
export function sweepSessions(maxIdleMs = 30 * 60_000) {
  const now = Date.now();
  let swept = 0;
  for (const [id, iv] of sessions) {
    if (now - (iv.lastTouched || 0) > maxIdleMs) {
      sessions.delete(id);
      swept++;
    }
  }
  return swept;
}
