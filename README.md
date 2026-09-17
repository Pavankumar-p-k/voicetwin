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

## Evidence-based scoring (Day 4)

- **`server/rubric-scorer.js`** — deterministic detectors for each question's 5 rubric
  points (scene, personal role, bottleneck, root cause, measurable result, …).
  No LLM: every ✓/✗ is traceable to a named regex/detector in the source.
- Scoring is **cumulative** within a question — evidence earned on the first answer
  stays credited when the agent pushes for more.
- When evidence is missing, the tool result names the **exact demand** to speak, in
  rubric order: *"I'm looking for your specific contribution."*
- `POST /api/interview/end` freezes per-question scores and returns the **report**:
  evidence %, per-question X/5, weakest question + its missed points — the UI's
  INTERVIEW COMPLETE panel and PRACTICE NOW button (Day 5's before/after loop) run off it.

## The coaching loop (Day 5)

```
INTERVIEW  →  FIND WEAKEST AREA  →  TARGETED PRACTICE  →  REPEAT QUESTION  →  COMPARE
                                     (report.weakest)     same 5-point rubric   BEFORE → AFTER
```

- **`server/practice-engine.js`** — `POST /api/practice/start` seeds BEFORE from the
  Day 4 report's weakest question (its missed points become the target list).
- The coach re-asks the SAME question over voice and scores each attempt with the
  SAME deterministic rubric scorer — up to 3 attempts.
- Evidence is **cumulative across attempts**: a point earned in any attempt stays
  earned, so a question is never re-demanded after it was answered.
- The agent speaks each missing-evidence demand verbatim (`check_attempt` tool),
  and `end_practice` returns the measurable: **before X/5 → after Y/5 (Δ)**.
- The `/practice.html` panel shows it exactly as the pitch promises:

```
BEFORE      →  AFTER
██░░░  2/5     █████  5/5      ↑ +3
```

- `PRACTICE NOW` on the interview report carries the report via `sessionStorage`
  and starts practice on the weakest question automatically.

## Demo polish (Day 6)

- **Landing page** (`/`) — "INTERVIEWER THAT FIGHTS BACK", the demo loop, and the
  three judge-facing claims with real examples. The Day 1 voice console lives at
  `/console.html`; the full page set: landing · console · harness · interview ·
  practice · safe mode. `Esc` jumps to Safe Mode from any page.
- **Mic waveform** on the interview screen — 18 bars driven by RMS levels from the
  AudioWorklet (~80ms cadence, same port as the PCM stream, no extra audio nodes).
- **Pressure meter** — four labeled segments (FRIENDLY → SPECIFIC → CHALLENGING →
  PRESSURE), colored green → red as the level climbs.
- **Results stats** — the evidence report now also shows filler-word, vague-answer,
  and incomplete-answer counts, aggregated from the same deterministic signals.

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

## Demo hardening (Day 7)

Failure-hunt results against a live server — fixes shipped same day:

| Test | Scenario | Result |
|---|---|---|
| A | Normal interview | ✅ verified live (Day 1–6 sessions) |
| B/C | Interruption both directions | ✅ barge-in flushes audio + stale tool results (seen in real session log) |
| D | Bad Wi-Fi / socket drop | ✅ FIXED — dropped WS no longer bricks Start; mic stops, state clears, press Start to rejoin |
| E | Technical vocabulary | ✅ "blackbody", "photoelectric effect" transcribed correctly in real session |
| F | Very long answer (2400 words) | ✅ 4/5 evidence, no hang |
| G | Silence | ✅ 8s nudge, once, calm |
| H | Gibberish answer | ✅ pressure 2, spec 0, clean demand — no 500 |
| I | Browser refresh | ✅ FIXED — idle ghost sessions swept after 30 min; reconnect starts a fresh interview |
| J | API failure | ✅ bad JSON now 400 (was 500); invalid key surfaces AssemblyAI's message verbatim via 502 |

### Day-of demo runbook

1. `npm run dev` the night before; verify `/` loads and `/api/health` says `keyConfigured: true`.
2. Screenshot the dashboard balance; note remaining Voice Agent minutes.
3. One warm-up interview (2 min max), then stop. No feature changes from here.
4. **Rehearse the fallback switch once**: start an interview, hit `Esc` mid-answer,
   land on Safe Mode, play the replay. You should be able to do it in under 5 seconds,
   without narrating panic.
5. If the live session dies mid-demo: press `Esc`, Safe Mode is already standing by.
   The judges see the same UI, the same report, the same story.

## The 3-minute judge demo (speaker notes)

Timings assume the agent is already configured and Chrome is open on the landing
page. Total talk time: ~2:30, leaving ~0:30 of buffer.

| ⏱ | Do | Say |
|---|---|---|
| 0:00–0:20 | Landing page | "Most AI interviewers just ask the next question. Ours listens to your answer and fights back. Watch." → click **Start an interview** |
| 0:20–0:45 | Interview starts, agent asks Q1 | Answer **badly on purpose**: *"I built a React application."* — then stop talking |
| 0:45–1:10 | The differentiator | The agent demands the missing evidence — **"What part of that did you personally build?"** Point at the pressure meter climbing and the evidence checklist filling in. *"That demand isn't an LLM opinion — it's a missing point from a pre-written rubric."* |
| 1:10–1:40 | Barge-in | While the agent is mid-sentence, **interrupt it** and answer properly: *"I built the seat-map myself — websockets instead of polling, p95 from 2s to 200ms."* The agent stops instantly and adapts. *"Interruption handling is the hardest part of voice AI. It just worked."* |
| 1:40–2:05 | End → report | **End interview.** The report shows evidence %, per-question bars, weakest question — plus filler/vague/incomplete counts. *"We don't ask an LLM whether the answer sounded impressive. We check whether the evidence the question requires is actually there."* |
| 2:05–2:30 | PRACTICE NOW → before/after | One practice attempt on the weakest question, then show **BEFORE 2/5 → AFTER 5/5, ↑+3**. *"Not a score — an improvement you can verify. The same engine trains salespeople, students, support agents."* |
| If it breaks | **Esc** | Safe Mode replays a recorded session in the identical UI. Nobody has to know unless you tell them. Rehearse this switch — it's the whole trick. |

**Do not** do live: sign-ups, resume upload, long conversations, feature tours.
One bad answer, one pushback, one number, one before/after. That's the product.
