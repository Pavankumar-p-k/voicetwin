// interview-app.js — VoiceTwin Day 2 (Page 2) — the interview screen wiring.
import { startVoice, endVoice, EVT, audio, interview, setupInterview, teardownInterview, setTurnDetection, TD_BASELINE, TD_LOOSE } from '/voice-client.js';
import '/safe.js';

// No login gate: Screen 1 (project description) hands off via sessionStorage.
// No project text → back to Screen 1 to describe it first.
if (!sessionStorage.getItem('vt:project')) {
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
  chartBox: $('chartBox'), qaLog: $('qaLog'), qaInput: $('qaInput'), qaAsk: $('qaAsk'),
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
  renderChart(rep); // graphs need results-mode sizing first
  resetQA(); // fresh Q&A box bound to this report
}

// Graphs: REAL canvas charts — per-question evidence bars + specificity
// trend line. Measured values only, HiDPI-sharp, neobrutalist styling.
function renderChart(rep) {
  if (!els.chartBox) return;
  els.chartBox.innerHTML =
    '<div class="ccap">Evidence per question (marks)</div>' +
    '<canvas id="chartBars"></canvas>' +
    '<div class="ccap">Specificity per answer, /10 (left → right)</div>' +
    '<canvas id="chartTrend"></canvas>';
  drawCharts();
}

function chartColor(pct) {
  return pct >= 80 ? '#05E17A' : pct >= 40 ? '#FACC00' : '#FF4D50';
}

function fitCanvas(cv, hCss) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(200, cv.parentElement.clientWidth - 32);
  cv.style.width = w + 'px';
  cv.style.height = hCss + 'px';
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(hCss * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hCss);
  return [ctx, w];
}

function drawCharts() {
  const rep = lastReport;
  if (!rep || !document.body.classList.contains('results-mode')) return;
  const bars = document.getElementById('chartBars');
  const trend = document.getElementById('chartTrend');
  if (!bars || !trend) return;
  const pq = rep.perQuestion || [];

  // --- bars: one row per question ---
  const rowH = 34;
  const [b, bw] = fitCanvas(bars, pq.length * rowH + 8);
  b.font = '700 12px "Space Grotesk", sans-serif';
  b.textBaseline = 'middle';
  pq.forEach((q, i) => {
    const y = 4 + i * rowH;
    const pct = q.pointsTotal > 0 ? q.pointsEarned / q.pointsTotal : 0;
    b.fillStyle = '#000';
    b.fillText(`Q${i + 1}`, 2, y + 12);
    const x0 = 34;
    const tw = bw - x0 - 44;
    b.fillStyle = '#fff';
    b.fillRect(x0, y, tw, 24);
    b.fillStyle = chartColor(pct * 100);
    b.fillRect(x0 + 2, y + 2, Math.max(0, (tw - 4) * pct), 20);
    b.lineWidth = 2;
    b.strokeStyle = '#000';
    b.strokeRect(x0, y, tw, 24);
    b.fillStyle = '#000';
    b.fillText(`${q.pointsEarned}/${q.pointsTotal}`, bw - 40, y + 12);
  });

  // --- trend: specificity polyline 0..10 ---
  const [t, tw2] = fitCanvas(trend, 120);
  const padL = 26, padB = 16, padT = 8;
  const H = 120 - padB - padT;
  t.strokeStyle = '#000';
  t.lineWidth = 1;
  t.font = '700 10px "Space Grotesk", sans-serif';
  t.fillStyle = '#000';
  for (let g = 0; g <= 10; g += 5) {
    const y = padT + H - (g / 10) * H;
    t.globalAlpha = 0.25;
    t.beginPath(); t.moveTo(padL, y); t.lineTo(tw2 - 6, y); t.stroke();
    t.globalAlpha = 1;
    t.fillText(String(g), 6, y + 3);
  }
  if (specHist.length) {
    const xs = (i) => specHist.length === 1 ? padL + (tw2 - padL - 10) / 2
      : padL + (i / (specHist.length - 1)) * (tw2 - padL - 10);
    const ys = (s) => padT + H - (Math.max(0, Math.min(10, s)) / 10) * H;
    t.lineWidth = 3;
    t.strokeStyle = '#5294FF';
    t.beginPath();
    specHist.forEach((s, i) => { const x = xs(i), y = ys(s); i ? t.lineTo(x, y) : t.moveTo(x, y); });
    t.stroke();
    specHist.forEach((s, i) => {
      const x = xs(i), y = ys(s);
      t.fillStyle = '#FACC00';
      t.beginPath(); t.arc(x, y, 6, 0, 7); t.fill();
      t.lineWidth = 2; t.strokeStyle = '#000'; t.stroke();
    });
  } else {
    t.font = '500 13px "Space Grotesk", sans-serif';
    t.fillText('No specificity data recorded.', padL, padT + 20);
  }
}

let chartResizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeT);
  chartResizeT = setTimeout(drawCharts, 200);
});

