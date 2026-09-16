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
import { analyzeAnswer, buildFollowUp, pressureDelta } from './answer-analysis.js';
import { scoreAnswer } from './rubric-scorer.js';

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
      weaknesses: [],          // categorized signals (Day 3)
      lastRubric: null,        // Day 4: rubric score for the current question
    };
    this.rubricLog = [];       // one entry per answered question (report fuel)
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

  // Day 2 pressure heuristic — REPLACED on Day 3 by analyzeAnswer(); kept as
  // a fallback for degenerate input (empty answer).
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

  // Day 3+4: full adaptive evaluation. Runs the specificity analysis AND the
  // rubric scorer, adjusts pressure, appends weaknesses, and returns the exact
  // follow-up to speak. Day 4 rule: missing RUBRIC EVIDENCE outranks generic
  // signals — the agent demands the first missing evidence point (rubric order
  // = most fundamental first).
  evaluateAnswer(answerText) {
    const analysis = analyzeAnswer(answerText);
    const rubric = scoreAnswer(this.state.question?.id, this.state.current_answer);
    this.state.lastRubric = rubric;

    const before = this.state.pressure_level;
    let delta = analysis.wordCount < 1 ? +1 : pressureDelta(analysis);
    if (rubric.pointsTotal > 0 && rubric.pointsEarned === 0) delta = Math.max(delta, +1); // no evidence at all
    if (rubric.pointsTotal > 0 && rubric.pointsEarned === rubric.pointsTotal) delta = Math.min(delta, -1); // full evidence
    this.state.pressure_level = Math.min(4, Math.max(1, before + delta));

    for (const w of analysis.weaknesses) {
      if (!this.state.weaknesses.includes(w)) this.state.weaknesses.push(w);
    }

    const missing = rubric.results.filter((r) => !r.earned);
    const allEvidencePresent = rubric.pointsTotal > 0 && missing.length === 0;

    let followUp = null;
    let followUpKind = null;
    if (!allEvidencePresent && this.followUpCount < Interview.MAX_FOLLOWS_PER_Q) {
      if (missing.length > 0) {
        // Day 4: demand the specific missing evidence — verbatim.
        followUp = missing[0].demand;
        followUpKind = 'missing_evidence';
      } else {
        // Rubric satisfied but specificity signals are weak — generic probe.
        followUp = buildFollowUp(analysis.category, {
          level: this.state.pressure_level,
          usedCount: this.followUpCount,
        });
        followUpKind = 'signal';
      }
      this.followUpCount++;
    }

    return {
      analysis,
      rubric,
      pressure: {
        level: this.state.pressure_level,
        direction: Math.sign(this.state.pressure_level - before),
        before,
      },
      followUp,               // string | null — agent speaks this verbatim
      followUpKind,           // 'missing_evidence' | 'signal' | null
      followUpBudget: Interview.MAX_FOLLOWS_PER_Q - this.followUpCount,
      moveOnRecommended:
        allEvidencePresent || this.followUpCount >= Interview.MAX_FOLLOWS_PER_Q,
    };
  }

  // Close out the current question: freeze its rubric score into the log.
  // Called by the /next route BEFORE serving the next question.
  recordQuestionResult() {
    const q = this.state.question;
    if (!q || this.state.lastRubric == null) return;
    const r = this.state.lastRubric;
    this.rubricLog.push({
      id: q.id,
      question: q.text,
      pointsEarned: r.pointsEarned,
      pointsTotal: r.pointsTotal,
      missed: r.results.filter((x) => !x.earned).map((x) => x.point),
    });
    this.state.lastRubric = null;
  }

  // Final evidence-based report (Day 4 deliverable — replaces a vibe score).
  report() {
    // A question still open when the interview ends still deserves its score.
    this.recordQuestionResult();
    const totalEarned = this.rubricLog.reduce((s, r) => s + r.pointsEarned, 0);
    const totalPossible = this.rubricLog.reduce((s, r) => s + r.pointsTotal, 0);
    // Weakest question = lowest earned ratio (ties -> more missed evidence).
    const weakest = [...this.rubricLog].sort(
      (a, b) => (a.pointsEarned / Math.max(1, a.pointsTotal)) - (b.pointsEarned / Math.max(1, b.pointsTotal))
        || b.missed.length - a.missed.length,
    )[0] || null;
    return {
      role: this.role,
      mode: this.mode,
      questionsAsked: this.rubricLog.length,
      perQuestion: this.rubricLog,
      totalEarned,
      totalPossible,
      evidenceScore: totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : null,
      weakest: weakest
        ? { id: weakest.id, question: weakest.question, pointsEarned: weakest.pointsEarned, pointsTotal: weakest.pointsTotal, missed: weakest.missed }
        : null,
      weaknesses: [...this.state.weaknesses],
    };
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
      rubricSoFar: this.rubricLog.map((r) => ({ id: r.id, pointsEarned: r.pointsEarned, pointsTotal: r.pointsTotal })),
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
