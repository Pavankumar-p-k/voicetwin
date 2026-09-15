// app.js — VoiceTwin Day 1 (Page 2) — console page wiring.
import { CONFIG } from '/config.js';
import { startVoice, endVoice, EVT, logLine, audio, turn, harnessState } from '/voice-client.js';
import { TESTS, rotateTest } from '/harness.js';
import '/safe.js'; // installs Esc hotkey listener (side-effect module)

const $ = (id) => document.getElementById(id);
const els = {
  startBtn: $('startBtn'), endBtn: $('endBtn'), timer: $('timer'),
  micDot: $('micDot'), micState: $('micState'), agentDot: $('agentDot'), agentState: $('agentState'),
  log: $('log'), liveUser: $('liveUser'), testSelect: $('testSelect'),
  autorotate: $('autorotate'), capNote: $('capNote'), footNote: $('footNote'),
};

// populate test selector (labels defined by the harness page)
TESTS.forEach((t) => {
  const opt = document.createElement('option');
  opt.value = t.label;
  opt.textContent = `${t.label} — ${t.what}`;
  els.testSelect.appendChild(opt);
});
els.testSelect.value = harnessState.currentTest;
els.testSelect.addEventListener('change', () => {
  harnessState.currentTest = els.testSelect.value;
});

function refreshStatus() {
  const connected = Boolean(audio.ws);
  const ready = audio.ready;
  els.micState.textContent = connected ? (ready ? 'MIC live' : 'MIC connecting…') : 'MIC idle';
  els.micDot.classList.toggle('on', ready);
  els.agentState.textContent = ready ? 'AGENT ready' : (connected ? 'AGENT waiting' : 'AGENT idle');
  els.agentDot.classList.toggle('on', ready);
  els.startBtn.disabled = connected;
  els.endBtn.disabled = !connected;
}

function tickTimer() {
  if (!audio.sessionStartAt) { els.timer.textContent = '0.0s'; return; }
  const s = (Date.now() - audio.sessionStartAt) / 1000;
  els.timer.textContent = `${s.toFixed(1)}s`;
  els.timer.classList.toggle('warn', s > CONFIG.LIMITS.CLIENT_MAX_SECONDS * 0.8);
  // DEV_MODE discipline: hard client cap — auto end before the server cap.
  if (s >= CONFIG.LIMITS.CLIENT_MAX_SECONDS) end();
}

setInterval(tickTimer, 100);

async function start() {
  try {
    els.startBtn.disabled = true;
    await startVoice();
    audio.sessionStartAt = Date.now();
    refreshStatus();
  } catch (err) {
    logLine(`start failed: ${err.message}`, 'err');
    refreshStatus();
  }
}

function end() {
  endVoice();
  audio.sessionStartAt = null;
  refreshStatus();
}

els.startBtn.addEventListener('click', start);
els.endBtn.addEventListener('click', end);
refreshStatus();

fetch('/api/health').then((r) => r.json()).then((h) => {
  els.capNote.textContent = `${h.limits.MAX_SESSION_SECONDS}s max · token TTL ${h.limits.TOKEN_EXPIRES_SECONDS}s`;
  els.footNote.textContent = `${h.wsUrl} · gate G<=${h.gate.GREEN_MAX_MS}ms / Y<=${h.gate.YELLOW_MAX_MS}ms`;
}).catch(() => { els.capNote.textContent = 'server unreachable'; });

// live transcript deltas + test label rotation
EVT.on((e) => {
  if (e.type === 'user.delta') els.liveUser.textContent = e.text || '';
  if (e.type === 'user.final') els.liveUser.textContent = '';
  if (e.type === 'session.ready') refreshStatus();
  if (e.type === 'reply.done' && els.autorotate.checked) {
    rotateTest();
    els.testSelect.value = harnessState.currentTest;
  }
});
