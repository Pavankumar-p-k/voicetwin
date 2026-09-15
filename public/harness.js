// harness.js — VoiceTwin Day 1 (Page 3 shared core).
// The 8-scenario Day 1 protocol. Each scenario maps to what the human tester
// does, and what counts as a valid sample. The harness page (Page 3) records
// per-run T0..T3 from voice-client's EVT bus and posts to /api/latency.

export const TESTS = [
  { label: 'normal', what: 'normal answer ×5' },
  { label: 'short', what: 'short answer' },
  { label: 'long', what: 'long answer' },
  { label: 'silence', what: 'say nothing' },
  { label: 'interruption', what: 'user interrupts AI' },
  { label: 'vocab', what: 'technical vocabulary' },
  { label: 'noise', what: 'noisy room' },
  { label: 'wifi', what: 'bad Wi-Fi (throttle)' },
];

const LABELS = new Set(TESTS.map((t) => t.label));

export function rotateTest(current) {
  const keys = TESTS.map((t) => t.label);
  const i = keys.indexOf(current);
  return keys[(i + 1) % keys.length];
}

// Attach rotation helper onto voice-client's harnessState via app wiring.
// (kept functional & side-effect free for easy unit checks)
