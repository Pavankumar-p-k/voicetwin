// interview-app.js — VoiceTwin Day 2 (Page 2) — the interview screen wiring.
import { startVoice, endVoice, EVT, audio, interview, setupInterview, teardownInterview, setTurnDetection, TD_BASELINE, TD_LOOSE } from '/voice-client.js';
import { getToken } from './auth.js';
import '/safe.js';

// Login gate: the interview is authenticated-only. No token → login screen.
if (!getToken()) {
  window.location.href = '/';
}

const $ = (id) => document.getElementById(id);
const els = {
  roleSelect: $('roleSelect'), modeSelect: $('modeSelect'),
  stateDot: $('stateDot'), stateText: $('stateText'),
  questionText: $('questionText'), qMeta: $('qMeta'),
  pressureSegments: $('pressureSegments'), wave: $('wave'),
  pressureBlocks: $('pressureBlocks'), pLevel: $('pLevel'),
  specBlocks: $('specBlocks'), specNum: $('specNum'), weaknesses: $('weaknesses'),
  rubricBox: $('rubricBox'), rubricList: $('rubricList'), rubricScore: $('rubricScore'),
  reportBox: $('reportBox'), repScore: $('repScore'), repSub: $('repSub'), repQuestions: $('repQuestions'), repWeak: $('repWeak'), repStats: $('repStats'), practiceBtn: $('practiceBtn'),
  startBtn: $('startBtn'), endBtn: $('endBtn'),
  log: $('log'), footNote: $('footNote'),
  // Chat shell (Screen 2/3) — additive, legacy elements above untouched.
  voiceState: $('voiceState'), liveScore: $('liveScore'),
  lsSpec: $('lsSpec'), lsEvidence: $('lsEvidence'), lsNote: $('lsNote'),
  projChip: $('projChip'),
  resScore: $('resScore'), resSub: $('resSub'),
  dimSpec: $('dimSpec'), dimEvidence: $('dimEvidence'),
  wellList: $('wellList'), fixList: $('fixList'), focusList: $('focusList'),
  // Back navigation (additive; lifecycle untouched).
  backBtn: $('backBtn'), leaveConfirm: $('leaveConfirm'),
  stayBtn: $('stayBtn'), leaveBtn: $('leaveBtn'),
  newInterviewLink: $('newInterviewLink'),
};

// Running history of backend-measured specificity (for honest averages only).
const specHist = [];

function setVoiceStatus() {
  if (!els.voiceState) return;
  let html;
  if (!audio.ws) html = 'Press Start to begin.';
  else if (!audio.ready) html = 'Connecting…';
  else if (audio.agentSpeaking) html = '<span class="mic-mini">VOICETWIN speaking</span>';
  else html = '<span class="mic-mini"><span class="bars"><i></i><i></i><i></i></span>Listening…</span>';
  els.voiceState.innerHTML = html;
}

function logLine(msg, cls = '') {
  const div = document.createElement('div');
  div.className = `line ${cls}`.trim();
  const t = audio.sessionStartAt ? ((Date.now() - audio.sessionStartAt) / 1000).toFixed(2) : '0.00';
  const ts = document.createElement('span');
  ts.className = 't';
  ts.textContent = `[${String(t).padStart(7)}s] `;
  div.appendChild(ts);
  div.appendChild(document.createTextNode(msg));
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
  while (els.log.childElementCount > 400) els.log.removeChild(els.log.firstChild);
}


// Day 6: pressure as 4 labeled segments; active level + everything below lights up.
function renderPressure(level) {
  els.pressureSegments.className = `psegments p${level}`;
  els.pressureSegments.querySelectorAll('.pseg').forEach((seg, i) => {
    seg.classList.toggle('on', i < level);
  });
}

// Day 6: mic waveform — the newest level pushes bars right, height = amplitude.
const WAVE_BARS = 18;
function renderLevel(level) {
  const bars = els.wave.children;
  for (let i = 0; i < bars.length - 1; i++) {
    bars[i].style.height = bars[i + 1].style.height || '3px';
  }
  bars[bars.length - 1].style.height = `${Math.max(3, Math.round(level * 46))}px`;
}

