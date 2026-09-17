// voice-client.js — VoiceTwin Day 1 (Page 2)
// Browser voice loop: token -> WebSocket -> session.update -> streaming audio.
// Also the instrumentation backbone for Page 3 (latency harness): every
// protocol event lands in EVT (raw log) and hooks call timestamp() so the
// harness page can measure T0..T3 without touching this file.

import { CONFIG } from '/config.js'; // shared root config, served by the server

// ---- shared instrumentation bus (Page 3 reads this) ----
export const EVT = {
  events: [],
  listeners: new Set(),
  push(type, payload = {}) {
    const e = { type, t: performance.now(), wall: Date.now(), ...payload };
    this.events.push(e);
    for (const fn of this.listeners) { try { fn(e); } catch {} }
    return e;
  },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  clear() { this.events = []; },
};

// Test label currently running ('normal' | 'short' | ...). Set by harness page.
export const harnessState = { currentTest: 'normal', notes: '', interrupted: false };

// Timestamps of the current turn (T0 set by harness via markTurnStart()).
export const turn = {
  T0: null, T1: null, T2: null, T3: null,
  finalTranscript: '', agentText: '',
  // Day 7 fix: T2/T3 are only meaningful for a reply the USER triggered.
  // Set on transcript.user, consumed by the next completed reply. Greeting,
  // silence-nudge and post-tool follow-up replies never stamp the gate.
  awaitingReply: false,
  markTurnStart() {
    this.T0 = performance.now(); this.T1 = null; this.T2 = null; this.T3 = null;
    this.finalTranscript = ''; this.agentText = '';
    this.awaitingReply = false;
    harnessState.interrupted = false;
    EVT.push('T0', { t: this.T0 });
  },
};

// ---- audio state ----
export const audio = {
  ctx: null,            // AudioContext (device rate)
  micStream: null,
  workletNode: null,
  ws: null,
  ready: false,
  sending: false,
  sessionId: null,

  // playback chain (Page 4 swaps this strategy for safe mode)
  playbackQueue: [],    // { buffer, startAt }
  playbackTime: 0,
  flushPlayback() {
    for (const q of this.playbackQueue) { try { q.src.stop(); } catch {} }
    this.playbackQueue = [];
    this.playbackTime = this.ctx ? this.ctx.currentTime : 0;
  },
};

// ---- interview session (Day 2) ----
// interviewId keys the server-side state machine; toolsPending buffers
// tool.results until reply.done (per AAI: send results on reply.done).
export const interview = {
  id: null,
  active: false,
  question: null,
  snapshot: null,
  tools: [],
  systemPrompt: '',
  waitingForAnswer: false,
  toolsPending: [],
  lastUserText: '',
};

// ---- practice session (Day 5) ----
// Parallel to `interview`: keys the server-side Practice engine. Mutually
// exclusive with interview.active (practice runs on its own page).
export const practice = {
  id: null,
  active: false,
  question: null,
  before: null,
  tools: [],
  systemPrompt: '',
  lastUserText: '',
  lastRubric: null,
};

// ---- UI logger ----
export function logLine(msg, cls = '') {
  const el = document.getElementById('log');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `line ${cls}`.trim();
  const t = ((performance.now() - performanceOrigin()) / 1000).toFixed(2);
  div.textContent = `[${String(t).padStart(7)}s] ${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  // cap log lines so the DOM never balloons during long test batches
  while (el.childElementCount > 400) el.removeChild(el.firstChild);
}
function performanceOrigin() { return 0; }

// ---- connection ----
export async function startVoice() {
  if (audio.ws) return;
  audio.sending = false;

  // 1. Temporary token from OUR server (API key never reaches the browser)
  const tokenRes = await fetch('/api/voice-token');
  if (!tokenRes.ok) throw new Error(`voice-token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { token, maxSessionSeconds } = await tokenRes.json();

  // 2. Audio: device-rate context + worklet resampling to 24k (see worklet file)
  audio.ctx = new AudioContext();
  await audio.ctx.audioWorklet.addModule('/pcm-worklet.js');
  audio.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false },
  });
  const source = audio.ctx.createMediaStreamSource(audio.micStream);
  audio.workletNode = new AudioWorkletNode(audio.ctx, 'pcm-resample-processor', {
    processorOptions: { targetSampleRate: CONFIG.AAI.SAMPLE_RATE, bufferSize: 480 },
  });

  // 3. WebSocket with ?token= (browser cannot set Authorization headers)
  const wsUrl = new URL(CONFIG.AAI.WS_URL);
  wsUrl.searchParams.set('token', token);
  audio.ws = new WebSocket(wsUrl);

  audio.ws.addEventListener('open', () => {
    EVT.push('ws.open');
    // Order matters: session.update FIRST, then wait for session.ready.
    audio.ws.send(JSON.stringify({ type: 'session.update', session: inlineSession() }));
  });

  audio.ws.addEventListener('message', (ev) => {
    onMessage(JSON.parse(ev.data)).catch((err) => logLine(`handler: ${err.message}`, 'err'));
  });
  audio.ws.addEventListener('close', (ev) => {
    EVT.push('ws.close', { code: ev.code });
    logLine(`connection closed (${ev.code})`, 'dim');
    handleDisconnect();
  });
  audio.ws.addEventListener('error', () => logLine('WebSocket error', 'err'));

  // 4. Mic -> worklet -> b64 -> input.audio (gated on session.ready)
  audio.workletNode.port.onmessage = (e) => {
    // Day 6: amplitude level messages ride the same port as PCM buffers.
    if (e.data && e.data.level != null) {
      EVT.push('mic.level', { level: e.data.level });
      return;
    }
    if (!audio.ready || audio.ws.readyState !== WebSocket.OPEN) return;
    const b64 = bytesToB64(new Uint8Array(e.data));
    audio.ws.send(JSON.stringify({ type: 'input.audio', audio: b64 }));
  };
  source.connect(audio.workletNode);
  // Intentionally NOT connecting worklet to destination (would echo mic).

  audio.maxSessionSeconds = maxSessionSeconds;
  EVT.push('client.start');
}

