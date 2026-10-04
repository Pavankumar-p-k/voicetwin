# VoiceTwin — Adaptive Voice Interviewer

> An AI interviewer that listens to your answer and fights back: it challenges
> weak answers, interrupts naturally, and adapts in real time.

Built on the [AssemblyAI Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api)
(one WebSocket for STT + turn detection + interruption + LLM + TTS).

## How it works

```
MIC → browser AudioWorklet (24 kHz PCM16) → wss://agents.assemblyai.com/v1/ws
                                           ← agent audio → SPEAKER
              ↑ temporary token                     ↑
              └── server mints GET /api/voice-token └── T0..T3 timestamps → latency store
```

1. Describe **one project you built** on the landing page (stack, your role, one hard decision).
2. The interviewer speaks first and drills into *your* project — architecture, tradeoffs, failures, numbers.
3. Every answer is scored against a pre-written 5-point evidence rubric. No vibe scores.
4. End the interview for a full report: score, per-question graphs, weakest area, fix list — plus a Q&A box over your own report.

## Features

- **Project-aware interviews** — every question is generated from your project description, not a generic bank
- **Barge-in** — interrupt the agent mid-sentence; stale audio and tool calls are flushed
- **Pressure ladder (1–4)** — vague answers raise the heat, specific answers relax it
- **Evidence-based scoring** — deterministic detectors per rubric point (spoken numbers count, denied claims don't)
- **Targeted practice loop** — re-drill your weakest question, up to 3 attempts, before → after delta
- **Live + Safe Mode** — `Ctrl+Esc` from anywhere jumps to a zero-credit recorded fallback in the identical UI
- **Report graphs** — canvas-drawn per-question bars and specificity trend, plus "ask about your report" Q&A

## Quick start

```bash
cd voicetwin
npm install             # installs ws
cp .env.example .env    # paste your ASSEMBLYAI_API_KEY (free tier, no card)
npm start               # http://localhost:5000
```

| URL | Purpose |
|-----|---------|
| `/` | Landing — describe your project, pick difficulty, start |
| `/interview.html` | The voice interview + results report |
| `/practice.html` | Targeted re-drill of your weakest question |
| `/safe.html` | Demo Safe Mode fallback (`Ctrl+Esc` from anywhere) |
| `/console.html`, `/harness.html` | Dev-only voice console + latency harness (see below) |

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | status, voice config, `keyConfigured` |
| `GET /api/voice-token` | single-use AssemblyAI token (key never reaches the browser) |
| `POST /api/interview/start` | `{ projectDescription, mode }` → question + system prompt + tools |
| `POST /api/interview/answer` | score one answer → pressure, analysis, rubric, follow-up |
| `POST /api/interview/next` | advance (freezes the rubric score first) |
| `POST /api/interview/end` | `{ interviewId }` → full evidence report |
| `POST /api/practice/start|answer|end` | coaching loop |
| `GET /api/usage`, `GET /api/latency/summary` | credit + latency introspection |

No accounts, no login — the interview is project-first and open.

## Configuration (`.env`)

| Key | Default | Notes |
|-----|---------|-------|
| `ASSEMBLYAI_API_KEY` | — | required ([free tier](https://www.assemblyai.com/), no card) |
| `PORT` | `3000` | server port |
| `MAX_SESSION_SECONDS` | `180` | hard session cap (min 60) |
| `TOKEN_EXPIRES_SECONDS` | `300` | token redemption window |

## Project structure

```
server/            token minting, interview/practice engines, rubric scorer,
                   answer analysis, latency store — zero frameworks
public/            landing, interview app, voice-client (WS + mic + tools),
                   practice, console, harness, safe mode
data/questions.json  8 questions + 5-point evidence rubrics
tools/             syntax-check, latency-test, score-accuracy-test
ui-library/        standalone reusable theme library (base.css + theme skins)
```

## The interview loop

```
browser                    our server                 AssemblyAI
   │ POST /api/interview/start │                            │
   │ ← question + prompt + tools                            │
   │ session.update (prompt+tools+greeting) ────────────→ │
   │ ←──────────── session.ready + greeting audio            │
   │ ← input.audio ──────────────→ STT + neural turn detect  │
   │ ← tool.call: check_answer / next_question               │
   │ POST /api/interview/answer (pressure + rubric eval)     │
   │ tool.result → agent speaks next line ← reply.audio ──── │
```

- **Turn detection** retunes mid-session: loose (2.2s) while you think, baseline (1.2s) once you answer.
- **Silence nudge** after 12s, max twice per question — speaks only, never re-asks.
- **Start-spam safe**: double-clicks can't stack sessions; stale ones auto-retire server-side.

## Scoring: evidence, not vibes

`server/rubric-scorer.js` checks each answer against the question's 5 rubric
points with deterministic detectors — every ✓/✗ traces to a signal you said:

- text normalization (fillers out, *"fifty percent"* → 50%)
- negation guard (*"we never measured"* earns nothing)
- cumulative credit within a question — evidence stays earned across follow-ups

`server/answer-analysis.js` separately scores specificity 0–10 (technical
depth, metrics, first-person contribution, hedging) and picks the follow-up.
`npm run` the accuracy probe any time:

```bash
node tools/score-accuracy-test.mjs   # 6 checks: strong/vague/negated/spoken-number
```

## Credit discipline (free tier, no card)

- Sessions hard-capped; client auto-ends at the cap
- Single-use tokens, short TTL
- `session.end` sent before every close (incl. `pagehide`) — the 30-second billable resume window is never paid
- `/api/usage` shows tokens minted + sessions started

## Deploy

**Render (recommended).** The interview API keeps live session state in memory,
so it needs one long-lived Node process. Render gives exactly that:

1. New → Web Service → select this repo (or use `render.yaml` blueprint).
2. Build `npm install`, start `npm start`.
3. Set `ASSEMBLYAI_API_KEY` in Environment. Done — frontend and `/api/*` share one origin.

**Vercel.** Static files + API functions work, but serverless functions are
stateless: an interview started on one invocation may hit a fresh one on the
next call. For reliable multi-turn interviews, prefer Render.

If you still deploy on Vercel and see `404 NOT_FOUND` on `/api/*`, it is the
platform router, not the app (verified: the function loads and answers
`/api/health` → 200). Checklist:

1. Project **Root Directory = repo root** (where `package.json` lives — not `public/`).
2. Output Directory = `public` (already set in `vercel.json` — don't override it).
3. Environment → `ASSEMBLYAI_API_KEY` set for Production.
4. Redeploy after changing settings (old builds stay broken).

## Developer pages

`console.html` and `harness.html` (latency protocol + decision gate) are
dev-only: they redirect to `/` unless unlocked via `Ctrl+Shift+D` on the
landing page or `?dev=1`. The latency gate: median T3−T0 ≤ 1500ms GREEN,
≤ 2500ms YELLOW, above RED.

## Verification

```bash
npm run check                 # parse-checks every JS file, no network
node tools/score-accuracy-test.mjs   # scoring accuracy probe
```

## The pitch

> "We're not asking an LLM whether the answer sounds impressive. We're checking
> whether the answer contains the evidence required by the question."