function renderState() {
  const s = interview.snapshot;
  if (s) {
    els.questionText.textContent = interview.question ? interview.question.text : '—';
    els.qMeta.textContent = `answers ${s.answer_count} · remaining ${s.questionsRemaining}`;
    renderPressure(s.pressure_level);
    els.pLevel.textContent = s.pressure_level;
  }
  const listening = audio.ready && !audio.agentSpeaking;
  els.stateText.textContent =
    !audio.ws ? 'Ready'
    : audio.ready ? (listening ? 'Listening…' : 'VOICETWIN speaking')
    : 'Connecting…';
  els.stateDot.classList.toggle('on', audio.ready);
  els.startBtn.disabled = Boolean(audio.ws);
  els.endBtn.disabled = !audio.ws;
  setVoiceStatus();
}

const WEAKNESS_LABELS = {
  no_personal_contribution: 'no "I" — contribution unclear',
  no_measurable_result: 'no measurable result',
  no_technical_depth: 'no technical depth',
  hedging: 'hedging',
  passive_voice: 'passive voice',
  too_short: 'too short',
};

function renderAnalysis(a) {
  if (!a) return;
  const filled = '█'.repeat(a.specificity);
  const empty = '░'.repeat(Math.max(0, 10 - a.specificity));
  els.specBlocks.textContent = filled + empty;
  els.specNum.textContent = `${a.specificity}/10${a.strong ? ' ✓' : ''}`;
  els.weaknesses.innerHTML = a.weaknesses
    .map((w) => `<span class="wtag">${WEAKNESS_LABELS[w] || w}</span>`)
    .join('');
  // Subtle live strip — only backend-measured values, nothing invented.
  specHist.push(a.specificity);
  if (els.liveScore) els.liveScore.hidden = false;
  if (els.lsSpec) els.lsSpec.textContent = `${a.specificity}/10`;
  if (els.lsNote) {
    els.lsNote.textContent = a.strong
      ? 'Solid answer — specific and complete.'
      : (a.weaknesses.length ? `Needs work: ${WEAKNESS_LABELS[a.weaknesses[0]] || a.weaknesses[0]}.` : '');
  }
}

// Day 4: the live evidence checklist — what the rubric demands vs what was said.
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
  if (els.lsEvidence) els.lsEvidence.textContent = `${r.pointsEarned}/${r.pointsTotal}`;
}