function inlineSession() {
  // Inline configuration (mutually exclusive with agent_id).
  // Practice mode uses the coach prompt + practice tools (Day 5).
  if (practice.active && practice.systemPrompt) {
    return {
      system_prompt: practice.systemPrompt,
      greeting: practice.question ? `Let's practice. ${practice.question.text}` : 'Let’s practice.',
      output: { voice: CONFIG.AAI.VOICE },
      input: {
        turn_detection: { vad_threshold: 0.5, min_silence: 2200, max_silence: 6000, interrupt_response: true },
      },
      tools: practice.tools,
    };
  }
  // Interview mode uses the server-built persona prompt + tools (Day 2).
  if (interview.active && interview.systemPrompt) {
    return {
      system_prompt: interview.systemPrompt,
      greeting: interview.question ? `Let's begin. ${interview.question.text}` : 'Let’s begin.',
      output: { voice: CONFIG.AAI.VOICE },
      input: {
        turn_detection: { vad_threshold: 0.5, min_silence: 2200, max_silence: 6000, interrupt_response: true },
      },
      tools: interview.tools,
    };
  }
  // Plain Day 1 mode: short replies, baseline turn detection.
  return {
    system_prompt:
      'You are a friendly assistant on a voice call. Keep every reply to ONE short sentence — never two. ' +
      'Answer what was asked first; skip preamble and disclaimers. If you don’t know something, say so briefly. No exclamation marks.',
    greeting: 'Hey, what can I do for you?',
    output: { voice: CONFIG.AAI.VOICE },
  };
}

// Mid-session turn-detection retune (docs pattern): loosen while waiting for
// an open-ended answer so thinkers aren't cut off; tighten afterwards.
export async function setTurnDetection(td) {
  if (audio.ws && audio.ws.readyState === WebSocket.OPEN) {
    audio.ws.send(JSON.stringify({ type: 'session.update', session: { input: { turn_detection: td } } }));
    EVT.push('turn_detection', { td });
  }
}
export const TD_BASELINE = { vad_threshold: 0.5, min_silence: 1200, max_silence: 3000, interrupt_response: true };
// Echo-safe preset: higher VAD threshold keeps speaker bleed from arming turns.
export const TD_LOOSE = { vad_threshold: 0.45, min_silence: 2200, max_silence: 6000, interrupt_response: true };