// Q&A about the finished report — answered locally from measured data, zero cost.
function resetQA() {
  if (els.qaLog) els.qaLog.innerHTML = '';
}
function answerReport(q) {
  const rep = lastReport;
  if (!rep) return 'No report yet — finish an interview first.';
  const t = q.toLowerCase();
  const pq = rep.perQuestion || [];
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const mQ = t.match(/q\s?(\d+)/);
  if (mQ) {
    const i = Number(mQ[1]) - 1;
    const item = pq[i];
    if (!item) return `There are only ${pq.length} questions — ask about Q1–Q${pq.length}.`;
    const missed = (item.missed || []).map((m) => String(m).toLowerCase());
    return `Q${i + 1} “${item.question}” — marks ${item.pointsEarned}/${item.pointsTotal}.` +
      (missed.length ? ` You lost marks on: ${missed.join('; ')}. Next time, say each of those out loud with a concrete example.` : ' Full marks — nothing missed.');
  }
  if (/(weakest|worst|bad)/.test(t) && rep.weakest) {
    const w = rep.weakest;
    return `Weakest: ${w.id} at ${w.pointsEarned}/${w.pointsTotal} — missed: ${(w.missed || []).map((m) => String(m).toLowerCase()).join('; ') || 'see per-question marks above'}. Hit “Practice again” to drill exactly this.`;
  }
  if (/(improve|better|suggest|fix|how)/.test(t)) {
    const fb = rep.feedback || {};
    const tips = [...(fb.technical || []), ...(fb.communication || []), ...((fb.focus) || [])].slice(0, 3);
    return tips.length
      ? `Top fixes: ${tips.map((x, i) => `${i + 1}. ${cap(x)}`).join(' ')}`
      : 'Keep answering with specifics and measurements — nothing major flagged.';
  }
  if (/(score|mark|grade|result)/.test(t)) {
    return `Overall ${(rep.evidenceScore / 10).toFixed(1)} / 10 — ${rep.totalEarned}/${rep.totalPossible} evidence points across ${rep.questionsAsked} answers. Evidence means: each answer contained the exact points the question's rubric demanded.`;
  }
  if (/specif/.test(t)) {
    const avg = specHist.length ? (specHist.reduce((s, n) => s + n, 0) / specHist.length).toFixed(1) : null;
    return avg ? `Average specificity ${avg}/10 across ${specHist.length} answers. 8+ means concrete, personal, measured. Below 5 means vague — add what YOU did plus one number.` : 'No specificity data recorded this run.';
  }
  if (/(chart|graph|trend|visual|picture)/.test(t)) {
    const best = pq.reduce((a, b) => (b.pointsEarned / Math.max(1, b.pointsTotal) >= a.pointsEarned / Math.max(1, a.pointsTotal) ? b : a), pq[0] || { id: '—', pointsEarned: 0, pointsTotal: 1 });
    const dir = specHist.length > 1
      ? (specHist[specHist.length - 1] >= specHist[0] ? 'trending up — your answers got sharper as you went' : 'dipping at the end — you likely tired or went vague on later questions')
      : 'not enough answers to call a trend';
    return `Top chart: green bars (80%+) are strong, yellow 40–80%, red below 40%. Best question: ${best.id || best.question} at ${best.pointsEarned}/${best.pointsTotal}. Bottom chart: your specificity is ${dir}.`;
  }
  return `You scored ${(rep.evidenceScore / 10).toFixed(1)} / 10 (${rep.totalEarned}/${rep.totalPossible} evidence). Ask me “why did I lose marks on Q2?”, “what is my weakest question?”, or “how do I improve?”.`;
}
function askQA() {
  const q = (els.qaInput?.value || '').trim();
  if (!q || !els.qaLog) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  els.qaLog.innerHTML += `<div class="qa-q">You: ${esc(q)}</div><div class="qa-a">${esc(answerReport(q))}</div>`;
  els.qaLog.scrollTop = els.qaLog.scrollHeight;
  els.qaInput.value = '';
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
  if (starting) return; // double-click guard: one in-flight start at a time
  starting = true;
  try {
    els.startBtn.disabled = true;
    els.startBtn.textContent = 'Starting…';
    nudgeCount = 0;
    // No hard block: overlong stored projects (e.g. a pasted README) are
    // auto-trimmed to the 4000-char server limit so Start just works.
    // Too-short ones still need a real description from Screen 1.
    let proj = (sessionProject() || '').trim();
    if (proj.length > 4000) {
      logLine(`project trimmed ${proj.length} → 4000 chars (limit)`, 'sys');
      proj = proj.slice(0, 4000);
      try { sessionStorage.setItem('vt:project', proj); } catch {}
    }
    if (proj.length < 20) {
      logLine(
        `project description is ${proj.length} chars (needs 20–4000). Go back to / and describe ONE project — what you built, your stack, your role, one hard decision.`,
        'err',
      );
      renderState();
      els.startBtn.disabled = false;
      return;
    }
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
  } finally {
    starting = false;
    els.startBtn.textContent = 'Start interview →';
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
let starting = false; // one in-flight startInterview at a time (anti-spam)

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
els.qaAsk?.addEventListener('click', askQA);
els.qaInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') askQA(); });
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
  if (els.chartBox) els.chartBox.innerHTML = '';
  if (els.qaLog) els.qaLog.innerHTML = '';
  if (els.qaInput) els.qaInput.value = '';
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
