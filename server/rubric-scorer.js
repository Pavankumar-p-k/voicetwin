// rubric-scorer.js — VoiceTwin Day 4: EVIDENCE-BASED SCORING.
// Scores an answer against the CURRENT question's predefined 5-point rubric
// (data/questions.json — written on Day 1 evening, zero API cost).
// Fully deterministic: regex detectors over the transcript. No LLM, no credits,
// and every point is traceable to a signal the candidate actually said.
//
//   "We're not asking an LLM whether the answer sounds impressive. We're
//    checking whether the answer contains the evidence required by the question."
//
// Check shape: { point, short, demand, all: [regexSources...] }
//   point  — exact rubric wording (defensible in front of a judge)
//   short  — 1–3 word chip label for the UI
//   demand — the exact sentence the agent speaks when this evidence is missing
//   all    — EVERY regex must match against the lowercased answer text

const RUBRIC_CHECKS = {
  Q1: [ // Tell me about a difficult technical project.
    {
      point: 'Names the project with real context (where/when/with whom)',
      short: 'context',
      demand: 'Set the scene for me — what was the project, and when and with whom did you build it?',
      all: [
        '\\b(project|app|application|system|platform|website|service|tool|dashboard|editor|feature|pipeline|integration|component|library)\\b',
        '\\b\\d+\\b|last (year|month|week|summer)|two years|three years|at (my|the|our)|during (my|the)|with (a|my|the|our) team|in (college|university|school)|internship|startup|company|client',
      ],
    },
    {
      point: 'States what made it technically difficult',
      short: 'difficulty',
      demand: 'What actually made that project technically hard?',
      all: ['hard|difficult|challeng|complex|tricky|tough|struggl|the (main|biggest|hardest) (problem|challenge|part)|not trivial'],
    },
    {
      point: 'Identifies their own specific contribution',
      short: 'my part',
      demand: 'And what part of that did you personally build?',
      all: [
        '\\b(i|my|me)\\b',
        '\\b(built|designed|wrote|implemented|created|developed|migrated|architected|led|owned|coded|refactored|optimized|debugged|delivered)\\b',
      ],
    },
    {
      point: 'Explains a concrete technical decision and its tradeoff',
      short: 'decision + tradeoff',
      demand: 'Walk me through one technical decision you made — and what you traded away.',
      all: [
        '(chose|chosen|decided|picked|went with|opted|selected|used)',
        'because|instead of|rather than|trade.?off|compared to|at the cost|downside|cheaper|simpler|faster than',
      ],
    },
    {
      point: 'Gives a measurable outcome (metric, users, time saved)',
      short: 'measurable outcome',
      demand: 'Give me a number — what measurable outcome did that project produce?',
      all: [
        '\\b\\d+(\\.\\d+)?\\s*(%|percent|ms|seconds?|secs?|minutes?|hours?|days?|users?|customers?|requests?|rps|qps|gb|mb|kb|x\\b)|\\b\\d+[km]\\b|reduced|dropped|cut by|improved by|saved|increased by|grew (to|by)|from \\d+ to \\d+',
      ],
    },
  ],

  Q2: [ // Tell me about a performance problem you solved.
    {
      point: 'Identified the bottleneck',
      short: 'bottleneck',
      demand: 'Where exactly was the bottleneck?',
      all: ['bottleneck|hot path|slow(est)? (query|endpoint|function|page|part|request)|n\\+1|memory leak|\\bcpu\\b|lock|contention|inefficien|the (main |real )?(problem|culprit) was|turns? out'],
    },
    {
      point: 'Explained measurement / profiling approach',
      short: 'measurement',
      demand: 'How did you measure the problem before you touched anything?',
      all: ['profil|benchmark|measur|flame ?graph|trac(e|er|ing)|timing|latency (was|of|numbers|went)|load test|before and after|monitor(ed|ing)? the|p95|p99|dashboard'],
    },
    {
      point: 'Identified root cause',
      short: 'root cause',
      demand: 'What was the root cause, specifically?',
      all: ['root cause|turns? out|caused by|because (of|the)|due to|the (real )?(issue|cause|problem) was|the bug was'],
    },
    {
      point: 'Explained the technical solution',
      short: 'solution',
      demand: 'What technical change actually fixed it?',
      all: ['\\b(added|introduced|cached|caching|indexed|rewrote|refactored|replaced|moved|split|batch(ed|ing)?|pooled|upgraded|optimized|fixed|switched|denormalized)\\b'],
    },
    {
      point: 'Provided a measurable result',
      short: 'measurable result',
      demand: 'What was the number before, and the number after?',
      all: ['\\b\\d+(\\.\\d+)?\\s*(%|percent|ms|seconds?|secs?|x\\b|rps|qps)|\\b\\d+x\\b|from \\d+|to \\d+|reduced|dropped|cut |improved|faster by|halved|doubled'],
    },
  ],

  Q3: [ // Describe a technical disagreement.
    {
      point: 'Names the disagreement and stakes',
      short: 'stakes',
      demand: 'What exactly was the disagreement, and what was at stake?',
      all: ['disagree|argued|argument|debate|conflict|pushed back|pushback|clash|tension|did not agree|differed (on|about)'],
    },
    {
      point: 'Represents the other side fairly',
      short: 'their side',
      demand: 'Make their case for me — what was the argument on the other side?',
      all: ['(he|she|they) (thought|wanted|argued|felt|said|was|were)|their (concern|point|argument|position|side)|the (other|senior|lead|backend|frontend) (dev|developer|engineer|team|lead|manager) (thought|wanted|argued|felt|said)'],
    },
    {
      point: 'Explains their own position with reasons',
      short: 'my position',
      demand: 'What was YOUR position, and why?',
      all: ['\\bi (argued|proposed|suggested|pushed|insisted|preferred|wanted|recommended|felt)\\b|my (position|argument|concern|take|view)'],
    },
    {
      point: 'Describes how it was resolved (data, owner, experiment)',
      short: 'resolution',
      demand: 'How was it settled — what data or decision ended it?',
      all: ['resolv|we (decided|agreed|tested|ran|measured|shipped)|experiment|a.?b (test|testing)|benchmark|data (showed|settled|won)|proof of concept|prototype|escalated to|we went with'],
    },
    {
      point: 'States the outcome and a lesson',
      short: 'outcome + lesson',
      demand: 'How did it play out, and what did you learn from it?',
      all: ['lesson|learned|in the end|eventually|afterwards|after that|since then|the result was|it turned out|outcome'],
    },
  ],

  Q4: [ // Explain a system you designed.
    {
      point: 'States requirements and constraints',
      short: 'requirements',
      demand: 'What requirements and constraints was that design under?',
      all: ['requirement|constraint|needed to|had to (handle|support|deal)|support(ed|ing)? \\d+|scale to|\\d+ (users|requests|rps|qps|concurrent)|sla|uptime|latency (target|budget|of)|budget'],
    },
    {
      point: 'Describes components and responsibilities',
      short: 'components',
      demand: 'What were the main components, and what was each one responsible for?',
      all: ['(micro)?service|database|queue|cache|api gateway|worker|layer|module|storage|frontend|backend|load balancer|broker|scheduler'],
    },
    {
      point: 'Justifies a key design choice',
      short: 'justified choice',
      demand: 'Defend one design choice — why that over the alternative?',
      all: [
        '(chose|chosen|decided|picked|went with|opted|selected)',
        'because|instead of|rather than|trade.?off|compared to|at the cost|downside|simpler|cheaper|proven|battle.?tested',
      ],
    },
    {
      point: 'Addresses failure modes / data consistency',
      short: 'failure handling',
      demand: 'What fails first in that system, and how did you handle it?',
      all: ['fail|retr(y|ies)|fallback|idempoten|consisten|duplicate|timeout|goes down|crash(es|ed)?|degrade|race condition|at.?least.?once|exactly.?once|dead.?letter|back.?pressure'],
    },
    {
      point: 'Names a scaling limitation honestly',
      short: 'honest limit',
      demand: 'What is the honest scaling limit of that design?',
      all: ['limitation|would break|single point|does not scale|will not scale|bottleneck|ceiling|max(es|ed)? out|falls apart|weak point|honestly|the honest answer'],
    },
  ],

  Q5: [ // Tell me about a production failure.
    {
      point: 'Describes the failure and user impact',
      short: 'impact',
      demand: 'What broke, and how did users feel it?',
      all: ['outage|went down|went dark|crash(ed|ing)?|broke|incident|\\b500s?\\b|downtime|users (were|got|could)|customers (were|got|could)|impact(ed)?|affected|could.?n.?t (log ?in|checkout|pay|access)'],
    },
    {
      point: 'Explains detection (how it was found)',
      short: 'detection',
      demand: 'How did you find out it was happening?',
      all: ['alert|monitor|dashboard|pager|paged|noticed|reported|on.?call|logs?|logged|metric (showed|spiked|flapped)|customer (complaint|report|ticket)|error (rate|spike)'],
    },
    {
      point: 'Explains mitigation / rollback',
      short: 'mitigation',
      demand: 'What did you do in the moment to stop the bleeding?',
      all: ['rollback|rolled back|revert(ed)?|mitigat|hot.?fix|restart(ed)?|failover|scaled (down|back)|disabled|feature flag|kill switch|rate limit(ed)?|drained'],
    },
    {
      point: 'Identifies root cause',
      short: 'root cause',
      demand: 'What was the root cause?',
      all: ['root cause|turns? out|caused by|because (of|the)|due to|the bug|regression|migration|misconfig|config change|race condition|off.?by'],
    },
    {
      point: 'States the prevention change made after',
      short: 'prevention',
      demand: 'What changed afterwards so it cannot happen the same way again?',
      all: ['added (an? )?(alert|check|test|guardrail|runbook|dashboard|canary)|since then|now we|process change|checklist|\\bci\\b|staging|post.?mortem|blameless|synthetic'],
    },
  ],

  Q6: [ // How would you scale X?
    {
      point: 'Establishes current load baseline',
      short: 'baseline',
      demand: 'Give me the load you are scaling from, in numbers.',
      all: [
        '\\b\\d+\\b',
        'per (day|second|minute|hour|month)|currently|right now|today (we|it)|rps|qps|requests (a|per)|users (a|per|right)|daily active|traffic is',
      ],
    },
    {
      point: 'Identifies the first bottleneck',
      short: 'first bottleneck',
      demand: 'Which component hits its limit first?',
      all: ['bottleneck|first (to fail|thing that)|database|\\bdb\\b|cache|single (instance|node|point|writer)|memory|connection pool|would saturate|hits its limit|maxes out'],
    },
    {
      point: 'Proposes a concrete scaling technique',
      short: 'technique',
      demand: 'What concrete technique gets you past it?',
      all: ['shard|partition|replica|read replica|cach(e|ing)|cdn|queue|horizontal|scale out|index|denormaliz|batch|async|load balanc|memoiz|tiered storage'],
    },
    {
      point: 'Mentions tradeoff or cost of the approach',
      short: 'tradeoff',
      demand: 'And what does that approach cost you?',
      all: ['trade.?off|\\bcost(s|ly)?\\b|downside|expensive|consistency|complexity|cheaper but|at the cost|harder to|more moving parts|operational (burden|overhead)|eventually consistent'],
    },
    {
      point: 'Defines how they would verify the improvement',
      short: 'verification',
      demand: 'How would you verify the scaling actually worked?',
      all: ['load test|benchmark|measur|verify|p95|p99|before and after|canary|rollout|monitor|metric|define (success|done)'],
    },
  ],

  Q7: [ // Tell me about a mistake you made.
    {
      point: 'Owns a real mistake (not a humble-brag)',
      short: 'ownership',
      demand: 'Name the mistake — the one that was actually yours.',
      all: [
        '\\b(i|my)\\b',
        'mistake|my fault|i broke|i forgot|i missed|i caused|i shipped|i deleted|i messed|i dropped|i underestimated|i chose (wrong|poorly)',
      ],
    },
    {
      point: 'Explains the impact honestly',
      short: 'impact',
      demand: 'What did it cost, honestly?',
      all: ['impact|affected|broke|downtime|lost|delayed|customers|users|data (was|got)|blocked|wasted|cost (us|the|me)|embarrass'],
    },
    {
      point: 'Takes responsibility without deflection',
      short: 'responsibility',
      demand: 'Own it plainly: what should you have done differently?',
      all: ['my fault|i should have|i take (full|responsibility)|i owned|i was responsible|i failed to|i did not|i skipped|i ignored|i rushed'],
    },
    {
      point: 'Describes the fix',
      short: 'fix',
      demand: 'What fixed it?',
      all: ['fixed|patched|reverted|rolled back|restored|re.?ran|deployed (a |the )?(fix|patch)|corrected|resolved|undid|migrated (back|the data)'],
    },
    {
      point: 'States a durable workflow change',
      short: 'durable change',
      demand: 'What permanently changed in how you work because of it?',
      all: ['now i|since then|from then on|ever since|added (a|an|the)? ?(check|test|review|checklist|step|guard)|changed (my|the|our) (process|workflow|approach)|always (run|check|review|write)|double.?check|peer review|second pair of eyes|checklist'],
    },
  ],

  Q8: [ // Why should we hire you?
    {
      point: 'Makes a specific claim (not generic praise)',
      short: 'specific claim',
      demand: 'Make one specific claim about what you bring.',
      all: ['\\bi (am|can|have|build|deliver|lead|ship|write|design|solve)\\b'],
    },
    {
      point: 'Backs it with concrete evidence',
      short: 'evidence',
      demand: 'Back that claim with evidence — a number or something you shipped.',
      all: ['\\b\\d+\\b|%|percent|ms|seconds|years? (of|at)|shipped|launched|built|reduced|grew|led|delivered|\\b\\d+\\+? (years|projects|users|customers)'],
    },
    {
      point: 'Connects to the role requirements',
      short: 'role fit',
      demand: 'How does that connect to this role?',
      all: ['(this|your|the) (role|position|job|team|stack)|what you (need|are building)|match(es|ing)?|fit(s)? (this|your|the)'],
    },
    {
      point: 'Shows knowledge of the company/problem',
      short: 'company knowledge',
      demand: 'What do you know about what we are building here?',
      all: ['your (product|customers|company|team|stack|engineering|users|problem)|what you (build|do|face)|your scale|your industry'],
    },
    {
      point: 'Closes with a confident, non-hedged statement',
      short: 'confident close',
      demand: 'Close it — why you, in one confident sentence.',
      all: ['i (will|can|am ready|would|look forward)|ready to|confident|excited to|give me the chance|let.?s |let us|i am the|hire me'],
    },
  ],
};

// Compile once at module load.
const COMPILED = Object.fromEntries(
  Object.entries(RUBRIC_CHECKS).map(([qid, checks]) => [
    qid,
    checks.map((c) => ({ ...c, regs: c.all.map((src) => new RegExp(src, 'i')) })),
  ]),
);

// Score the (cumulative) answer for a question. Unknown question id -> empty.
export function scoreAnswer(questionId, rawText) {
  const checks = COMPILED[questionId];
  if (!checks) {
    return { questionId: questionId ?? null, results: [], pointsEarned: 0, pointsTotal: 0 };
  }
  const text = String(rawText || '').toLowerCase();
  const results = checks.map((c) => ({
    point: c.point,
    short: c.short,
    demand: c.demand,
    earned: c.regs.every((re) => re.test(text)),
  }));
  const pointsEarned = results.filter((r) => r.earned).length;
  return { questionId, results, pointsEarned, pointsTotal: results.length };
}
