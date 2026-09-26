# SenseLayer

> **Captions tell you what was said. SenseLayer helps you understand what changed — and when the conversation needs you.**

SenseLayer is an accessibility prototype built for the **BAINSA “I Missed That” challenge**. It explores a simple idea: captions are useful, but they still demand continuous visual attention. If a Deaf or hard-of-hearing user looks away, takes notes, works on another screen, or loses the thread for a few seconds, the problem is not only missing words — it is missing **conversation state**.

SenseLayer focuses on two questions:

1. **Re-entry** — *What materially changed while I was not following?*
2. **Relevance** — *Does the conversation need my attention right now?*

The hackathon prototype turns live conversation into a small, evidence-grounded state model and surfaces only the changes that matter.

---

## What it does

### `I MISSED THAT`
Instead of generating a generic rolling summary, SenseLayer keeps track of material state changes such as:

- explicit decisions;
- open questions;
- resolved questions;
- direct requests to the user;
- current topic.

When the user asks **I MISSED THAT**, the system returns only the important changes since the last acknowledged catch-up.

### Direct-attention routing
SenseLayer deliberately distinguishes **talking about the user** from **talking to the user**.

```text
“I thought Emilio was doing it.”      → no interrupt
“Emilio can handle deployment.”       → no interrupt
“Could Emilio handle deployment?”     → no interrupt
“Emilio, can you handle deployment?”  → direct attention
```

This is intentionally conservative: a false interrupt is worse than staying silent on an ambiguous phrase.

### Provenance
Semantic changes are grounded in transcript-event IDs. The UI can trace a decision, question, or request back to the exact transcript evidence that produced it.

---

## Product vision

The prototype is intentionally smaller than the long-term idea.

The broader vision is a **multimodal accessibility layer** between live conversation and the user:

```text
Conversation
    ↓
Speech perception
    ↓
Conversation state
    ↓
Relevance routing
    ├── visual context
    ├── haptic interrupt
    └── future wearable interfaces
```

The goal is not to make the user watch a better transcript. It is to route the right information through the right modality at the right time.

For the hackathon we deliberately exclude emotion detection, sarcasm, inferred psychology, speaker-identity dependence, and generic summarization. The MVP stays focused on explicit, defensible events.

---

## Architecture

```text
Microphone / Replay
       ↓
Realtime transcription
       ↓
finalized TranscriptEvent
       │
       ├──────────────→ deterministic explicit-vocative detector
       │                           ↓
       │                    immediate attention
       │
       └──────────────→ ContextProvider
                                  ↓
                              DeltaOps
                                  ↓
                           strict validation
                                  ↓
                       deterministic reducer
                                  ↓
                           ContextState
                                  ↓
                    catch-up / priority UI
```

The model **does not own application state**.

AI providers may propose only five semantic operations:

- `set_topic`
- `add_decision`
- `open_question`
- `resolve_question`
- `add_user_request`

Application code owns IDs, timestamps, lifecycle transitions, state mutation, evidence validation, acknowledgement, catch-up watermarks, and interrupt routing.

Every semantic operation must cite valid transcript evidence, including at least one event from the current new-events batch.

See [`docs/architecture.md`](docs/architecture.md) for the full state and lifecycle contract.

---

## Current prototype

The repository currently includes:

- React + Vite + TypeScript frontend;
- Node + TypeScript backend;
- shared Zod contracts;
- live microphone transcription through OpenAI realtime transcription;
- deterministic replay fallback;
- provider-agnostic semantic context engine;
- deterministic offline/mock provider;
- OpenAI context provider;
- Anthropic / Claude adapter;
- explicit-vocative fast path;
- deterministic catch-up watermark;
- priority-card acknowledgement lifecycle;
- transcript provenance;
- automated reducer, API, provider, lifecycle, and replay tests.

State is intentionally in-memory for the hackathon. There is no database, authentication layer, Redis, or Docker requirement.

---

## Quick start

