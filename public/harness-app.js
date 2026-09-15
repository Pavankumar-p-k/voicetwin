// harness-app.js — VoiceTwin Day 1 (Page 3) — latency harness page wiring.
import { startVoice, endVoice, EVT, logLine, audio, turn, harnessState } from '/voice-client.js';
import { TESTS, rotateTest } from '/harness.js';
import '/safe.js';

const $ = (id) => document.getElementById(id);
const els = {
  startBtn: $('startBtn'), endBtn: $('endBtn'),
  micDot: $('micDot'), micState: $('micState'), agentDot: $('agentDot'), agentState: $('agentState'),
  testSelect: $('testSelect'), runsNote: $('runsNote'),
  runsBody: $('runsBody'), verdict: $('verdict'), gateNote: $('gateNote'),
  gatebox: $('gatebox'), exportBtn: $('exportBtn'), footNote: $('footNote'),
};

TESTS.forEach((t) => {
  const opt = document.createElement('option');
  opt.value = t.label;
  opt.textContent = `${t.label} — ${t.what}`;
  els.testSelect.appendChild(opt);
});
els.testSelect.value = harnessState.currentTest;
els.testSelect.addEventListener('change', () => { harnessState.currentTest = els.testSelect.value; updateRunsNote(); });

function updateRunsNote() {
  els.runsNote.textContent = ''; // run counts live in the table; keep HUD lean
}

// ---- run recording (Space key = record completed turn) ----
let runNo = 0;

function recordRun() {
  if (turn.T0 == null) { logLine('no active turn: speak first, then press Space', 'err'); return; }
  if (turn.T2 == null) {
    logLine('no agent audio yet — wait for the reply, then record (or use silence test)', 'err');
    return;
  }
  runNo++;
  const interrupted = harnessState.interrupted;
  const sample = {
    test: harnessState.currentTest,
    T0: turn.T0, T1: turn.T1 ?? turn.T2, T2: turn.T2, T3: turn.T3 ?? performance.now(),
    interrupted,
    notes: `run#${runNo} ${harnessState.notes}`.trim(),
  };

  fetch('/api/latency', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sample),
  })
    .then((r) => r.json())
    .then((saved) => {
      addRow(saved);
      refreshGate();
      logLine(`recorded run#${runNo} [${saved.test}] T3−T0=${saved.t3MinusT0Ms}ms${interrupted ? ' (interrupted, gate-excluded)' : ''}`, 'sys');
      // auto-advance to the next test label for fast protocol cycling
      harnessState.currentTest = rotateTest(harnessState.currentTest);
      els.testSelect.value = harnessState.currentTest;
    })
    .catch((err) => logLine(`record failed: ${err.message}`, 'err'));

  turn.markTurnStart(); // arm the next turn immediately
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    recordRun();
  }
});

// ---- local run table ----
function addRow(s) {
  const tr = document.createElement('tr');
  if (s.interrupted) tr.classList.add('interrupted');
  tr.innerHTML = `
    <td>${s.notes?.match(/run#(\d+)/)?.[1] ?? '—'}</td>
    <td>${s.test}</td>
    <td class="num">${s.t1MinusT0Ms ?? '—'}</td>
    <td class="num">${s.t2MinusT0Ms ?? '—'}</td>
    <td class="num"><b>${s.t3MinusT0Ms ?? '—'}</b></td>
    <td>${s.interrupted ? '🚫 interrupted' : ''}${s.test === 'silence' ? ' 🔇 gate-excluded' : ''}</td>`;
  els.runsBody.prepend(tr);
}

// ---- gate verdict (client-side mirror of the server summary) ----
function refreshGate() {
  fetch('/api/latency/summary')
    .then((r) => r.json())
    .then((sum) => {
      const g = sum.gate;
      els.verdict.textContent = g.enoughRuns ? g.verdict : `${g.verdict} (pending)`;
      els.verdict.className = `verdict ${g.verdict}`;
      els.gateNote.textContent = `${g.message} · median ${g.medianT3MinusT0Ms ?? '—'} ms over ${g.enoughRuns ? '≥' : '<'}${g.minRunsRequired} clean runs`;
    })
    .catch(() => {});
}

// ---- CSV export (client-side, mirrors server CSV) ----
els.exportBtn.addEventListener('click', () => {
  const rows = [['ts', 'test', 'T0', 'T1', 'T2', 'T3', 't1-t0', 't2-t0', 't3-t0', 'interrupted', 'notes']];
  for (const tr of els.runsBody.rows) {
    const tds = [...tr.cells].map((td) => td.textContent.trim());
    rows.push([new Date().toISOString(), ...tds.slice(0, 5), tds[5]]);
  }
  const csv = rows.map((r) => r.join(',')).join('\n');
  navigator.clipboard.writeText(csv)
    .then(() => logLine('CSV copied to clipboard', 'ok'))
    .catch(() => logLine('clipboard blocked', 'err'));
});

// ---- session HUD ----
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

els.startBtn.addEventListener('click', async () => {
  try {
    els.startBtn.disabled = true;
    await startVoice();
    audio.sessionStartAt = Date.now();
    refreshStatus();
    logLine('session live — run the protocol, Space records each turn', 'sys');
  } catch (err) {
    logLine(`start failed: ${err.message}`, 'err');
    refreshStatus();
  }
});
els.endBtn.addEventListener('click', () => { endVoice(); refreshStatus(); });
refreshStatus();

EVT.on((e) => {
  if (e.type === 'session.ready') refreshStatus();
  if (e.type === 'user.delta') logLine(`… ${e.text}`, 'dim');
  if (e.type === 'user.final') logLine(`You: ${e.text}`);
  if (e.type === 'agent.text') logLine(`Agent: ${e.text}${e.interrupted ? ' (interrupted)' : ''}`, 'agent');
  if (e.type === 'session.ended') refreshStatus();
});

fetch('/api/health').then((r) => r.json()).then((h) => {
  els.footNote.textContent = `cap ${h.limits.MAX_SESSION_SECONDS}s · gate G≤${h.gate.GREEN_MAX_MS}ms Y≤${h.gate.YELLOW_MAX_MS}ms · ${h.sampleRate}Hz PCM16`;
}).catch(() => {});