// ---- message handling + timestamps ----
async function onMessage(msg) {
  switch (msg.type) {
    case 'session.ready':
      audio.ready = true;
      audio.sessionId = msg.session_id;
      EVT.push('session.ready', { sessionId: msg.session_id });
      logLine(`session ready (${msg.session_id}) — start speaking`, 'ok');
      fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: msg.session_id, phase: 'started' }),
      }).catch(() => {});
      break;

    case 'input.speech.started':
      EVT.push('speech.started');
      // T0 = user turn start. Auto-arm on the first utterance and re-arm
      // after a completed turn — but never while the agent is speaking
      // (mic echo of agent speech must not start a measured turn) and
      // never while a measured turn is already in flight (T0 set, no T3).
      if ((turn.T0 == null || turn.T3 != null) && !audio.agentSpeaking && !turn.awaitingReply) {
        turn.markTurnStart();
      }
      break;

    case 'input.speech.stopped':
      EVT.push('speech.stopped');
      break;

    case 'transcript.user.delta':
      EVT.push('user.delta', { text: msg.text });
      break;

    case 'transcript.user':
      // Final transcript of the user utterance -> T1 (first turn only)
      EVT.push('user.final', { text: msg.text });
      if (turn.T0 != null && turn.T1 == null) { turn.T1 = performance.now(); }
      turn.finalTranscript = msg.text;
      turn.agentText = '';
      turn.T1 = turn.T0 != null && turn.T1 == null ? performance.now() : turn.T1;
      turn.awaitingReply = true; // next agent reply is the measured one
      interview.lastUserText = msg.text;
      practice.lastUserText = msg.text;
      logLine(`You: ${msg.text}`);
      // Answer received: retune to baseline (tighten again).
      if (interview.waitingForAnswer) {
        interview.waitingForAnswer = false;
        setTurnDetection(TD_BASELINE);
      }
      break;

    case 'reply.started':
      EVT.push('reply.started', { replyId: msg.reply_id });
      // Day 7 fix: a fresh agent reply invalidates any pending user-turn stamp.
      // Without this, mic echo of the agent's own voice re-arms T0 mid-reply,
      // which (a) corrupts latency samples and (b) makes the NEXT tool call see
      // a "new user turn" — prompting the agent to re-ask the same question.
      turn.markTurnStart();
      break;

    case 'tool.call': {
      EVT.push('tool.call', { name: msg.name, callId: msg.call_id });
      try {
        const result = await handleToolCall(msg.name, msg.arguments || {});
        interview.toolsPending.push({ call_id: msg.call_id, result });
        logLine(`tool: ${msg.name} ok`, 'sys');
      } catch (err) {
        interview.toolsPending.push({ call_id: msg.call_id, result: JSON.stringify({ error: err.message }) });
        logLine(`tool: ${msg.name} failed: ${err.message}`, 'err');
      }
      break;
    }

    case 'reply.audio': {
      // Stamp T2 only on the first agent audio that actually answers the
      // user's utterance. Greeting/nudge replies (awaitingReply=false) are
      // never measured — this is what killed the impossible 6 ms sample.
      if (turn.awaitingReply && turn.T0 != null && turn.T2 == null) {
        turn.T2 = performance.now();
        EVT.push('T2', { t: turn.T2 });
        logLine(`⏱ first audio in ${Math.round(turn.T2 - turn.T0)} ms (T2−T0)`, 'sys');
      }
      audio.agentSpeaking = true; // synchronous: guards T0 re-arm during echo
      playChunk(msg.data);
      break;
    }

    case 'transcript.agent':
      EVT.push('agent.text', { text: msg.text, interrupted: Boolean(msg.interrupted) });
      turn.agentText = msg.text;
      logLine(`Agent: ${msg.text}${msg.interrupted ? ' (interrupted)' : ''}`, 'agent');
      break;

    case 'reply.done': {
      const interrupted = msg.status === 'interrupted';
      EVT.push('reply.done', { status: msg.status || 'completed' });
      audio.agentSpeaking = false; // synchronous flag for turn-arming guard
      if (interrupted) {
        harnessState.interrupted = true;
        audio.flushPlayback(); // barge-in: drop stale scheduled audio
        interview.toolsPending.length = 0; // stale tool results are meaningless after barge-in
      } else {
        // AAI pattern: send accumulated tool.result events on reply.done.
        for (const t of interview.toolsPending) {
          audio.ws.send(JSON.stringify({ type: 'tool.result', call_id: t.call_id, result: t.result }));
          EVT.push('tool.result.sent', { callId: t.call_id });
        }
        interview.toolsPending.length = 0;
        if (turn.awaitingReply && turn.T2 != null && turn.T3 == null) {
          turn.T3 = performance.now();
          EVT.push('T3', { t: turn.T3 });
          const dt = Math.round(turn.T3 - turn.T0);
          const v = dt <= CONFIG.GATE.GREEN_MAX_MS ? 'GREEN' : dt <= CONFIG.GATE.YELLOW_MAX_MS ? 'YELLOW' : 'RED';
          logLine(`⏱ reply heard in ${dt} ms (T3−T0) — gate ${v}`, 'sys');
        }
      }
      turn.awaitingReply = false; // turn consumed (measured, interrupted, or agent-initiated)
      break;
    }

    case 'session.ended':
      EVT.push('session.ended', { duration: msg.session_duration_seconds });
      logLine(`session ended (${msg.session_duration_seconds?.toFixed?.(1) ?? '?'}s billed)`, 'dim');
      fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: audio.sessionId, phase: 'ended', durationSeconds: msg.session_duration_seconds }),
      }).catch(() => {});
      break;

    case 'session.error':
      EVT.push('session.error', { code: msg.code, message: msg.message });
      logLine(`session error: ${msg.code} — ${msg.message}`, 'err');
      break;

    default:
      EVT.push(msg.type, {});
  }
}

