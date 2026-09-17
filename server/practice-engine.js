// practice-engine.js — VoiceTwin Day 5: THE COACHING LOOP.
//
//   INTERVIEW  →  FIND WEAKEST AREA  →  TARGETED PRACTICE  →  REPEAT QUESTION  →  COMPARE
//
// The engine takes the Day 4 report's weakest question (or an explicit
// question id + missed points), re-asks the SAME question, and re-scores each
// attempt with the SAME deterministic rubric scorer. The deliverable is the
// measurable: before X/5 → after Y/5.
//
//   Before: Specificity 4/10  →  AI: "Give me a concrete example…"  →  After: 8/10
//
// Same discipline as Day 4: no LLM judgment, no credits — every point is a
// named detector in rubric-scorer.js, so the before/after delta is defensible.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAnswer } from './rubric-scorer.js';
import { analyzeAnswer } from './answer-analysis.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS_PATH = path.join(ROOT, 'data', 'questions.json');

export class Practice {
  // Max re-asks of the practice question before we call it and report anyway.
  static MAX_ATTEMPTS = 3;

  constructor({ role = 'Software Engineer', questionId, missed = [], interviewReport = null } = {}) {
    const catalog = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));

    // Source of truth #1: a Day 4 report's weakest question.
    // Source of truth #2: explicit questionId (+ optional missed list).
    let target = null;
    if (interviewReport && interviewReport.weakest) {
      target = interviewReport.weakest;
      questionId = questionId || target.id;
      missed = missed.length ? missed : target.missed || [];
    }
    if (!questionId) {
      throw new Error('practice_start_failed: provide interviewReport.weakest or questionId');
    }

    const q = catalog.questions.find((x) => x.id === questionId);
    if (!q) throw new Error(`unknown question "${questionId}"`);

    this.role = role || catalog.role;
    this.questionId = q.id;
    this.questionText = q.question.replace(/^How would you scale X\?.*$/, 'How would you scale it? (pick your own project)');
    this.rubricPoints = [...q.rubric]; // exact point wording from the catalog

    // BEFORE is frozen from the interview: earned points we already know about
    // (the report's missed list is what the candidate failed to give).
    const missedSet = new Set(missed);
    this.before = {
      pointsTotal: this.rubricPoints.length,
      pointsEarned: this.rubricPoints.length - missedSet.size,
      missed: [...missedSet],
    };

    this.state = {
      question: { id: q.id, text: this.questionText },
      attempts: 0,
      lastRubric: null,
      bestAfter: null, // best attempt: rubric + specificity
      done: false,
    };
    // Points earned in ANY attempt of this practice session (union across attempts).
    this.earnedEver = new Set();
  }

  // Score one practice attempt. Evidence is cumulative across attempts within
  // this practice session (same rule as the interview): saying a missed point
  // now earns it, even if an earlier attempt earned other points.
  evaluateAttempt(text) {
    if (this.state.done) return { done: true, coaching: 'Practice already complete. Call end_practice.' };

    this.state.attempts++;
    const cumulative = this.effectiveRubric(text);
    const analysis = analyzeAnswer(text);
    this.state.lastRubric = cumulative;
    // Remember what this attempt earned so later attempts keep the credit
    // (same cumulative rule as the interview's appendAnswer accumulation).
    for (const r of cumulative.results) {
      if (r.earnedNow) this.earnedEver.add(r.point);
    }

    const allEarned = cumulative.pointsEarned === cumulative.pointsTotal;
    const budgetOver = this.state.attempts >= Practice.MAX_ATTEMPTS;
    if (allEarned || budgetOver) this.state.done = true;

    // Track the best attempt (most evidence, then most specific).
    if (
      !this.state.bestAfter ||
      cumulative.pointsEarned > this.state.bestAfter.rubric.pointsEarned ||
      (cumulative.pointsEarned === this.state.bestAfter.rubric.pointsEarned &&
        analysis.specificity > this.state.bestAfter.specificity)
    ) {
      this.state.bestAfter = { rubric: cumulative, specificity: analysis.specificity };
    }

    const delta = cumulative.pointsEarned - this.before.pointsEarned;

    // Coaching line: acknowledge real progress, then demand the next missing
    // evidence point verbatim (same demand lines as the interview — one voice).
    let coaching;
    if (allEarned) {
      coaching = `That covers everything I needed. Your evidence on this went from ${this.before.pointsEarned} out of 5 to ${cumulative.pointsEarned} out of 5. Call end_practice now.`;
    } else if (budgetOver) {
      coaching = `We are out of attempts on this one. Call end_practice now.`;
    } else {
      const missing = cumulative.results.find((r) => !r.earned);
      const ack = delta > 0 && this.state.attempts > 1 ? 'Better — that covered it. ' : '';
      coaching = `${ack}${missing.demand}`;
    }

    return {
      rubric: cumulative,
      analysis,
      delta,
      attempts: this.state.attempts,
      attemptsRemaining: Math.max(0, Practice.MAX_ATTEMPTS - this.state.attempts),
      done: this.state.done,
      coaching, // agent speaks this verbatim
    };
  }

  // The candidate's live evidence = BEFORE points (already credited from the
  // interview) ∪ points earned in ANY earlier attempt ∪ points earned now.
  effectiveRubric(latestText) {
    const live = scoreAnswer(this.questionId, latestText || '');
    const beforeMissed = new Set(this.before.missed);
    const results = live.results.map((r) => {
      const earnedNow = r.earned;
      const earned = earnedNow || !beforeMissed.has(r.point) || this.earnedEver.has(r.point);
      return { ...r, earned, earnedNow };
    });
    const pointsEarned = results.filter((r) => r.earned).length;
    return { ...live, results, pointsEarned, pointsTotal: live.pointsTotal };
  }

  // The measurable: BEFORE → AFTER. `after` = best attempt's cumulative score.
  result() {
    const best = this.state.bestAfter;
    const after = best
      ? { pointsEarned: best.rubric.pointsEarned, pointsTotal: best.rubric.pointsTotal, specificity: best.specificity }
      : { pointsEarned: this.before.pointsEarned, pointsTotal: this.before.pointsTotal, specificity: null };
    return {
      questionId: this.questionId,
      question: this.questionText,
      before: { ...this.before, evidencePct: Math.round((this.before.pointsEarned / this.before.pointsTotal) * 100) },
      after: { ...after, evidencePct: Math.round((after.pointsEarned / after.pointsTotal) * 100) },
      delta: after.pointsEarned - this.before.pointsEarned,
      attempts: this.state.attempts,
      missedAfter: best ? best.rubric.results.filter((r) => !r.earned).map((r) => r.point) : this.before.missed,
      mode: this.mode ?? 'practice',
    };
  }

  snapshot() {
    return {
      role: this.role,
      question: this.state.question,
      rubricPoints: this.rubricPoints,
      before: this.before,
      attempts: this.state.attempts,
      maxAttempts: Practice.MAX_ATTEMPTS,
      done: this.state.done,
      lastRubric: this.state.lastRubric,
    };
  }
}

// Session registry (in-memory, keyed by client-generated practice id).
const sessions = new Map();

export function getPractice(id) {
  return sessions.get(id) || null;
}

export function createPractice(id, opts) {
  const p = new Practice(opts);
  sessions.set(id, p);
  return p;
}

export function endPractice(id) {
  const p = sessions.get(id);
  sessions.delete(id);
  return p ? p.result() : null;
}

export function practiceCount() {
  return sessions.size;
}