// Day 4: final evidence report (replaces a vibe score).
function renderReport(rep) {
  if (!rep) return;
  lastReport = rep;
  interviewDone = true; // finished: Back/leave needs no confirm anymore
  hideLeave();
  try {
    if (rep.weaknesses?.length) sessionStorage.setItem('vt:focus', JSON.stringify(rep.weaknesses));
  } catch {}
  // Day 5 handoff: practice page starts from the report's weakest question.
  try { sessionStorage.setItem('vt:lastReport', JSON.stringify(rep)); } catch {}
  // Day 6: session stats line — filler words / vague / incomplete.
  if (rep.stats) {
    const st = rep.stats;
    els.repStats.innerHTML =
      `<span class="stat">${st.fillerWords} filler words</span>` +
      `<span class="stat">${st.vagueAnswers} vague answers</span>` +
      `<span class="stat">${st.incompleteAnswers} incomplete answers</span>`;
  }
  els.reportBox.hidden = false;
  els.repScore.textContent = rep.evidenceScore == null ? '—' : `${rep.evidenceScore}%`;
  els.repSub.textContent = `${rep.totalEarned}/${rep.totalPossible} evidence points · ${rep.questionsAsked} questions`;
  els.repQuestions.innerHTML = (rep.perQuestion || [])
    .map((q) => `<div class="rq"><span class="rqid">${q.id}</span>` +
      `<span class="rqbar">${'█'.repeat(q.pointsEarned)}${'░'.repeat(Math.max(0, q.pointsTotal - q.pointsEarned))}</span>` +
      `<span class="rqnum">${q.pointsEarned}/${q.pointsTotal}</span></div>`)
    .join('');
  if (rep.weakest) {
    els.repWeak.innerHTML = `<b>${rep.weakest.id}</b> (${rep.weakest.pointsEarned}/${rep.weakest.pointsTotal}) — ` +
      rep.weakest.missed.map((m) => m.toLowerCase()).join('; ');
  } else {
    els.repWeak.textContent = '—';
  }
  // Screen 3 — centered results, only measured values.
  if (els.resScore) {
    els.resScore.textContent = rep.evidenceScore == null ? '—' : `${(rep.evidenceScore / 10).toFixed(1)} / 10`;
  }
  if (els.resSub) {
    els.resSub.textContent = `${rep.totalEarned}/${rep.totalPossible} evidence points · ${rep.questionsAsked} answers`;
  }
  if (els.dimSpec) {
    els.dimSpec.textContent = specHist.length
      ? (specHist.reduce((s, n) => s + n, 0) / specHist.length).toFixed(1)
      : '—';
  }
  if (els.dimEvidence) {
    const pq = rep.perQuestion || [];
    els.dimEvidence.textContent = pq.length
      ? `${(pq.reduce((s, q) => s + q.pointsEarned, 0) / pq.length).toFixed(1)} / 5 avg`
      : '—';
  }
  if (els.wellList) {
    const full = (rep.perQuestion || []).filter((q) => q.pointsTotal > 0 && q.pointsEarned === q.pointsTotal);
    els.wellList.innerHTML = full.length
      ? full.slice(0, 4).map((q) => `<li>Full evidence on “${q.question}”.</li>`).join('')
      : `<li>Answered ${rep.questionsAsked} questions end to end, by voice.</li>`;
  }
  if (els.fixList) {
    const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const fb = rep.feedback || { technical: [], communication: [], commNotes: [] };
    const items = [];
    for (const m of (fb.technical || []).slice(0, 3)) items.push(`<li><b>Technical reasoning</b> — ${cap(m)}.</li>`);
    for (const m of (fb.communication || []).slice(0, 2)) items.push(`<li><b>Evidence</b> — ${cap(m)}.</li>`);
    for (const n of (fb.commNotes || []).slice(0, 2)) items.push(`<li><b>Communication</b> — ${n}</li>`);
    els.fixList.innerHTML = items.length
      ? items.join('')
      : '<li>Nothing major flagged — keep this standard.</li>';
  }
  if (els.focusList) {
    const focus = (rep.feedback?.focus || []).slice(0, 3);
    els.focusList.innerHTML = focus.length
      ? focus.map((f, i) => `<li>${i + 1}. ${f}</li>`).join('')
      : '<li>Keep answering with specifics and measurements.</li>';
  }
  document.body.classList.add('results-mode');
}

// Track agent speaking state from EVT (audio scheduling is inside voice-client).
EVT.on((e) => {
  if (e.type === 'reply.audio') { audio.agentSpeaking = true; renderState(); }
  if (e.type === 'reply.done') { audio.agentSpeaking = false; renderState(); }
  if (e.type === 'mic.level') renderLevel(e.level); // Day 6 waveform
  if (e.type === 'interview.pressure') renderPressure(e.level);
  if (e.type === 'interview.analysis') renderAnalysis(e);
  if (e.type === 'interview.rubric') renderRubric(e);   // Day 4: live evidence chips
  if (e.type === 'interview.question') {
    nudgeCount = 0; // fresh question, fresh patience
    els.rubricBox.hidden = true; // fresh question: reset checklist
    renderState();
  }
  if (e.type === 'interview.report') renderReport(e);   // Day 4: final evidence report
  if (e.type === 'session.dropped') {  // Day 7: recover cleanly mid-interview
    disarmNudge();
    teardownInterview();               // free server-side state (no report)
    audio.sessionStartAt = null;
    logLine('connection lost — press Start interview to rejoin', 'err');
  }
});

// ---- silence nudge: gentle once, then at most one reminder per question.
// Never nags: endless re-armed nudges made listening feel erratic.
const NUDGE_AFTER_MS = 12000;
const MAX_NUDGES = 2;
let nudgeTimer = null;
let nudgeCount = 0;

