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

import http from 'node:http';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import { mintToken } from './token.js';
import { latencyStore } from './latency-store.js';
import { getInterview, createInterview, endInterview, sessionCount } from './interview-engine.js';
import { getPractice, createPractice, endPractice, practiceCount } from './practice-engine.js';
import { buildSystemPrompt, buildTools, buildPracticePrompt, buildPracticeTools } from './instructions.js';
// Day 3: answer analysis is used inside interview-engine.evaluateAnswer()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');

// ---- env ----
if (process.env.NODE_ENV !== 'test' && !process.env.ASSEMBLYAI_API_KEY) {
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
if (!process.env.ASSEMBLYAI_API_KEY) {
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

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

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
      const { token, expiresIn, maxSessionSeconds } = await mintToken();
      usage.tokensMinted++;
      logUsage({ event: 'token_minted', expiresIn, maxSessionSeconds });
      return sendJSON(res, 200, { token, expiresIn, maxSessionSeconds });
    } catch (err) {
      console.error('[voicetwin] token error:', err.message);
      return sendJSON(res, 502, { error: 'token_mint_failed', message: err.message });
    }
  }

  if (route === 'GET /api/usage') {
    return sendJSON(res, 200, { ...usage, activeInterviews: sessionCount(), note: 'Free tier discipline: short sessions, explicit session.end, no idle seconds billed.' });
  }

  // ---- Day 2: interview engine ----
  if (route === 'POST /api/interview/start') {
    try {
      const body = await readBody(req);
      // One browser tab = one live session id from the token flow; we key on a
      // client-generated interview id so refreshes don't strand old sessions.
      const ivId = body.interviewId || `iv_${Date.now()}`;
      const iv = createInterview(ivId, { role: body.role || 'Software Engineer', mode: body.mode || 'normal' });
      const firstQuestion = iv.nextQuestion();
      if (!firstQuestion) return sendJSON(res, 500, { error: 'no_questions' });
      logUsage({ event: 'interview_started', interviewId: ivId, mode: iv.mode });
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
        }),
        tools: buildTools(),
      });
    } catch (err) {
      return sendJSON(res, 400, { error: 'interview_start_failed', message: err.message });
    }
  }

  if (route === 'GET /api/interview/state') {
    const iv = getInterview(url.searchParams.get('id') || '');
    if (!iv) return sendJSON(res, 404, { error: 'no_such_interview' });
    return sendJSON(res, 200, { snapshot: iv.snapshot() });
  }

  if (route === 'POST /api/interview/answer') {
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    if (!iv) return sendJSON(res, 404, { error: 'no_such_interview' });
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
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    if (!iv) return sendJSON(res, 404, { error: 'no_such_interview' });
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
    const body = await readBody(req);
    const iv = getInterview(body.interviewId || '');
    let report = null;
    if (iv) {
      report = iv.report(); // Day 4: evidence-based report (also closes open question)
      logUsage({ event: 'interview_report', interviewId: body.interviewId, evidenceScore: report.evidenceScore, questionsAsked: report.questionsAsked });
    }
    endInterview(body.interviewId || '');
    return sendJSON(res, 200, { ended: true, report });
  }

  // ---- Day 5: coaching loop (weakness → practice → before/after) ----
  if (route === 'POST /api/practice/start') {
    try {
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
      return sendJSON(res, 400, { error: 'practice_start_failed', message: err.message });
    }
  }

  if (route === 'POST /api/practice/answer') {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error('[voicetwin] api error:', err);
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal', message: err.message });
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
});

server.listen(CONFIG.PORT, () => {
  console.log(`[voicetwin] Day 1 server on http://localhost:${CONFIG.PORT}`);
  console.log(`[voicetwin] WS: ${CONFIG.AAI.WS_URL} | voice: ${CONFIG.AAI.VOICE} | ${CONFIG.AAI.SAMPLE_RATE} Hz PCM16`);
  console.log(`[voicetwin] Caps: max session ${CONFIG.LIMITS.MAX_SESSION_SECONDS}s | client cap ${CONFIG.LIMITS.CLIENT_MAX_SECONDS}s | token TTL ${CONFIG.LIMITS.TOKEN_EXPIRES_SECONDS}s`);
});

// Graceful shutdown: stop accepting, close keep-alives. Client is responsible
// for session.end; server holds no voice sockets (browser talks directly to AAI).
function shutdown() {
  console.log('\n[voicetwin] shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
