// interview-app.js — VoiceTwin Day 2 (Page 2) — the interview screen wiring.
import { startVoice, endVoice, EVT, audio, interview, setupInterview, teardownInterview, setTurnDetection, TD_BASELINE, TD_LOOSE } from '/voice-client.js';
import '/safe.js';

const $ = (id) => document.getElementById(id);
const els = {
  roleSelect: $('roleSelect'), modeSelect: $('modeSelect'),
  stateDot: $('stateDot'), stateText: $('stateText'),
  questionText: $('questionText'), qMeta: $('qMeta'),
  pressureSegments: $('pressureSegments'), wave: $('wave'),
  pressureBlocks: $('pressureBlocks'), pLevel: $('pLevel'),
  specBlocks: $('specBlocks'), specNum: $('specNum'), weaknesses: $('weaknesses'),
  rubricBox: $('rubricBox'), rubricList: $('rubricList'), rubricScore: $('rubricScore'),
  reportBox: $('reportBox'), repScore: $('repScore'), repSub: $('repSub'), repQuestions: $('repQuestions'), repWeak: $('repWeak'), practiceBtn: $('practiceBtn'),
  startBtn: $('startBtn'), endBtn: $('endBtn'),
  log: $('log'), footNote: $('footNote'),
};

function logLine(msg, cls = '') {
  const div = document.createElement('div');
  div.className = `line ${cls}`.trim();
  const t = audio.sessionStartAt ? ((Date.now() - audio.sessionStartAt) / 1000).toFixed(2) : '0.00';
  div.textContent = `[${String(t).padStart(7)}s] ${msg}`;
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
    !audio.ws ? 'IDLE'
    : audio.ready ? (listening ? '● LISTENING' : 'AGENT SPEAKING')
    : 'CONNECTING…';
  els.stateDot.classList.toggle('on', audio.ready);
  els.startBtn.disabled = Boolean(audio.ws);
  els.endBtn.disabled = !audio.ws;
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
}

// Day 4: final evidence report (replaces a vibe score).
function renderReport(rep) {
  if (!rep) return;
  // Day 5 handoff: practice page starts from the report's weakest question.
  try { sessionStorage.setItem('vt:lastReport', JSON.stringify(rep)); } catch {}
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
}

// Track agent speaking state from EVT (audio scheduling is inside voice-client).
EVT.on((e) => {
  if (e.type === 'reply.audio') { audio.agentSpeaking = true; renderState(); }
  if (e.type === 'reply.done') { audio.agentSpeaking = false; renderState(); }
  if (e.type === 'mic.level') renderLevel(e.level); // Day 6 waveform
  if (e.type === 'interview.pressure') renderPressure(e.level);
  if (e.type === 'interview.analysis') renderAnalysis(e);
  if (e.type === 'interview.rubric') renderRubric(e);   // Day 4: live evidence chips
  if (e.type === 'interview.question') { els.rubricBox.hidden = true; } // fresh question: reset checklist
  if (e.type === 'interview.report') renderReport(e);   // Day 4: final evidence report
});

// ---- silence nudge: if question asked and no user speech for 8s, prompt via reply.create ----
const NUDGE_AFTER_MS = 8000;
let nudgeTimer = null;

function armNudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    if (!interview.active || !audio.ws || audio.ws.readyState !== WebSocket.OPEN) return;
    if (audio.agentSpeaking) { armNudge(); return; }
    if (interview.waitingForAnswer && !interview.lastUserText) {
      audio.ws.send(JSON.stringify({
        type: 'reply.create',
        instructions: 'The candidate is silent. Calmly ask once: take your time, then answer the question.',
      }));
      logLine('(nudge: candidate silent 8s)', 'dim');
    }
    armNudge(); // stay armed while waiting
  }, NUDGE_AFTER_MS);
}

function disarmNudge() { clearTimeout(nudgeTimer); nudgeTimer = null; }

// EVT reactions for the interview flow
EVT.on((e) => {
  if (e.type === 'session.ready') {
    renderState();
    logLine(`live — question: ${interview.question?.text ?? '?'}`, 'sys');
    armNudge();
  }
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

// mirror transcript lines into the local log
EVT.on((e) => {
  if (e.type === 'user.delta') { /* lightweight: skip on this page */ }
  if (e.type === 'user.final') logLine(`You: ${e.text}`);
  if (e.type === 'agent.text') logLine(`Agent: ${e.text}${e.interrupted ? ' (interrupted)' : ''}`, 'agent');
  if (e.type === 'session.error') logLine(`error: ${e.code} ${e.message}`, 'err');
});

async function start() {
  try {
    els.startBtn.disabled = true;
    const data = await setupInterview({
      role: els.roleSelect.value,
      mode: els.modeSelect.value,
    });
    logLine(`interview ${data.interviewId} ready · Q1: ${data.question.text}`, 'sys');
    await startVoice();
    audio.sessionStartAt = Date.now();
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

els.startBtn.addEventListener('click', start);
els.endBtn.addEventListener('click', end);
els.practiceBtn.addEventListener('click', () => {
  // Day 5: the coaching loop starts from the weakest question.
  window.location.href = '/practice.html';
});
window.addEventListener('pagehide', () => { disarmNudge(); teardownInterview(); });
renderState();

fetch('/api/health').then((r) => r.json()).then((h) => {
  els.footNote.textContent = `cap ${h.limits.MAX_SESSION_SECONDS}s · ${h.voice} · gate G≤${h.gate.GREEN_MAX_MS}ms`;
}).catch(() => {});
