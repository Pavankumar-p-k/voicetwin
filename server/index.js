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
      day: 1,
      service: 'voicetwin',
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
    return sendJSON(res, 200, { ...usage, note: 'Free tier discipline: short sessions, explicit session.end, no idle seconds billed.' });
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
  const abs = path.join(PUBLIC_DIR, safePath);
  if (!abs.startsWith(PUBLIC_DIR) || !existsSync(abs) || !abs.includes('.')) {
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