function armNudge() {
  clearTimeout(nudgeTimer);
  if (nudgeCount >= MAX_NUDGES) return; // said enough — stay silent, keep listening
  nudgeTimer = setTimeout(() => {
    if (!interview.active || !audio.ws || audio.ws.readyState !== WebSocket.OPEN) return;
    if (audio.agentSpeaking) { armNudge(); return; }
    if (interview.waitingForAnswer && !interview.lastUserText && nudgeCount < MAX_NUDGES) nudge();
    armNudge(); // stay armed while waiting (until the per-question cap)
  }, NUDGE_AFTER_MS);
}

function disarmNudge() { clearTimeout(nudgeTimer); nudgeTimer = null; }

// Day 7 fix: the silence nudge created an agent-initiated reply with no user
// utterance, which (a) polluted latency samples and (b) left `lastUserText`
// empty so the next check_answer submitted an empty answer — the agent then
// re-asked the question. The nudge now only speaks; it never re-asks.
function nudge() {
  if (!audio.ws || audio.ws.readyState !== WebSocket.OPEN) return;
  nudgeCount++;
  audio.ws.send(JSON.stringify({
    type: 'reply.create',
    instructions: 'Say exactly: take your time. Then stop speaking and wait.',
  }));
  logLine('(nudge: candidate silent)', 'dim');
}

// EVT reactions for the interview flow
EVT.on((e) => {
  if (e.type === 'session.ready') {
    renderState();
    logLine(`live — question: ${interview.question?.text ?? '?'}`, 'sys');
    armNudge();
  }
  if (e.type === 'speech.started') { disarmNudge(); }  // any user speech cancels it
  if (e.type === 'reply.started') { disarmNudge(); }   // agent speaking — pause the timer
  if (e.type === 'user.final') {
    interview.lastUserText = e.text || '';
    disarmNudge();
    renderState();
  }
  if (e.type === 'reply.done' && !e.status === false) { /* noop keepalive */ }
  if (e.type === 'interview.pressure') {
    logLine(`pressure → ${e.level}${e.direction > 0 ? ' ↑' : e.direction < 0 ? ' ↓' : ''}`, 'sys');
    renderState();
  }
  if (e.type === 'interview.analysis') {
    logLine(`specificity ${e.specificity}/10 · weak: ${e.weaknesses.length ? e.weaknesses.join(', ') : 'none'}`, e.strong ? 'ok' : 'warn');
  }
  if (e.type === 'interview.rubric') {
    logLine(`evidence ${e.pointsEarned}/${e.pointsTotal} (${e.results.filter((x) => x.earned).map((x) => x.short).join(', ') || 'none earned'})`, e.pointsEarned >= 4 ? 'ok' : 'warn');
  }
  if (e.type === 'interview.report') {
    logLine(`evidence score ${e.evidenceScore}% (${e.totalEarned}/${e.totalPossible}) · weakest: ${e.weakest ? `${e.weakest.id} ${e.weakest.pointsEarned}/${e.weakest.pointsTotal}` : '—'}`, 'sys');
  }
  if (e.type === 'interview.question') {
    logLine(`next question loaded (${e.id})`, 'sys');
    renderState();
  }
  if (e.type === 'agent.text') { renderState(); }
  if (e.type === 'session.ended' || e.type === 'ws.close') {
    disarmNudge();
    renderState();
  }
  if (e.type === 'interview.finished') {
    logLine('INTERVIEW COMPLETE — all questions asked', 'ok');
  }
});

// Voice-client already renders You:/Agent: rows into #log (console and
// harness pages depend on that). This page must NOT render them a second
// time — one event, one row. Errors still surface here.
EVT.on((e) => {
  if (e.type === 'user.delta') { /* lightweight: skip on this page */ }
  if (e.type === 'session.error') logLine(`error: ${e.code} ${e.message}`, 'err');
});

async function start() {
  try {
    els.startBtn.disabled = true;
    nudgeCount = 0;
    const data = await setupInterview({
      role: 'Software Engineer',
      mode: sessionMode(),
      projectDescription: sessionProject(),
      focusWeaknesses: sessionFocus(),
    });
    logLine(`interview ${data.interviewId} ready · Q1: ${data.question.text}`, 'sys');
    await startVoice();
    audio.sessionStartAt = Date.now();
    trapBrowserBack(); // browser Back during interview → confirm first
    renderState();
  } catch (err) {
    logLine(`start failed: ${err.message}`, 'err');
    teardownInterview();
    renderState();
  }
}

