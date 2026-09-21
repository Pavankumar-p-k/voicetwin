// Latency sample store (Day 1 harness). In-memory with JSONL persistence.
// One sample = one test run:
//   test               label (normal|short|long|silence|interruption|vocab|noise|wifi)
//   T0 user_turn_start        (ms epoch, browser clock)
//   T1 transcript_received    final transcript.user arrives
//   T2 agent_audio_start      first reply.audio chunk
//   T3 agent_audio_end        last reply.audio chunk (+ optional reply.done)
// Primary metric: T3 - T0.
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.VERCEL ? '/tmp/voicetwin-data' : path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data');

const REQUIRED = ['T0', 'T1', 'T2', 'T3'];

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

class LatencyStore {
  constructor() {
    this.samples = [];
    mkdirSync(DATA_DIR, { recursive: true });
    this.jsonl = path.join(DATA_DIR, 'latency-samples.jsonl');
    this.csv = path.join(DATA_DIR, 'latency-samples.csv');
    if (!appendFileSync) return;
    // CSV header (rewrite each run; store is session-local by design)
    writeFileSync(this.csv, 'ts,test,T0,T1,T2,T3,t1_minus_t0,t2_minus_t0,t3_minus_t0,interrupted,notes\n');
  }

  add(raw) {
    const test = String(raw.test || 'normal').toLowerCase();
    for (const k of REQUIRED) {
      const v = Number(raw[k]);
      if (!Number.isFinite(v)) throw new Error(`missing or non-numeric ${k}`);
    }
    const T0 = Number(raw.T0), T1 = Number(raw.T1), T2 = Number(raw.T2), T3 = Number(raw.T3);
    if (T3 < T2 || T2 < T0) throw new Error('timestamps out of order (need T0 <= T2 <= T3)');

    const sample = {
      ts: new Date().toISOString(),
      test,
      T0, T1, T2, T3,
      t1MinusT0Ms: T1 - T0,   // speech end -> final transcript (STT+turn detect)
      t2MinusT0Ms: T2 - T0,   // time-to-first-audio (the "feels instant" number)
      t3MinusT0Ms: T3 - T0,   // full answer heard (primary gate metric)
      interrupted: Boolean(raw.interrupted),
      notes: String(raw.notes || '').slice(0, 200),
    };
    this.samples.push(sample);

    appendFileSync(this.jsonl, JSON.stringify(sample) + '\n');
    appendFileSync(this.csv, `${sample.ts},${sample.test},${T0},${T1},${T2},${T3},${sample.t1MinusT0Ms},${sample.t2MinusT0Ms},${sample.t3MinusT0Ms},${sample.interrupted},"${sample.notes.replace(/"/g, "'")}"\n`);
    return sample;
  }

  all() {
    return this.samples;
  }

  summarize(gate) {
    const byTest = new Map();
    for (const s of this.samples) {
      if (!byTest.has(s.test)) byTest.set(s.test, []);
      byTest.get(s.test).push(s);
    }
    const rows = [...byTest.entries()].map(([test, list]) => ({
      test,
      runs: list.length,
      medianT3MinusT0Ms: median(list.filter((s) => !s.interrupted).map((s) => s.t3MinusT0Ms)),
      medianT2MinusT0Ms: median(list.filter((s) => !s.interrupted).map((s) => s.t2MinusT0Ms)),
      interruptionRate: list.filter((s) => s.interrupted).length / list.length,
    }));

    const gatePool = [];
    for (const [test, list] of byTest) {
      if (test === 'interruption' || test === 'silence') continue; // gate on answerable tests
      gatePool.push(...list.filter((s) => !s.interrupted).map((s) => s.t3MinusT0Ms));
    }
    const gateMedian = median(gatePool);
    let verdict = 'RED';
    if (gateMedian != null) {
      verdict = gateMedian <= gate.GREEN_MAX_MS ? 'GREEN' : gateMedian <= gate.YELLOW_MAX_MS ? 'YELLOW' : 'RED';
    }
    const enoughRuns = gatePool.length >= gate.MIN_RUNS;
    return {
      primaryMetric: 'T3 - T0 (ms), median',
      rows,
      gate: {
        medianT3MinusT0Ms: gateMedian,
        verdict,
        enoughRuns,
        minRunsRequired: gate.MIN_RUNS,
        greenMaxMs: gate.GREEN_MAX_MS,
        yellowMaxMs: gate.YELLOW_MAX_MS,
        message:
          verdict === 'GREEN' ? 'Continue with full adaptive architecture.'
          : verdict === 'YELLOW' ? 'Optimize prompts / model / output length.'
          : enoughRuns ? 'RED: do not continue blindly. Change the architecture.'
          : `RED (pending): need >= ${gate.MIN_RUNS} clean runs before the gate call.`,
      },
    };
  }
}

export const latencyStore = new LatencyStore();
