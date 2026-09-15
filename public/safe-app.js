// safe-app.js — VoiceTwin Day 1 (Page 4) — Demo Safe Mode player.
// Replays DEMO_SESSION turn by turn with realistic pauses and (optional)
// recorded audio, in the exact UI of the live console. Zero API credits.
import { DEMO_SESSION } from '/safe-data.js';

const $ = (id) => document.getElementById(id);
const els = {
  replayBtn: $('replayBtn'), stopBtn: $('stopBtn'), backBtn: $('backBtn'),
  modeDot: $('modeDot'), modeState: $('modeState'), timer: $('timer'), log: $('log'),
};

let playing = false;
let stopRequested = false;
let timerInt = null;
let startTime = null;

function logLine(msg, cls = '') {
  const div = document.createElement('div');
  div.className = `line ${cls}`.trim();
  const t = startTime ? ((Date.now() - startTime) / 1000).toFixed(2) : '0.00';
  div.textContent = `[${String(t).padStart(7)}s] ${msg}`;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional voice: if a recorded agent audio file exists at /safe-audio/reply-N.mp3
// it is played through a muted-visible audio element; otherwise text-only pacing.
function playAgentAudioIfAny(i) {
  const probe = new Audio(`/safe-audio/reply-${i}.mp3`);
  probe.volume = 1.0;
  return new Promise((resolve) => {
    probe.addEventListener('ended', resolve, { once: true });
    probe.addEventListener('error', () => resolve(null), { once: true });
    probe.play().catch(() => resolve(null));
    // resolve after at most 15s regardless
    setTimeout(resolve, 15000);
  });
}

async function replay() {
  if (playing) return;
  playing = true; stopRequested = false;
  els.replayBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.modeState.textContent = 'SAFE MODE active';
  els.modeDot.classList.add('on');
  els.log.textContent = '';
  startTime = Date.now();
  timerInt = setInterval(() => {
    els.timer.textContent = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  }, 100);

  logLine(DEMO_SESSION.title, 'sys');
  await sleep(600);

  for (let i = 0; i < DEMO_SESSION.turns.length; i++) {
    if (stopRequested) break;
    const t = DEMO_SESSION.turns[i];
    await sleep(t.pauseMsBefore ?? 500);
    if (stopRequested) break;

    if (t.role === 'agent') {
      logLine(`Agent: ${t.text}`, 'agent');
      await playAgentAudioIfAny(i); // resolves immediately when no audio file
    } else {
      // simulate the user speaking (transcript appears progressively)
      logLine(`You: ${t.text}`);
      await sleep(Math.min(4000, 300 + t.text.length * 28));
    }
  }

  finish();
}

function finish() {
  playing = false;
  clearInterval(timerInt);
  els.replayBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.modeState.textContent = stopRequested ? 'SAFE MODE stopped' : 'SAFE MODE complete';
  els.modeDot.classList.remove('on');
  logLine(stopRequested ? 'replay stopped' : 'interview complete (safe mode)', 'ok');
}

els.replayBtn.addEventListener('click', replay);
els.stopBtn.addEventListener('click', () => { stopRequested = true; });
els.backBtn.addEventListener('click', () => { window.location.href = '/'; });

// Esc here goes BACK to live (reverse of other pages) unless replaying;
// hold Shift+Esc to force-navigate to safe mode again (no-op) — kept simple:
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !playing) {
    window.location.href = '/';
  }
});

logLine('standby — press "Start session" to run the recorded interview', 'dim');