function end() {
  disarmNudge();
  endVoice();          // session.end before close (billing-safe)
  teardownInterview(); // free server-side state
  audio.sessionStartAt = null;
  renderState();
  logLine('interview ended by user', 'dim');
}

// ---- Safe Back navigation ----
// Uses the existing end() (mic stop + session teardown). Listeners are all
// module-level, so Leave/restart can never duplicate pipelines or renderers.
let interviewDone = false;

function sessionActive() { return Boolean(audio.ws); }
function showLeave() { if (els.leaveConfirm) els.leaveConfirm.hidden = false; }
function hideLeave() { if (els.leaveConfirm) els.leaveConfirm.hidden = true; }
function trapBrowserBack() {
  try { history.pushState({ vt: 'interview' }, ''); } catch {}
}

els.backBtn?.addEventListener('click', () => {
  if (interviewDone || document.body.classList.contains('results-mode')) {
    window.location.href = '/'; // finished: plain navigation, no confirm
    return;
  }
  if (sessionActive()) { trapBrowserBack(); showLeave(); return; }
  window.location.href = '/';
});
els.stayBtn?.addEventListener('click', hideLeave);
els.leaveBtn?.addEventListener('click', () => {
  hideLeave();
  end(); // existing teardown: nudge off, mic stopped, session ended
  window.location.href = '/';
});
els.newInterviewLink?.addEventListener('click', (e) => {
  e.preventDefault();
  end(); // clear any residual session, then clean start screen
  window.location.href = '/';
});
// Browser Back while interviewing → same confirm; otherwise normal navigation.
// Registered once at module level: never duplicated on restart.
window.addEventListener('popstate', () => {
  if (!interviewDone && !document.body.classList.contains('results-mode') && sessionActive()) {
    trapBrowserBack();
    showLeave();
  }
});

els.startBtn.addEventListener('click', start);
els.endBtn.addEventListener('click', end);
// Practice Again restarts the SAME interview flow (no separate page),
// informed by the previous report's weaknesses when available.
let lastReport = null;
els.practiceBtn.addEventListener('click', async () => {
  try {
    if (lastReport?.weaknesses?.length) {
      sessionStorage.setItem('vt:focus', JSON.stringify(lastReport.weaknesses));
    }
  } catch {}
  document.body.classList.remove('results-mode');
  interviewDone = false; // new interview: confirm applies again
  hideLeave();
  els.log.innerHTML = '';
  specHist.length = 0;
  if (els.liveScore) els.liveScore.hidden = true;
  if (els.lsSpec) els.lsSpec.textContent = '—';
  if (els.lsEvidence) els.lsEvidence.textContent = '—';
  if (els.lsNote) els.lsNote.textContent = '';
  renderState();
  await start();
});
window.addEventListener('pagehide', () => { disarmNudge(); teardownInterview(); });
// Screen 1 handoff: project + difficulty + previous weaknesses.
// All three ride the existing start flow — no new routes.
function sessionProject() { try { return sessionStorage.getItem('vt:project') || null; } catch { return null; } }
function sessionMode() {
  try {
    const m = sessionStorage.getItem('vt:mode');
    return m === 'simple' || m === 'medium' || m === 'hard' ? m : 'medium';
  } catch { return 'medium'; }
}
function sessionFocus() {
  try { return JSON.parse(sessionStorage.getItem('vt:focus') || '[]'); }
  catch { return []; }
}
try {
  const proj = sessionStorage.getItem('vt:project') || '';
  if (proj && els.projChip) {
    els.projChip.hidden = false;
    els.projChip.textContent = `Interviewing you on: ${proj.length > 90 ? proj.slice(0, 90) + '…' : proj}`;
  }
} catch {}
renderState();

fetch('/api/health').then((r) => r.json()).then((h) => {
  els.footNote.textContent = `cap ${h.limits.MAX_SESSION_SECONDS}s · ${h.voice} · gate G≤${h.gate.GREEN_MAX_MS}ms`;
}).catch(() => {});
