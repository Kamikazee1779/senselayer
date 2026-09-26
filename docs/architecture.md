# SenseLayer architecture

SenseLayer is the working context engine and UI prototype for the BAINSA **“I Missed That”** accessibility challenge.

The system is intentionally small: one Node process keeps in-memory state, one React/Vite client renders the experience, and all semantic changes pass through strict application-owned contracts. No database, authentication layer, Redis, Docker, or persistent session storage is required for the hackathon prototype.

The core product split is:

- **Re-entry** — recover material conversation-state changes after the user misses a segment.
- **Relevance** — detect when the conversation explicitly needs the user now.

## End-to-end flow

```text
Microphone / Replay
       ↓
Realtime STT / finalized fixture events
       ↓
finalized TranscriptEvent
       │
       ├──────────────→ explicit-vocative fast path
       │                       ↓
       │                 immediate attention
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
                catch-up / priority / provenance UI
```

Replay and live microphone input converge at the same finalized transcript boundary. Partial STT output is never allowed into semantic reasoning.

## Run

Use Node 22+ and pnpm 11.25.0.

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm replay
```

`pnpm dev` runs:

- Vite frontend: `http://127.0.0.1:5173`
- Node backend: `http://127.0.0.1:3001`

## Ownership boundaries

### Shared contracts

`packages/shared/src/contracts.ts`

Contains shared Zod schemas and inferred TypeScript types. Contract changes affect both Engine and UI and should be coordinated.

### Deterministic state engine

`apps/server/src/state.ts`

Owns:

- finalized transcript ingestion;
- serialized semantic processing;
- reducer application;
- transcript and change logs;
- catch-up watermark;
- acknowledgement lifecycle;
- retry cursor (`lastAnalyzedSeq`);
- reset invalidation.

Application code, not the model, owns all IDs, timestamps, lifecycle fields, state mutation, and watermarks.

### Provider boundary

`apps/server/src/provider.ts`

`ContextProvider.propose(...)` receives copied current state, recent transcript context, explicit `new_events`, and configured user identity. Providers may propose semantic operations only.

Available modes:

- `mock` — deterministic offline provider;
- `openai` — structured semantic extraction through OpenAI;
- `claude` — Anthropic / Claude adapter.

All provider output is untrusted and must pass the same schema and evidence validation before the reducer can apply it.

### Explicit-address fast path

`apps/server/src/vocative.ts`

Checks the configured user name / aliases deterministically after normalization.

Examples:

```text
“I thought Emilio was doing it.”      → no interrupt
“Emilio can handle deployment.”       → no interrupt
“Could Emilio handle deployment?”     → no interrupt
“Emilio, can you handle deployment?”  → explicit address
```

Only application code can mark a request as an explicit-address attention event. Semantic providers cannot trigger the interrupt channel directly.

### Provider adapters

- `apps/server/src/openai.ts` — OpenAI context provider.
- `apps/server/src/anthropic.ts` — Claude context provider.
- `apps/server/src/config.ts` — provider selection and user identity configuration.

### Live microphone path

The browser establishes a transcription-only WebRTC session through the backend. The long-lived API key remains server-side. Completed transcription events become finalized `TranscriptEvent`s and flow through the same ingestion path as replay.

See [`live-stt.md`](live-stt.md).

### UI

`apps/web`

Consumes the shared contracts and backend HTTP API. The normal UI remains intentionally quiet; technical state is separated into developer/debug views.

## Semantic operation contract

Exactly five delta operations are allowed:

- `set_topic`
- `add_decision`
- `open_question`
- `resolve_question`
- `add_user_request`

Every semantic operation must:

1. cite valid transcript-event IDs;
2. cite at least one event from the current `new_events` batch.

Old context may be cited only when accompanied by current-batch evidence.

The model never supplies application-owned IDs, timestamps, lifecycle fields, watermarks, or fabricated evidence quotations.

Provenance shown in the UI is reconstructed from the actual transcript log.

## State lifecycle

### Decisions

Decisions are append-only. Corrections supersede earlier decisions rather than deleting history. Application code owns `superseded_by` relationships.

### Questions

Questions are either open (`resolution == null`) or resolved. There is no inferred `dropped` state.

### User requests

A request is:

- active;
- acknowledged;
- resolved.

Request acknowledgement is independent from catch-up acknowledgement. Resolving a linked question also resolves its still-active request.

### Duplicate protection

Repeated normalized topic, decision, open-question, and request content is prevented from creating duplicate semantic state.

## Processing guarantees

Semantic processing is serialized per session.

`lastAnalyzedSeq` advances only after a provider result has been successfully parsed, validated, reduced, and committed.

On provider failure:

- finalized transcript remains stored;
- the semantic cursor does not advance past the failed event;
- state is not partially committed;
- the same suffix can be retried.

Reset invalidates in-flight semantic results before they can commit.

## Catch-up semantics

`I MISSED THAT` is a deterministic state-change query, not a generic LLM summary.

Opening a catch-up captures an immutable upper bound. Pressing the button does **not** move the watermark.

Only after the user acknowledges with **I'm caught up** does the watermark advance to that saved upper bound.

Changes that arrive while the catch-up panel is open remain unseen and therefore appear in the next catch-up.

Request acknowledgement does not move the catch-up watermark.

## Environment configuration

Set variables in the shell that launches `pnpm dev`.

```text
CONTEXT_PROVIDER=mock | openai | claude
SENSELAYER_USER_NAME=Emilio
SENSELAYER_USER_ALIASES=
```

### OpenAI

```text
OPENAI_API_KEY=<secret>
OPENAI_CONTEXT_MODEL=gpt-5.6-terra
```

`OPENAI_API_KEY` is also used by the live transcription handshake. Never expose it through `VITE_*` variables.

### Anthropic / Claude

```text
ANTHROPIC_API_KEY=<secret>
ANTHROPIC_MODEL=<model-id>
```

There is no silent provider fallback hiding configuration errors.

See [`.env.example`](../.env.example) and [`openai-context.md`](openai-context.md).

## Deterministic provider

The offline provider intentionally recognizes only a narrow grammar such as explicit topics, decisions, questions, answers, corrections, and direct assignments. Other language may yield no semantic changes.

It exists for deterministic replay and fallback, not as a claim of general language understanding.

## HTTP contracts

All responses are JSON.

| Route | Request | Response |
| --- | --- | --- |
| `POST /transcript` | finalized transcript event(s) | new events, current state, attention IDs |
| `GET /state` | none | current `ContextState` |
| `POST /catchup` | `{}` | saved catch-up snapshot + change window |
| `POST /catchup/ack` | `{ catchup_id }` | acknowledged catch-up |
| `POST /attention/:id/ack` | `{}` | acknowledged request |
| `POST /reset` | `{}` | empty state |
| `POST /transcription/session` | SDP offer | SDP answer for live transcription session |

Invalid request bodies return 400-class errors; provider/semantic failures retain finalized transcript for retry and surface as service errors rather than silently corrupting state.

## Design constraints

SenseLayer deliberately avoids:

- emotion inference;
- sarcasm inference;
- psychological interpretation;
- diarization as a core dependency;
- model-owned application state;
- generic rolling summaries;
- hidden evidence generation.

The prototype optimizes for explicit, inspectable, defensible state changes and predictable demo behavior.
