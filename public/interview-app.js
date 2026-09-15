// interview-app.js — VoiceTwin Day 2 (Page 2) — the interview screen wiring.
import { startVoice, endVoice, EVT, audio, interview, setupInterview, teardownInterview, setTurnDetection, TD_BASELINE, TD_LOOSE } from '/voice-client.js';
import '/safe.js';

const $ = (id) => document.getElementById(id);
const els = {
  roleSelect: $('roleSelect'), modeSelect: $('modeSelect'),
  stateDot: $('stateDot'), stateText: $('stateText'),
  questionText: $('questionText'), qMeta: $('qMeta'),
  pressureBlocks: $('pressureBlocks'), pLevel: $('pLevel'),
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

const BLOCKS = ['░░░░', '█░░░', '██░░', '███░', '████'];

function renderState() {
  const s = interview.snapshot;
  if (s) {
    els.questionText.textContent = interview.question ? interview.question.text : '—';
    els.qMeta.textContent = `answers ${s.answer_count} · remaining ${s.questionsRemaining}`;
    els.pressureBlocks.textContent = BLOCKS[Math.min(4, s.pressure_level)];
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

// Track agent speaking state from EVT (audio scheduling is inside voice-client).
EVT.on((e) => {
  if (e.type === 'reply.audio') { audio.agentSpeaking = true; renderState(); }
  if (e.type === 'reply.done') { audio.agentSpeaking = false; renderState(); }
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
window.addEventListener('pagehide', () => { disarmNudge(); teardownInterview(); });
renderState();

fetch('/api/health').then((r) => r.json()).then((h) => {
  els.footNote.textContent = `cap ${h.limits.MAX_SESSION_SECONDS}s · ${h.voice} · gate G≤${h.gate.GREEN_MAX_MS}ms`;
}).catch(() => {});
