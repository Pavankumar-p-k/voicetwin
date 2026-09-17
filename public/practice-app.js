// practice-app.js — VoiceTwin Day 5: the coaching loop UI.
// Weakest question (auto from the last Day 4 report, or picked) → targeted
// voice practice → live evidence checklist → BEFORE → AFTER comparison.

import { EVT, audio, practice, setupPractice, teardownPractice, startVoice, endVoice, logLine } from '/voice-client.js';

const $ = (id) => document.getElementById(id);

const els = {
  questionSelect: $('questionSelect'),
  stateDot: $('stateDot'), stateText: $('stateText'),
  questionText: $('questionText'), qMeta: $('qMeta'),
  beforeAfter: $('beforeAfter'),
  baBefore: $('baBefore'), baAfter: $('baAfter'),
  baBarBefore: $('baBarBefore'), baBarAfter: $('baBarAfter'),
  baDelta: $('baDelta'),
  rubricBox: $('rubricBox'), rubricList: $('rubricList'), rubricScore: $('rubricScore'),
  startBtn: $('startBtn'), endBtn: $('endBtn'),
  log: $('log'), footNote: $('footNote'),
};

// ---- state render ----
function renderState() {
  const speaking = audio.agentSpeaking;
  const ready = audio.ready;
  els.stateText.textContent = !ready ? 'IDLE' : speaking ? 'SPEAKING' : practice.active ? 'LISTENING' : 'READY';
  els.stateDot.className = `dot ${speaking ? 'agent' : ready ? 'user' : ''}`.trim();
  els.startBtn.disabled = practice.active;
  els.endBtn.disabled = !practice.active;
}

function renderQuestion() {
  els.questionText.textContent = practice.question ? practice.question.text : '—';
  els.qMeta.textContent = practice.before
    ? `interview score: ${practice.before.pointsEarned}/${practice.before.pointsTotal} · up to 3 attempts`
    : '';
}

// ---- BEFORE → AFTER panel ----
function renderBefore() {
  if (!practice.before) return;
  const b = practice.before;
  els.beforeAfter.hidden = false;
  els.baBefore.textContent = `${b.pointsEarned}/${b.pointsTotal}`;
  els.baBarBefore.textContent = '█'.repeat(b.pointsEarned) + '░'.repeat(Math.max(0, b.pointsTotal - b.pointsEarned));
  els.baAfter.textContent = `${b.pointsEarned}/${b.pointsTotal}`;
  els.baBarAfter.textContent = els.baBarBefore.textContent;
  els.baDelta.textContent = '';
}

function renderAfter(r) {
  els.baAfter.textContent = `${r.after.pointsEarned}/${r.after.pointsTotal}`;
  els.baBarAfter.textContent = '█'.repeat(r.after.pointsEarned) + '░'.repeat(Math.max(0, r.after.pointsTotal - r.after.pointsEarned));
  const d = r.delta;
  els.baDelta.textContent = d > 0 ? `↑ +${d}` : d === 0 ? 'no change' : '↓';
}

// ---- live evidence checklist (same renderer shape as the interview page) ----
function renderRubric(r) {
  if (!r || !r.results || r.results.length === 0) { els.rubricBox.hidden = true; return; }
  els.rubricBox.hidden = false;
  els.rubricList.innerHTML = r.results
    .map((pt) => `<div class="ritem ${pt.earned ? 'got' : 'miss'}">` +
      `<span class="rcheck">${pt.earned ? '✓' : '✗'}</span>` +
      `<span class="rpoint">${pt.short}</span>` +
      (pt.earned ? '' : `<span class="rdemand">${pt.demand}</span>`) +
      `</div>`)
    .join('');
  els.rubricScore.textContent = `${r.pointsEarned}/${r.pointsTotal}`;
}

// ---- session control ----
async function start() {
  els.startBtn.disabled = true;
  try {
    const questionId = els.questionSelect.value || undefined;
    // Day 4 report hands over the weakest question + its missed points.
    const raw = sessionStorage.getItem('vt:lastReport');
    const report = raw ? JSON.parse(raw) : null;
    const data = await setupPractice({ questionId, interviewReport: report });
    practice.attemptsSeen = 0;
    renderBefore();
    els.rubricBox.hidden = true;
    await startVoice();
    logLine(`practice live — ${data.question.id}: ${data.question.text}`, 'sys');
    logLine(`before: ${data.before.pointsEarned}/${data.before.pointsTotal} — earn the missing evidence`, 'warn');
  } catch (err) {
    logLine(`start failed: ${err.message}`, 'err');
    renderState();
  }
}

function end() {
  endVoice();
  teardownPractice();
  renderState();
  logLine('practice ended by user', 'dim');
}

// ---- events ----
EVT.on((e) => {
  if (e.type === 'reply.audio') { audio.agentSpeaking = true; renderState(); }
  if (e.type === 'reply.done') { audio.agentSpeaking = false; renderState(); }
  if (e.type === 'practice.setup') renderQuestion();
  if (e.type === 'practice.rubric') renderRubric(e);
  if (e.type === 'practice.attempt') {
    practice.attemptsSeen = e.attempts;
    els.qMeta.textContent = `attempts: ${e.attempts}/3 · specificity ${e.specificity ?? '—'}/10`;
    logLine(`attempt ${e.attempts} — evidence ${e.delta >= 0 ? '+' : ''}${e.delta}, cumulative ${els.rubricScore.textContent}`, e.delta > 0 ? 'ok' : 'warn');
  }
  if (e.type === 'practice.result') {
    renderAfter(e);
    logLine(`BEFORE ${e.before.pointsEarned}/${e.before.pointsTotal} → AFTER ${e.after.pointsEarned}/${e.after.pointsTotal} (${e.delta >= 0 ? '+' : ''}${e.delta})`, 'sys');
  }
  if (e.type === 'session.dropped') {  // Day 7: recover cleanly mid-practice
    teardownPractice();
    logLine('connection lost — press Start practice to rejoin', 'err');
  }
  if (e.type === 'transcript.agent') { /* logged by voice-client */ }
});

els.startBtn.addEventListener('click', start);
els.endBtn.addEventListener('click', end);
window.addEventListener('pagehide', () => { endVoice(); teardownPractice(); });
window.addEventListener('keydown', (e) => {
  // Demo-recovery hotkey, consistent across every page (Day 1 contract).
  if (e.key === 'Escape' && !e.repeat) window.location.href = '/safe.html';
});
renderState();

// Populate the question picker from the static catalog (server health carries caps).
fetch('/api/health').then((r) => r.json()).then((h) => {
  els.footNote.textContent = `cap ${h.limits.MAX_SESSION_SECONDS}s · ${h.voice}`;
}).catch(() => {});

fetch('/api/questions').then((r) => r.json()).then((d) => {
  for (const q of d.questions || []) {
    const opt = document.createElement('option');
    opt.value = q.id;
    opt.textContent = `${q.id} — ${q.question}`;
    els.questionSelect.appendChild(opt);
  }
}).catch(() => {});
