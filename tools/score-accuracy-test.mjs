// temp accuracy probe for the judging upgrade. Deleted after run.
import { scoreAnswer } from '../server/rubric-scorer.js';
import { analyzeAnswer } from '../server/answer-analysis.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

const good = `Last year at my startup I built a realtime seat-map service with my team of four. ` +
  `The hardest part was reconnection storms over websockets. I personally implemented the socket layer ` +
  `and chose Redis pubsub instead of polling because polling cost us 2s p95. ` +
  `That brought p95 from two seconds to two hundred milliseconds and cut server cost by forty percent.`;

const vague = `Yeah so we did like a project, it was pretty hard, stuff was complex and whatever.`;

const negated = `We never profiled anything, there were no benchmarks and no dashboards. ` +
  `I guessed the bottleneck was the database because it felt slow. We did not measure before or after.`;

const r1 = scoreAnswer('Q2', good);
eq('good earns >=4', r1.pointsEarned >= 4, true);
const r2 = scoreAnswer('Q2', vague);
eq('vague earns <=1', r2.pointsEarned <= 1, true);
const r3 = scoreAnswer('Q2', negated);
const meas = r3.results.find((r) => r.short === 'measurement');
eq('negated measurement NOT earned', meas.earned, false);

const a1 = analyzeAnswer('We cut latency by fifty percent after I rewrote the hot path in Rust.');
eq('spoken-number metric detected', a1.signals.hasMetric, true);
const a2 = analyzeAnswer('We had no metrics at all and never measured anything, it just felt slow.');
eq('denied metric not counted', a2.signals.hasMetric, false);
eq('denied metric flagged weak', a2.weaknesses.includes('no_measurable_result'), true);

console.log(`\naccuracy probe: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
