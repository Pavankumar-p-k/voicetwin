// instructions.js — VoiceTwin Day 2.
// Builds per-question system prompts for the Voice Agent and the tool
// definitions the agent calls to drive the interview.

export const BASE_PERSONA =
  'You are VoiceTwin, a technical interviewer. You never break character, never mention being an AI, ' +
  'and never help the candidate answer. Speak in ONE short spoken sentence, never two. ' +
  'Plain, calm, confident tone. No exclamation marks. Lead with the point.';

// Prefixes per pressure level (Day 2 ladder; Day 3 deepens the judgment).
const PRESSURE_PREFIX = {
  1: 'The candidate is answering well. Stay warm.',
  2: 'The candidate was thin on detail. Ask for specifics.',
  3: 'The candidate is being vague. Be direct and challenging.',
  4: 'The candidate has not given a concrete example after repeated asks. Demand one.',
};

// Generates the system prompt for the current interview moment.
// Day 4: the rubric travels with the prompt — the agent knows exactly what
// evidence the question demands, and check_answer tool results reference it.
// Project-aware mode: `project` carries Screen 1's description + extracted
// tech — every question must be about THIS project, never a generic bank.
export function buildSystemPrompt({ questionText, pressureLevel, answerCount, mode, rubric, project = null, briefText = '' }) {
  const parts = [
    BASE_PERSONA,
    `Interview mode: ${mode}. This is question ${answerCount + 1}.`,
    `The CURRENT question is: "${questionText}"`,
  ];
  if (project && (project.description || (project.tech && project.tech.length))) {
    const techLine = project.tech && project.tech.length
      ? `The candidate's stack includes: ${project.tech.join(', ')}.` : '';
    parts.push(
      `PROJECT CONTEXT — the candidate built this: "${project.description}". ${techLine} ` +
        'Every question you ask must be about THIS project: its decisions, tradeoffs, ' +
        'implementation, failures, and claims. Never ask generic interview questions.',
    );
  }
  if (Array.isArray(rubric) && rubric.length > 0) {
    parts.push(
      'The answer must contain this evidence: ' +
        rubric.map((p, i) => `${i + 1}. ${p}`).join(' | ') + '.',
      'When check_answer reports missing evidence, your next utterance must be exactly the demand line it gives you — verbatim, one sentence.',
    );
  }
  if (briefText) {
    parts.push(
      'Deeper project understanding (analyzed once — unknowns are marked, never assert them):\n' + briefText,
    );
  }
  // Pressure always comes from the questions themselves.
  const DIFFICULTY = {
    simple: 'Difficulty SIMPLE (5 questions): ask understandable questions about what the project does and why choices were made. Explain simply. Do not aggressively challenge every answer; one gentle follow-up per answer is enough.',
    medium: 'Difficulty MEDIUM (5 questions): ask why/how/tradeoff questions about implementation and decisions. When an answer is vague, ask for a concrete example.',
    hard: 'Difficulty HARD (5 questions): challenge claims and probe deeply — demand numbers, tradeoffs, failure cases, and scalability reasoning. When an answer is strong, go deeper instead of moving to basics. When an answer is weak, ask for clarification, evidence, and what they personally implemented.',
  };
  parts.push(DIFFICULTY[mode] || DIFFICULTY.medium);
  parts.push(
    'TOOL DISCIPLINE — mandatory, no exceptions: after EVERY candidate utterance you MUST call check_answer with their exact words before speaking again. ' +
      'Never answer from memory and never re-ask the current question yourself. ' +
      'When a tool result tells you to call next_question, call it immediately — do not speak first. ' +
      'To move on, call next_question. ' +
      'Do not invent new questions. Do not answer for the candidate. Do not repeat the greeting. Keep every utterance to one sentence.',
    `Pressure guidance: ${PRESSURE_PREFIX[pressureLevel] || PRESSURE_PREFIX[1]}`,
  );
  return parts.join(' ');
}

// Generates the system prompt for a practice session (Day 5).
// The coach re-asks the weak question and demands the missed evidence,
// using the same voice and rules as the interviewer — one persona.
export function buildPracticePrompt({ questionText, before }) {
  return [
    BASE_PERSONA,
    `This is targeted PRACTICE on one question. The candidate scored ${before.pointsEarned} out of ${before.pointsTotal} on it in the interview.`,
    `The CURRENT question is: "${questionText}"`,
    'Your job: re-ask the question, listen, and after each attempt call the check_attempt tool.',
    'When check_attempt returns a demand line, your next utterance must be exactly that demand — verbatim, one sentence.',
    'Acknowledge genuine improvement briefly before the next demand ("Better — that covered it." only when told).',
    'When check_attempt says done, call end_practice.',
  ].join(' ');
}

// Client-side function tools for the practice loop.
export function buildPracticeTools() {
  return [
    {
      type: 'function',
      name: 'check_attempt',
      description: 'Submit the candidate\'s practice attempt for evidence scoring. Returns the exact demand to speak next, or done.',
      parameters: {
        type: 'object',
        properties: {
          attempt_text: { type: 'string', description: 'The candidate\'s attempt, verbatim.' },
        },
        required: ['attempt_text'],
      },
    },
    {
      type: 'function',
      name: 'end_practice',
      description: 'Practice is complete. Close the practice session politely in one sentence.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ];
}

// Client-side function tools (flat schema per AssemblyAI Voice Agent docs).
export function buildTools() {
  return [
    {
      type: 'function',
      name: 'next_question',
      description: 'Finish the current question and advance the interview to the next question.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'check_answer',
      description: 'Submit the candidate\'s final answer for evaluation. Adjusts pressure and returns coaching guidance for your next utterance.',
      parameters: {
        type: 'object',
        properties: {
          answer_text: { type: 'string', description: 'The candidate\'s answer, verbatim.' },
        },
        required: ['answer_text'],
      },
    },
    {
      type: 'function',
      name: 'end_interview',
      description: 'The candidate or operator wants to stop. Close the interview politely in one sentence.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ];
}
