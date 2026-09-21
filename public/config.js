// VoiceTwin — Day 1 configuration. Single source of truth.
// Shared by the Node server AND the browser (served at /config.js), so it must
// be environment-isomorphic: process.env exists only in Node. No secrets here.
const hasProcess = typeof process !== 'undefined' && typeof process.env !== 'undefined';
const env = hasProcess ? process.env : {}; // browser: defaults only; server injects real limits via /api/health

export const CONFIG = {
  PORT: env.PORT ? Number(env.PORT) : 3000,

  AAI: {
    WS_URL: 'wss://agents.assemblyai.com/v1/ws',
    TOKEN_URL: 'https://agents.assemblyai.com/v1/token',
    VOICE: 'anna',
    SAMPLE_RATE: 24000,
  },

  // Credit discipline: free tier, no card. Every second of session is billed.
  LIMITS: {
    MAX_SESSION_SECONDS: clampInt(env.MAX_SESSION_SECONDS, 60, 10800, 180),
    TOKEN_EXPIRES_SECONDS: clampInt(env.TOKEN_EXPIRES_SECONDS, 1, 600, 300),
    // Hard client-side cap: force end at this wall-clock time.
    CLIENT_MAX_SECONDS: 180,
  },

  // Day 1 decision gate: primary metric is T3 - T0 (median of >=5 runs).
  GATE: {
    GREEN_MAX_MS: 1500, // continue full adaptive architecture
    YELLOW_MAX_MS: 2500, // optimize prompts/model/output length
    // above YELLOW -> RED: change the architecture
    MIN_RUNS: 5,
  },

  // Test protocol labels (Day 1 Hour 1.5-2.5)
  TESTS: ['normal', 'short', 'long', 'silence', 'interruption', 'vocab', 'noise', 'wifi'],
};

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
