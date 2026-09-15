// interview-engine.js — VoiceTwin Day 2.
// The complete interview state lives here (server-side, session-scoped).
// Shape is exactly what the plan allows — nothing more:
//   Interview { role, question, question_rubric, pressure_level, answer_count, current_answer, weaknesses[] }
//
// Day 2 scope: question sequencing + basic pressure levels (Day 3 will add
// adaptive follow-ups driven by answer analysis; Day 4 wires rubric scoring).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS_PATH = path.join(ROOT, 'data', 'questions.json');

// Pressure ladder (Day 3 deepens this; Day 2 ships levels 1-3).
const PRESSURE = {
  1: 'friendly — "Can you tell me more?"',
  2: 'specific — "What exactly did you do?"',
  3: 'challenging — "I\'m looking for your specific contribution."',
  4: 'pressure — "You haven\'t given me a concrete example yet. Give me one."',
};

export class Interview {
  constructor({ role = 'Software Engineer', mode = 'normal' } = {}) {
    const catalog = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
    if (catalog.role !== role) {
      // Single-role catalog on Day 2; requested role must match or fail loudly.
      throw new Error(`unknown role "${role}" (catalog has "${catalog.role}")`);
    }
    this.role = role;
    this.mode = mode; // 'normal' | 'pressure' (pressure starts at level 2)
    this.questions = catalog.questions.map((q) => ({
      id: q.id,
      question: q.question,
      rubric: q.rubric,
      followUpProbe: q.follow_up_probe,
    }));
    this.queue = [...this.questions];
    this.state = {
      role,
      question: null,          // { id, text } — current question
      question_rubric: null,   // points the Day 4 scorer will check
      pressure_level: mode === 'pressure' ? 2 : 1,
      answer_count: 0,
      current_answer: '',      // latest final user transcript for this question
      weaknesses: [],          // populated from Day 4 scoring
    };
    this.questionAskedAt = null;
    this.followUpCount = 0; // follow-ups asked for the current question
  }

  // Server-side session cap (independent of client caps).
  static MAX_QUESTIONS = 8;
  static MAX_FOLLOWS_PER_Q = 2;
  static IDLE_NUDGE_AFTER_MS = 8000; // candidate silent 8s -> gentle nudge

  get pressureLadder() { return PRESSURE; }

  currentQuestion() {
    return this.state.question;
  }

  // Pull the next question (or null when finished).
  nextQuestion() {
    const q = this.queue.shift();
    if (!q) return null;
    this.state.question = { id: q.id, text: q.question };
    this.state.question_rubric = q.rubric;
    this.state.current_answer = '';
    this.followUpCount = 0;
    this.questionAskedAt = Date.now();
    return { ...this.state.question };
  }

  // Record the candidate's final utterance for the current question.
  appendAnswer(text) {
    if (!text) return;
    this.state.current_answer = this.state.current_answer
      ? `${this.state.current_answer} ${text}`
      : text;
  }

  // Day 2 pressure heuristic — deliberately simple, no LLM call:
  // short answers (few content words) push pressure up; detailed answers let it relax.
  // Returns { level, direction } for logging.
  evaluatePressure(answerText) {
    const words = (answerText || '').trim().split(/\s+/).filter(Boolean);
    const contentWords = words.filter((w) => w.length > 3).length;
    let direction = 0;
    if (contentWords < 6) direction = +1;
    else if (contentWords >= 25) direction = -1;
    const before = this.state.pressure_level;
    this.state.pressure_level = Math.min(4, Math.max(1, before + direction));
    return { level: this.state.pressure_level, direction, before, contentWords };
  }

  // Escalation phrasing by level (spoken verbatim by the agent).
  pressurePhrase() {
    const p = this.state.pressure_level;
    const probe = this.queue.length >= 0 && this.currentQuestion()
      ? this.questions.find((q) => q.id === this.currentQuestion().id)?.followUpProbe
      : null;
    switch (p) {
      case 4: return "You haven't given me a concrete example yet. Give me one.";
      case 3: return probe || "I'm looking for your specific contribution.";
      case 2: return probe || 'What exactly did you do?';
      default: return 'Can you tell me more?';
    }
  }

  advanceAfterAnswer() {
    this.state.answer_count++;
  }

  isFinished() {
    return this.queue.length === 0 && this.followUpCount >= Interview.MAX_FOLLOWS_PER_Q;
  }

  snapshot() {
    return {
      ...this.state,
      questionsRemaining: this.queue.length,
      maxFollowUpsPerQuestion: Interview.MAX_FOLLOWS_PER_Q,
      followUpsUsed: this.followUpCount,
      idleNudgeAfterMs: Interview.IDLE_NUDGE_AFTER_MS,
      mode: this.mode,
    };
  }
}

// Session registry (in-memory; one active interview per browser session id).
const sessions = new Map();

export function getInterview(sessionId) {
  return sessions.get(sessionId) || null;
}

export function createInterview(sessionId, opts) {
  const iv = new Interview(opts);
  sessions.set(sessionId, iv);
  return iv;
}

export function endInterview(sessionId) {
  const iv = sessions.get(sessionId);
  sessions.delete(sessionId);
  return iv ? iv.snapshot() : null;
}

export function sessionCount() {
  return sessions.size;
}