// ---- playback: schedule chunks back-to-back at 24 kHz ----
function playChunk(b64) {
  if (!audio.ctx) return;
  const pcm16 = b64ToPcm16(b64);
  const f32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;
  const buffer = audio.ctx.createBuffer(1, f32.length, CONFIG.AAI.SAMPLE_RATE);
  buffer.getChannelData(0).set(f32);
  const src = audio.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(audio.ctx.destination);
  const now = audio.ctx.currentTime;
  audio.playbackTime = Math.max(audio.playbackTime, now);
  src.start(audio.playbackTime);
  audio.playbackTime += buffer.duration;
  audio.playbackQueue.push({ src, startAt: audio.playbackTime });
  audio.playbackQueue = audio.playbackQueue.filter((q) => q.startAt > now - 1);
}

// ---- Day 2: interview tool dispatch (client-side function tools) ----
async function handleToolCall(name, args) {
  if (name === 'check_answer') {
    const res = await fetch('/api/interview/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId: interview.id, answerText: args.answer_text || interview.lastUserText || '' }),
    });
    if (!res.ok) throw new Error(`answer api ${res.status}`);
    const data = await res.json();
    interview.snapshot = data.snapshot;
    interview.lastAnalysis = data.analysis;
    interview.lastRubric = data.rubric ?? null;
    EVT.push('interview.pressure', { level: data.pressure.level, direction: data.pressure.direction });
    if (data.analysis) EVT.push('interview.analysis', data.analysis);
    if (data.rubric) EVT.push('interview.rubric', data.rubric);
    if (data.followUp) {
      // Day 3/4 differentiator: the agent speaks OUR follow-up verbatim.
      return JSON.stringify({
        pressure_level: data.pressure.level,
        specificity: data.analysis?.specificity ?? null,
        evidence: data.rubric ? `${data.rubric.pointsEarned}/${data.rubric.pointsTotal} rubric points earned` : null,
        next_utterance_guidance: `Ask exactly: "${data.followUp}" — one sentence, nothing else.`,
      });
    }
    return JSON.stringify({
      pressure_level: data.pressure.level,
      specificity: data.analysis?.specificity ?? null,
      evidence: data.rubric ? `${data.rubric.pointsEarned}/${data.rubric.pointsTotal} rubric points earned` : null,
      next_utterance_guidance: data.guidance,
    });
  }

  if (name === 'next_question') {
    const res = await fetch('/api/interview/next', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId: interview.id }),
    });
    if (!res.ok) throw new Error(`next api ${res.status}`);
    const data = await res.json();
    if (data.finished) {
      EVT.push('interview.finished', {});
      return JSON.stringify({ finished: true, closing_guidance: 'Thank the candidate and close the interview in one sentence. Do not ask anything else.' });
    }
    interview.question = data.question;
    interview.systemPrompt = data.systemPrompt;
    interview.snapshot = data.snapshot;
    interview.lastRubric = null; // fresh question, fresh evidence
    interview.waitingForAnswer = true;
    setTurnDetection(TD_LOOSE); // open-ended question: give the candidate room
    EVT.push('interview.question', { id: data.question.id });
    return JSON.stringify({ finished: false, next_question: data.question.text, utterance_guidance: `Ask exactly: "${data.question.text}"` });
  }

  if (name === 'end_interview') {
    interview.active = false;
    fetch('/api/interview/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId: interview.id }),
    }).then((r) => r.json()).then((d) => {
      if (d.report) EVT.push('interview.report', d.report);
    }).catch(() => {});
    EVT.push('interview.ended.by_agent', {});
    return JSON.stringify({ ended: true, closing_guidance: 'Close politely in one short sentence.' });
  }

  if (name === 'check_attempt') {
    // Day 5 coaching loop: score the attempt, speak the demand verbatim.
    const res = await fetch('/api/practice/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: practice.id, answerText: args.attempt_text || practice.lastUserText || '' }),
    });
    if (!res.ok) throw new Error(`practice answer api ${res.status}`);
    const data = await res.json();
    practice.lastRubric = data.rubric ?? null;
    if (data.rubric) EVT.push('practice.rubric', data.rubric);
    EVT.push('practice.attempt', {
      attempts: data.attempts,
      delta: data.delta,
      done: data.done,
      specificity: data.analysis?.specificity ?? null,
    });
    return JSON.stringify({
      evidence: data.rubric ? `${data.rubric.pointsEarned}/${data.rubric.pointsTotal} rubric points earned (cumulative)` : null,
      attempts_remaining: data.attemptsRemaining,
      done: data.done,
      next_utterance_guidance: data.done
        ? data.coaching
        : `Say exactly: "${data.coaching}" — one sentence, nothing else.`,
    });
  }

  if (name === 'end_practice') {
    practice.active = false;
    fetch('/api/practice/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: practice.id }),
    }).then((r) => r.json()).then((d) => {
      if (d.result) EVT.push('practice.result', d.result);
    }).catch(() => {});
    EVT.push('practice.ended.by_agent', {});
    return JSON.stringify({ ended: true, closing_guidance: 'Close politely in one short sentence and acknowledge the improvement.' });
  }

  throw new Error(`unknown tool: ${name}`);
}

