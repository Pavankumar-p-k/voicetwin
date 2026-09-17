// safe-data.js — the pre-recorded "successful conversation" for Demo Safe Mode.
// Day 7: full realistic session, written to mirror EXACTLY what the live engine
// produces — the demand lines are the real ones from rubric-scorer.js, the
// specificity arc matches answer-analysis.js, and the pauses match measured
// T3-T0 latencies. If a judge sees this replay, it IS the demo.
//
// Replace with a captured session whenever you get a better live one; keep the shape:
//   { role: 'agent'|'user', text, pauseMsBefore }

export const DEMO_SESSION = {
  title: 'Adaptive interview — Software Engineer (recorded, Q1+Q2)',
  turns: [
    { role: 'agent', text: 'Let\u2019s begin. Tell me about a difficult technical project.', pauseMsBefore: 800 },

    { role: 'user', text: 'I built a React application.', pauseMsBefore: 300 },

    { role: 'agent', text: 'Set the scene for me \u2014 what was the project, and when and with whom did you build it?', pauseMsBefore: 1000 },

    { role: 'user', text: 'It was for my college fest, last year.', pauseMsBefore: 280 },

    { role: 'agent', text: 'And what part of that did you personally build?', pauseMsBefore: 950 },

    { role: 'user', text: 'I built the live seat-map myself. It showed seat availability in real time during booking.', pauseMsBefore: 350 },

    { role: 'agent', text: 'Walk me through one technical decision you made \u2014 and what you traded away.', pauseMsBefore: 1000 },

    { role: 'user', text: 'I chose websockets instead of polling because polling was too slow \u2014 at the cost of some complexity. Latency dropped from two seconds to about two hundred milliseconds with two hundred concurrent viewers.', pauseMsBefore: 400 },

    { role: 'agent', text: 'Good. That covered it. Next: tell me about a performance problem you solved.', pauseMsBefore: 1100 },

    { role: 'user', text: 'The seat board would freeze during peak booking.', pauseMsBefore: 250 },

    { role: 'agent', text: 'How did you measure the problem before you touched anything?', pauseMsBefore: 950 },

    { role: 'user', text: 'I profiled the render loop and added timing around the update handler. The freeze happened because every seat re-rendered on every message.', pauseMsBefore: 380 },

    { role: 'agent', text: 'What was the root cause, specifically?', pauseMsBefore: 900 },

    { role: 'user', text: 'The update handler was re-rendering all seats instead of the changed one. I fixed it by memoizing seat components and batching updates, and p95 went from two seconds to two hundred milliseconds.', pauseMsBefore: 420 },

    { role: 'agent', text: 'Clear bottleneck, measurement, root cause, fix, and a number. That\u2019s how to answer. Let\u2019s end here \u2014 thanks for the conversation.', pauseMsBefore: 1200 },
  ],
};