### Requirements

- **Node.js 22+**
- **pnpm 11.25.0**
- Chrome is recommended for the live microphone demo

```bash
git clone https://github.com/Kamikazee1779/senselayer.git
cd senselayer
pnpm install
```

### Offline / deterministic mode

No API key is required:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
```

The backend runs at `http://127.0.0.1:3001`.

### Live microphone + OpenAI semantic provider

Set environment variables in the shell that launches the server.

PowerShell:

```powershell
$env:OPENAI_API_KEY = '<your-key>'
$env:CONTEXT_PROVIDER = 'openai'
$env:OPENAI_CONTEXT_MODEL = 'gpt-5.6-terra'
pnpm dev
```

Then open `http://127.0.0.1:5173`, press **Start microphone**, grant microphone access, and speak normally with a short pause between utterances.

> Never expose API keys through `VITE_*` variables or commit real credentials to the repository.

### Claude context provider

```powershell
$env:CONTEXT_PROVIDER = 'claude'
$env:ANTHROPIC_API_KEY = '<your-key>'
$env:ANTHROPIC_MODEL = '<model-id>'
pnpm dev
```

The provider boundary is intentional: changing semantic providers does not change the reducer, state contracts, replay path, UI, or attention logic.

See [`.env.example`](.env.example), [`docs/live-stt.md`](docs/live-stt.md), and [`docs/openai-context.md`](docs/openai-context.md).

---

## Useful commands

```bash
pnpm dev        # frontend + backend
pnpm typecheck  # TypeScript validation
pnpm test       # automated tests
pnpm build      # frontend production build
pnpm replay     # deterministic replay through the real ingestion boundary
```

For the browser microphone/UI suite:

```bash
pnpm --filter @senselayer/web test:ui
```

---

## Demo flow

A compact end-to-end demo:

1. Start the microphone.
2. Ask: **“What should we get for dinner, Chinese or burritos?”**
3. Say: **“I think Chinese could be good.”**
4. Press **I MISSED THAT** → the question remains open; no decision is invented.
5. Say: **“Actually, let’s go with burritos.”**
6. Press **I MISSED THAT** → a burrito decision appears and the question resolves.
7. Say: **“I thought Emilio was going to pick them up.”** → no direct-attention alert.
8. Say: **“Emilio, can you go pick them up?”** → direct-attention path + priority request.

See [`docs/demo.md`](docs/demo.md) for the full demo and fallback plan.

---

## Repository layout

```text
apps/
  server/       context engine, state, providers, API, STT handshake
  web/          product UI and microphone client
packages/
  shared/       shared contracts and Zod schemas
fixtures/       deterministic replay / semantic fixtures
tests/          contracts, reducer, provider and API tests
docs/           architecture and provider documentation
```

---

## Design principles

- **Quiet by default. Relevant when needed.**
- **Explicit evidence beats inference.**
- **Models propose; application code decides.**
- **Catch-up is a state diff, not a generic summary.**
- **Direct attention must be conservative.**
- **Replay and live audio converge at the same finalized-event boundary.**
- **Accessibility should reduce cognitive load, not add another dashboard to monitor.**

---

## Limitations

This is a hackathon prototype, not a production accessibility product.

Current limitations include:

- in-memory single-process state;
- no diarization requirement;
- no persistent user/session storage;
- intentionally conservative direct-address detection;
- live microphone segmentation is sensitive to noisy environments;
- semantic model quality and latency depend on the selected provider;
- the prototype is not a replacement for sign-language interpretation or other accessibility accommodations.

---

## Roadmap

Near-term directions include:

- robust live-demo hardening in noisy rooms;
- phone/watch haptic attention routing;
- richer but still evidence-grounded conversation state;
- improved personalization of attention rules;
- wearable interfaces for non-visual interruption;
- evaluation with Deaf and hard-of-hearing users.

The core principle remains the same: **help the user stay part of the conversation without requiring continuous visual monitoring.**
