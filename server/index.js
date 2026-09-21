// VoiceTwin server — Page 1 (Day 1)
// Responsibilities:
//   1. Mint single-use temporary tokens (API key NEVER reaches the browser).
//   2. Serve the static browser client.
//   3. Latency log ingest + retrieval (T0..T3 protocol from the harness page).
//   4. Usage discipline: session caps + a test counter so credits are tracked.
//
// Endpoints:
//   GET  /api/health            -> ok + config echo (no secrets)
//   GET  /api/voice-token       -> { token, expiresIn, maxSessionSeconds }
//   GET  /api/usage             -> { sessionsStarted, tokensMinted, lastSessionAt }
//   POST /api/sessions          -> record a session lifecycle update
//   POST /api/latency           -> ingest one latency sample (T0..T3)
//   GET  /api/latency           -> list of samples for the run table
//   GET  /api/latency/summary   -> per-test median T3-T0 + decision gate verdict
//
// Run:  node server/index.js   (or: npm start)

import './env.js'; // FIRST: load .env before config snapshots process.env
import http from 'node:http';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import { mintToken } from './token.js';
import { latencyStore } from './latency-store.js';
import { getInterview, createInterview, endInterview, sessionCount, sweepSessions, extractProjectContext, activeCountFor } from './interview-engine.js';
import { getPractice, createPractice, endPractice, practiceCount, sweepPracticeSessions } from './practice-engine.js';
import { buildSystemPrompt, buildTools, buildPracticePrompt, buildPracticeTools } from './instructions.js';
import { buildProjectBrief, renderBriefForPrompt } from './project-analyzer.js';
import { verifyUser } from './auth.js';
import { saveInterview, saveAnswers, completeInterview, listInterviews, getInterview as getSavedInterview, mapReportToRow } from './db.js';
// Day 3: answer analysis is used inside interview-engine.evaluateAnswer()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.VERCEL ? '/tmp/voicetwin-data' : path.join(ROOT, 'data');

// ---- env already loaded by ./env.js (first import above) ----
if (!process.env.ASSEMBLYAI_API_KEY && !process.env.VERCEL) {
  console.error('[voicetwin] Missing ASSEMBLYAI_API_KEY. Copy .env.example to .env and paste your key.');
  process.exit(1);
}

// ---- simple usage counter (in-memory + JSONL on disk) ----
const usage = { sessionsStarted: 0, tokensMinted: 0, lastSessionAt: null };
mkdirSync(DATA_DIR, { recursive: true });
const usageFile = path.join(DATA_DIR, 'usage.jsonl');

function logUsage(event) {
  const rec = { at: new Date().toISOString(), ...event };
  appendFileSync(usageFile, JSON.stringify(rec) + '\n');
}

// ---- static file serving ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ---- multi-user guards (no framework, same hand-rolled style) ----
// Authenticated user only — user_id ALWAYS comes from the verified session,
// never from any client-supplied field.
async function requireUser(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const err = new Error('authentication required');
    err.status = 401;
    throw err;
  }
  const user = await verifyUser(req);
  return { user, token: m[1].trim() };
}

function sendErr(res, err, fallback = 'request failed') {
  const status = err && Number.isFinite(err.status) ? err.status : 500;
  const message = status < 500 ? (err.message || fallback) : fallback;
  return sendJSON(res, status, { error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'request_failed', message });
}

// Sliding-window limits: key -> [timestamps]. In-memory, per process.
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  if (buckets.size > 20000) buckets.clear();
  buckets.set(key, arr);
  return false;
}

const VALID_MODES = new Set(['simple', 'medium', 'hard', 'normal', 'pressure']);

