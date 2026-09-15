// safe-data.js — the pre-recorded "successful conversation" for Demo Safe Mode.
// Day 1: a realistic scripted exchange (shaped like a real Day 2 interview turn).
// After real Day 1 testing, replace this with an actual captured session
// (transcript + optional recorded audio segments). Keep the shape identical:
//   { role: 'agent'|'user', text, pauseMsBefore }
// pauseMsBefore approximates the real latency you measured, so the replay
// *feels* like the live system, including its timing.

export const DEMO_SESSION = {
  title: 'Adaptive interview — Software Engineer (recorded)',
  turns: [
    { role: 'agent', text: 'Hey, thanks for jumping in. Let\u2019s start easy: tell me about a difficult technical project you worked on.', pauseMsBefore: 700 },
    { role: 'user',  text: 'Sure. I built a React application for our college fest that handled registrations and live seat availability.', pauseMsBefore: 300 },
    { role: 'agent', text: 'What made you choose React for that project?', pauseMsBefore: 900 },
    { role: 'user',  text: 'It was easy to use, and I already knew some JavaScript from class.', pauseMsBefore: 250 },
    { role: 'agent', text: 'That\u2019s a broad answer. What specific technical advantage did React give you in this project?', pauseMsBefore: 1000 },
    { role: 'user',  text: 'The component model. I reused one seat-map component across three pages, and virtual DOM updates kept the live seat board fast with about two hundred concurrent viewers.', pauseMsBefore: 350 },
    { role: 'agent', text: 'Better. Now — walk me through the hardest bug you hit while building it.', pauseMsBefore: 900 },
  ],
};
