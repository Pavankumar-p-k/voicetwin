# VoiceTwin — Adaptive Voice Interviewer

> "We built an AI interviewer that actually listens to your answer and fights back."

**Day 1 complete: Voice Reality + Latency.** An interviewer that doesn't just ask questions —
it listens, challenges weak answers, interrupts naturally, and adapts in real time.
Built on the [AssemblyAI Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api)
(one WebSocket: STT + turn detection + interruption + LLM + TTS).

---

## Status: Day 1 of 7

| Day | Mission | Status |
|-----|---------|--------|
| **1** | **Voice + latency + fallback** | ✅ live voice loop verified with real key (barge-in + cap auto-end confirmed) |
| **2** | **Interview engine** | ✅ this release — 8-question loop, pressure ladder, tool-driven agent |
| 3 | Adaptive follow-ups + pressure | ⬜ (ladder shipped; judgment/analysis deepens next) |
| 4 | Evidence-based rubric scoring | ⬜ (rubrics already drafted — see `data/questions.json`) |
| 5 | Coaching loop (before → after) | ⬜ |
| 6 | Demo polish | ⬜ |
| 7 | Stress testing + dry run | ⬜ |

## What's inside (Day 1)

```
MIC → browser AudioWorklet (24 kHz PCM16) → wss://agents.assemblyai.com/v1/ws
                                           ← agent audio → SPEAKER
              ↑ temporary token                     ↑
              └── our server mints GET /v1/token    └── T0..T3 timestamps → latency store
```

- **`server/`** — temp-token minting (API key never touches the browser), latency ingest,
  usage counter. Zero frameworks; `ws` not even required server-side (browser talks direct).
- **`public/voice-client.js`** — the voice loop: `session.update` → `session.ready` →
  stream audio → barge-in flush on `reply.done: interrupted` → `session.end` before close
  (never pay the 30-second grace window).
- **`public/harness.html`** — the 8-scenario Day 1 protocol with **Space = record run**,
  per-test medians, and the decision gate verdict.
- **`public/safe.html`** — Demo Safe Mode: identical UI, recorded conversation, 0 credits.
- **`data/questions.json`** — Day 1 evening prep: 8 questions + 5-point evidence rubrics (Day 4 fuel).

## Run it

```bash
cd voicetwin
npm install            # installs ws (server keeps node:http anyway)
cp .env.example .env   # paste your ASSEMBLYAI_API_KEY (free tier, no card)
npm start              # http://localhost:3000
```

Pages:

| URL | Purpose |
|-----|---------|
| `/` | Voice console — start a session, talk |
| `/harness.html` | Latency protocol runner + decision gate |
| `/interview.html` | **The interviewer** — role/mode, ● LISTENING, pressure meter |
| `/safe.html` | Demo Safe Mode (fallback replay, `Esc` from anywhere) |
| `/api/health`, `/api/usage`, `/api/interview/state?id=…`, `/api/latency/summary` | introspection |

## How the interview loop works (Day 2)

```
browser                    our server                 AssemblyAI
   │ POST /api/interview/start │                            │
   │ ← question + prompt + tools                            │
   │ session.update (prompt+tools+greeting) ────────────→ │
   │ ←──────────── session.ready + greeting audio            │
   │ ← input.audio ──────────────→ STT + neural turn detect  │
   │ ← tool.call: check_answer / next_question               │
   │ POST /api/interview/answer (pressure eval)              │
   │ tool.result → agent speaks next line ← reply.audio ──── │
```

- **Pressure ladder 1–4**: vague answers push up, specific answers relax it
  (Day 2 heuristic = content-word count; Day 3 replaces it with answer analysis)
- **Turn detection retunes mid-session**: loose (2.2s) while you think, baseline (1.2s) once you answer
- **8s silence** → the agent calmly nudges once (`reply.create`)
- **Barge-in** flushes audio AND stale tool results

## The Day 1 test protocol

With a session live on `/harness.html`, run each scenario out loud, press **Space** after
each turn. The label auto-advances through:

`normal ×5 · short · long · silence · interruption · vocab · noise · wifi`

Every run records four timestamps:

| Stamp | Meaning |
|-------|---------|
| **T0** | user turn start |
| **T1** | final user transcript received (`transcript.user`) |
| **T2** | first agent audio chunk (`reply.audio`) — the "feels instant" number |
| **T3** | agent audio end (`reply.done`) |

Every turn prints `⏱ first audio in N ms (T2−T0)` and `⏱ reply heard in N ms (T3−T0) — gate GREEN/YELLOW/RED` live in the transcript, so latency is visible even outside the harness.

**Primary metric: T3 − T0** (median of ≥5 clean runs; silence and interrupted runs excluded).

## 🚦 Decision gate

| Verdict | Median T3−T0 | Action |
|---------|--------------|--------|
| 🟢 GREEN | ≤ 1500 ms | Continue full adaptive architecture |
| 🟡 YELLOW | ≤ 2500 ms | Optimize prompts / model / output length |
| 🔴 RED | > 2500 ms | Do not continue blindly — change the architecture |

## Credit discipline (free tier, no card)

- Sessions hard-capped (`MAX_SESSION_SECONDS=180`, client auto-ends at the cap)
- Single-use tokens, short TTL
- **`session.end` sent before every close** — including `pagehide` — so the 30-second
  billable resume window is never paid
- Test batches of 5, short sessions, no idle streaming
- `/api/usage` shows tokens minted + sessions started at a glance

## Demo Safe Mode

If live fails during the demo: press **Esc** (manual trigger — the most reliable, rehearsed
option). The recorded session replays in the identical UI, paced like the real thing,
**0 credits**. The judge never knows unless we tell them.

## Verification

```bash
npm run check   # parse-checks every JS file (no network, no side effects)
```

## The pitch line

> "We're not asking an LLM whether the answer sounds impressive. We're checking whether
> the answer contains the evidence required by the question."

*(that's Day 4 — but the rubrics exist already, written tonight, for free)*