function checkOwnsInterview(iv, userId) {
  // 404 whether missing OR another user's — no existence oracle.
  if (!iv || iv.ownerId !== userId) {
    const err = new Error('interview not found');
    err.status = 404;
    throw err;
  }
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  // ---- public frontend config (Supabase URL + anon key are public by design) ----
  if (route === 'GET /api/config') {
    return sendJSON(res, 200, {
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    });
  }

  if (route === 'GET /api/health') {
    return sendJSON(res, 200, {
      ok: true,
      service: 'voicetwin',
      day: 2,
      wsUrl: CONFIG.AAI.WS_URL,
      sampleRate: CONFIG.AAI.SAMPLE_RATE,
      voice: CONFIG.AAI.VOICE,
      limits: CONFIG.LIMITS,
      gate: CONFIG.GATE,
      keyConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY),
    });
  }

  if (route === 'GET /api/voice-token') {
    try {
      const { user } = await requireUser(req);
      if (limited(`vt:${user.id}`, 10, 60_000)) {
        return sendJSON(res, 429, { error: 'rate_limited', message: 'Too many voice requests. Wait a minute and try again.' });
      }
      const { token, expiresIn, maxSessionSeconds } = await mintToken();
      usage.tokensMinted++;
      logUsage({ event: 'token_minted', expiresIn, maxSessionSeconds, userId: user.id });
      return sendJSON(res, 200, { token, expiresIn, maxSessionSeconds });
    } catch (err) {
      if (err && (err.status === 401 || err.status === 429)) return sendErr(res, err);
      console.error('[voicetwin] token error:', err.message);
      return sendJSON(res, 503, { error: 'voice_unavailable', message: 'Voice service temporarily unavailable. Please try again.' });
    }
  }

  if (route === 'GET /api/usage') {
    return sendJSON(res, 200, { ...usage, activeInterviews: sessionCount(), note: 'Free tier discipline: short sessions, explicit session.end, no idle seconds billed.' });
  }

  // ---- Day 2: interview engine ----
  if (route === 'POST /api/interview/start') {
    try {
      const { user, token } = await requireUser(req);
      if (limited(`start:${user.id}`, 5, 60_000)) {
        return sendJSON(res, 429, { error: 'rate_limited', message: 'Too many interviews started. Wait a minute and try again.' });
      }
      const body = await readBody(req);
      const projectDescription = String(body.projectDescription || '');
      if (!projectDescription.trim() || projectDescription.length > 4000) {
        return sendJSON(res, 400, { error: 'invalid_project', message: 'Project description must be 1–4000 characters.' });
      }
      const mode = VALID_MODES.has(body.mode) ? body.mode : 'medium';
      if (activeCountFor(user.id) >= 2) {
        return sendJSON(res, 429, { error: 'too_many_active', message: 'Finish your current interview before starting another.' });
      }
      // One browser tab = one live session id from the token flow; we key on a
      // client-generated interview id so refreshes don't strand old sessions.
      const ivId = body.interviewId || `iv_${Date.now()}`;
      // ONE project analysis per interview (LLM if configured, else
      // deterministic). Never blocks longer than its internal timeout.
      const descForBrief = String(body.projectDescription || '');
      let brief = null;
      try {
        brief = await buildProjectBrief(descForBrief, extractProjectContext(descForBrief));
      } catch { brief = null; }
      const iv = createInterview(ivId, {
        role: 'Software Engineer',
        mode,
        projectDescription: projectDescription || null, // Screen 1 → dynamic probes
        focusWeaknesses: Array.isArray(body.focusWeaknesses) ? body.focusWeaknesses : [], // Practice Again
        projectBrief: brief,
      });
      iv.ownerId = user.id; // ownership lives here, never in client fields
      // Idempotent open-row: a retry after a dropped response reuses the id.
      try {
        await saveInterview(token, {
          id: ivId, user_id: user.id, project_description: projectDescription,
          difficulty: iv.modeName || mode,
        });
      } catch (e) {
        if (e?.status !== 409) throw e; // 409 = already saved, continue
      }
      const firstQuestion = iv.nextQuestion();
      if (!firstQuestion) return sendJSON(res, 500, { error: 'no_questions' });
      logUsage({ event: 'interview_started', interviewId: ivId, mode: iv.mode, dynamic: Boolean(iv.dynamic) });
      return sendJSON(res, 201, {
        interviewId: ivId,
        question: firstQuestion,
        snapshot: iv.snapshot(),
        systemPrompt: buildSystemPrompt({
          questionText: firstQuestion.text,
          pressureLevel: iv.state.pressure_level,
          answerCount: 0,
          mode: iv.mode,
          rubric: iv.state.question_rubric, // Day 4: evidence list travels with the prompt
          project: iv.dynamic ? { description: iv.projectDescription, tech: iv.project.tech } : null,
          briefText: renderBriefForPrompt(brief),
        }),
        tools: buildTools(),
      });
    } catch (err) {
      if (err && (err.status === 401 || err.status === 429 || err.status === 503)) return sendErr(res, err);
      return sendJSON(res, 400, { error: 'interview_start_failed', message: err.message });
    }
  }

  if (route === 'GET /api/interview/state') {
    try {
      const { user } = await requireUser(req);
      const iv = getInterview(url.searchParams.get('id') || '');
      checkOwnsInterview(iv, user.id);
      return sendJSON(res, 200, { snapshot: iv.snapshot() });
    } catch (err) { return sendErr(res, err); }
  }

  if (route === 'POST /api/interview/answer') {
    let user;
    try {
      ({ user } = await requireUser(req));
      if (limited(`ans:${user.id}`, 120, 60_000)) {
        return sendJSON(res, 429, { error: 'rate_limited', message: 'Slow down a little.' });
      }
    } catch (err) { return sendErr(res, err); }
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    try { checkOwnsInterview(iv, user.id); } catch (err) { return sendErr(res, err); }
    iv.appendAnswer(body.answerText || '');

    let evaluation, guidance;
    if (iv.evaluateAnswer) {
      // Day 3 adaptive evaluation
      evaluation = iv.evaluateAnswer(body.answerText || '');
      guidance = evaluation.followUp
        ?? (evaluation.moveOnRecommended
          ? 'Thank the candidate briefly and call next_question now.'
          : iv.pressurePhrase());
      logUsage({ event: 'interview_answer', interviewId: body.interviewId, pressure: evaluation.pressure.level, specificity: evaluation.analysis.specificity });
    } else {
      const pressure = iv.evaluatePressure(body.answerText || '');
      evaluation = { pressure, analysis: null, followUp: null, moveOnRecommended: false };
      guidance = iv.pressurePhrase();
      logUsage({ event: 'interview_answer', interviewId: body.interviewId, pressure: pressure.level });
    }
    iv.advanceAfterAnswer();
    return sendJSON(res, 200, {
      snapshot: iv.snapshot(),
      pressure: evaluation.pressure,
      analysis: evaluation.analysis ? {
        specificity: evaluation.analysis.specificity,
        strong: evaluation.analysis.strong,
        weaknesses: evaluation.analysis.weaknesses,
        category: evaluation.analysis.category,
        signals: evaluation.analysis.signals,
      } : null,
      rubric: evaluation.rubric ?? null, // Day 4: per-point evidence results
      followUp: evaluation.followUp,
      followUpKind: evaluation.followUpKind ?? null,
      moveOnRecommended: evaluation.moveOnRecommended,
      followUpBudget: evaluation.followUpBudget ?? null,
      guidance,
    });
  }

  if (route === 'POST /api/interview/next') {
    let user;
    try {
      ({ user } = await requireUser(req));
    } catch (err) { return sendErr(res, err); }
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    try { checkOwnsInterview(iv, user.id); } catch (err) { return sendErr(res, err); }
    if (iv.state.answer_count === 0) return sendJSON(res, 400, { error: 'no_answers_yet' });
    iv.recordQuestionResult(); // Day 4: freeze the rubric score before moving on
    iv.state.answer_count = 0; // fresh answer window for the new question
    const q = iv.nextQuestion();
    if (!q) return sendJSON(res, 200, { finished: true, snapshot: iv.snapshot() });
    return sendJSON(res, 200, {
      finished: false,
      question: q,
      snapshot: iv.snapshot(),
      systemPrompt: buildSystemPrompt({
        questionText: q.text,
        pressureLevel: iv.state.pressure_level,
        answerCount: 0,
        mode: iv.mode,
        rubric: iv.state.question_rubric, // Day 4: evidence list travels with the prompt
      }),
    });
  }

  if (route === 'POST /api/interview/end') {
    let user, token;
    try {
      ({ user, token } = await requireUser(req));
    } catch (err) { return sendErr(res, err); }
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    let report = null;
    if (iv) {
      try { checkOwnsInterview(iv, user.id); } catch (err) { return sendErr(res, err); }
      report = iv.report(); // Day 4: evidence-based report (also closes open question)
      logUsage({ event: 'interview_report', interviewId: body.interviewId, evidenceScore: report.evidenceScore, questionsAsked: report.questionsAsked, userId: user.id });
      // Persist to the owner's history. Best-effort: a DB outage must not
      // eat an in-memory report the UI already needs.
      try {
        const desc = iv.projectDescription || '';
        await completeInterview(token, body.interviewId, mapReportToRow(
          user.id, body.interviewId,
          { projectDescription: desc, difficulty: iv.modeName || iv.mode, report },
        ));
        await saveAnswers(token, (report.perQuestion || []).map((q) => ({
          interview_id: body.interviewId,
          user_id: user.id,
          question: q.question || q.id,
          answer: String(q.answer || '').slice(0, 8000),
          specificity: null, // per-answer specificity isn't retained server-side
          evidence_earned: q.pointsEarned ?? null,
          evidence_total: q.pointsTotal ?? null,
        })));
      } catch (e) {
        console.error('[voicetwin] history save failed:', e.message);
      }
    }
    endInterview(body.interviewId || '');
    return sendJSON(res, 200, { ended: true, report });
  }

  // ---- owned history (minimal list + owned detail) ----
  if (route === 'GET /api/me/interviews') {
    try {
      const { user, token } = await requireUser(req);
      return sendJSON(res, 200, { interviews: await listInterviews(token, user.id) });
    } catch (err) { return sendErr(res, err); }
  }

  if (url.pathname.startsWith('/api/me/interviews/') && req.method === 'GET') {
    try {
      const { user, token } = await requireUser(req);
      const id = decodeURIComponent(url.pathname.slice('/api/me/interviews/'.length));
      return sendJSON(res, 200, await getSavedInterview(token, user.id, id));
    } catch (err) { return sendErr(res, err); }
  }

  // ---- Day 5: coaching loop (weakness → practice → before/after) ----
  if (route === 'POST /api/practice/start') {
    try {
      await requireUser(req);
      const body = await readBody(req);
      const prId = body.practiceId || `pr_${Date.now()}`;
      const p = createPractice(prId, {
        role: body.role || 'Software Engineer',
        questionId: body.questionId,
        missed: Array.isArray(body.missed) ? body.missed : [],
        interviewReport: body.interviewReport || null, // Day 4 report's weakest feeds BEFORE
      });
      logUsage({ event: 'practice_started', practiceId: prId, questionId: p.questionId, beforeEarned: p.before.pointsEarned });
      return sendJSON(res, 201, {
        practiceId: prId,
        question: p.state.question,
        before: p.before,
        snapshot: p.snapshot(),
        systemPrompt: buildPracticePrompt({ questionText: p.questionText, before: p.before }),
        tools: buildPracticeTools(),
      });
    } catch (err) {
      if (err && (err.status === 401 || err.status === 503)) return sendErr(res, err);
      return sendJSON(res, 400, { error: 'practice_start_failed', message: err.message });
    }
  }

  if (route === 'POST /api/practice/answer') {
    try { await requireUser(req); } catch (err) { return sendErr(res, err); }
    const body = await readBody(req);
    const p = getPractice(body.practiceId || '');
    if (!p) return sendJSON(res, 404, { error: 'no_such_practice' });
    const evaluation = p.evaluateAttempt(body.answerText || '');
    logUsage({ event: 'practice_attempt', practiceId: body.practiceId, attempts: evaluation.attempts, delta: evaluation.delta, done: evaluation.done });
    return sendJSON(res, 200, {
      snapshot: p.snapshot(),
      rubric: evaluation.rubric ?? null,
      analysis: evaluation.analysis ? {
        specificity: evaluation.analysis.specificity,
        strong: evaluation.analysis.strong,
        weaknesses: evaluation.analysis.weaknesses,
      } : null,
      delta: evaluation.delta,
      attempts: evaluation.attempts,
      attemptsRemaining: evaluation.attemptsRemaining,
      done: evaluation.done,
      coaching: evaluation.coaching,
    });
  }

  if (route === 'POST /api/practice/end') {
    try { await requireUser(req); } catch (err) { return sendErr(res, err); }
    const body = await readBody(req);
    const p = getPractice(body.practiceId || '');
    const result = p
      ? p.result()
      : null;
    if (p) logUsage({ event: 'practice_result', practiceId: body.practiceId, delta: result.delta, before: result.before.evidencePct, after: result.after.evidencePct });
    endPractice(body.practiceId || '');
    return sendJSON(res, 200, { ended: true, result });
  }

  if (route === 'POST /api/sessions') {
    const body = await readBody(req);
    usage.sessionsStarted++;
    usage.lastSessionAt = new Date().toISOString();
    logUsage({ event: 'session_update', sessionId: body.sessionId ?? null, phase: body.phase ?? 'unknown', durationSeconds: body.durationSeconds ?? null });
    return sendJSON(res, 200, { ok: true });
  }

  if (route === 'POST /api/latency') {
    try {
      const sample = await readBody(req);
      const saved = latencyStore.add(sample);
      logUsage({ event: 'latency_sample', test: saved.test, t3MinusT0: saved.t3MinusT0Ms });
      return sendJSON(res, 201, saved);
    } catch (err) {
      return sendJSON(res, 400, { error: 'invalid_sample', message: err.message });
    }
  }

  if (route === 'GET /api/latency') {
    return sendJSON(res, 200, { samples: latencyStore.all() });
  }

  if (route === 'GET /api/questions') {
    // Static catalog for client pickers — zero cost, no session needed.
    const catalog = JSON.parse(readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));
    return sendJSON(res, 200, {
      role: catalog.role,
      questions: catalog.questions.map((q) => ({ id: q.id, question: q.question })),
    });
  }

  if (route === 'GET /api/latency/summary') {
    return sendJSON(res, 200, latencyStore.summarize(CONFIG.GATE));
  }

  return sendJSON(res, 404, { error: 'not_found', route });
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      // Day 7 (Test J): client errors (bad JSON, oversized body) must be 4xx,
      // not a scary 500 — a judge poking the API should never see 'internal'.
      const clientFault = err.message === 'invalid JSON body' || err.message === 'body too large';
      if (clientFault) {
        sendJSON(res, 400, { error: 'bad_request', message: err.message });
      } else {
        console.error('[voicetwin] api error:', err);
        if (!res.headersSent) sendJSON(res, 500, { error: 'internal', message: err.message });
      }
    }
    return;
  }

  // Static
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(file).replace(/^(\.\.[/\\])+/, '');

  // /config.js is shared between the server and the browser (no secrets in it).
  // The root file is served explicitly because PUBLIC_DIR is the docroot.
  // NOTE: path.normalize flips slashes to backslashes on win32, so compare
  // against a forward-slash form of the safe path.
  const normPath = safePath.split('\\').join('/');
  const isSharedConfig = normPath === '/config.js';
  const abs = isSharedConfig
    ? path.join(ROOT, 'config.js')
    : path.join(PUBLIC_DIR, safePath);

  if (!isSharedConfig && (!abs.startsWith(PUBLIC_DIR) || !existsSync(abs) || !abs.includes('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  if (!existsSync(abs)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  try {
    const data = readFileSync(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(500); res.end('read error');
  }
}

// Day 7 (Test I): sweep ghost sessions (browser refresh never calls /end).
setInterval(() => {
  const swept = sweepSessions() + sweepPracticeSessions();
  if (swept > 0) console.log(`[voicetwin] swept ${swept} idle session(s)`);
}, 5 * 60_000).unref();

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(CONFIG.PORT, () => {
    console.log(`[voicetwin] Day 1 server on http://localhost:${CONFIG.PORT}`);
    console.log(`[voicetwin] WS: ${CONFIG.AAI.WS_URL} | voice: ${CONFIG.AAI.VOICE} | ${CONFIG.AAI.SAMPLE_RATE} Hz PCM16`);
    console.log(`[voicetwin] Caps: max session ${CONFIG.LIMITS.MAX_SESSION_SECONDS}s | client cap ${CONFIG.LIMITS.CLIENT_MAX_SECONDS}s | token TTL ${CONFIG.LIMITS.TOKEN_EXPIRES_SECONDS}s`);
  });

  // Graceful shutdown for the local Node server.
  function shutdown() {
    console.log('\n[voicetwin] shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