// Prepare an interview session BEFORE startVoice() so inlineSession() picks it up.
export async function setupInterview({ role = 'Software Engineer', mode = 'normal', interviewId } = {}) {
  const res = await fetch('/api/interview/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, mode, interviewId }),
  });
  if (!res.ok) throw new Error(`interview start failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  interview.id = data.interviewId;
  interview.question = data.question;
  interview.snapshot = data.snapshot;
  interview.systemPrompt = data.systemPrompt;
  interview.tools = data.tools;
  interview.active = true;
  interview.waitingForAnswer = true;
  interview.toolsPending = [];
  EVT.push('interview.setup', { interviewId: interview.id, question: data.question.id });
  return data;
}

export function teardownInterview() {
  if (interview.active && interview.id) {
    fetch('/api/interview/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId: interview.id }),
    }).catch(() => {});
  }
  interview.active = false;
  interview.id = null;
  interview.toolsPending = [];
  interview.waitingForAnswer = false;
}

// Prepare a practice session BEFORE startVoice() so inlineSession() picks it up.
export async function setupPractice({ role, questionId, missed, interviewReport, practiceId } = {}) {
  const res = await fetch('/api/practice/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, questionId, missed, interviewReport, practiceId }),
  });
  if (!res.ok) throw new Error(`practice start failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  practice.id = data.practiceId;
  practice.question = data.question;
  practice.before = data.before;
  practice.systemPrompt = data.systemPrompt;
  practice.tools = data.tools;
  practice.active = true;
  practice.lastUserText = '';
  practice.lastRubric = null;
  EVT.push('practice.setup', { practiceId: practice.id, question: data.question.id });
  return data;
}

export function teardownPractice() {
  if (practice.active && practice.id) {
    fetch('/api/practice/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: practice.id }),
    }).catch(() => {});
  }
  practice.active = false;
  practice.id = null;
  practice.lastRubric = null;
}

// ---- teardown (billing-critical: session.end BEFORE close) ----
// Day 7 (Test D/I): a dropped socket (bad Wi-Fi, server-side cap close, token
// expiry) must leave the client able to START AGAIN — stop the mic, close the
// audio context, clear every handle. Idempotent: endVoice's delayed close and
// genuine drops both land here; second pass is a no-op.
function handleDisconnect() {
  audio.ready = false; audio.sending = false;
  audio.micStream?.getTracks().forEach((t) => t.stop());
  audio.ctx?.close().catch(() => {});
  audio.ctx = null; audio.workletNode = null; audio.ws = null;
  EVT.push('session.dropped', {});
}

export function endVoice() {
  try {
    if (audio.ws && audio.ws.readyState === WebSocket.OPEN) {
      audio.ws.send(JSON.stringify({ type: 'session.end' }));
      // Server emits session.ended then closes; also hard-close shortly after.
      setTimeout(() => { try { audio.ws?.close(); } catch {} }, 1500);
    } else {
      try { audio.ws?.close(); } catch {}
    }
  } catch {}
  handleDisconnect();
  logLine('session ended by user', 'dim');
}

// pagehide: send session.end synchronously so we never pay the 30s grace window
window.addEventListener('pagehide', () => {
  try {
    if (audio.ws && audio.ws.readyState === WebSocket.OPEN) {
      audio.ws.send(JSON.stringify({ type: 'session.end' }));
    }
  } catch {}
});

// ---- helpers ----
function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function b64ToPcm16(b64) {
  const bin = atob(b64);
  const pcm = new Int16Array(bin.length / 2);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  }
  return pcm;
}
