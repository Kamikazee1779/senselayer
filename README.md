# SenseLayer

> Recover the current plan, its stated reason, and what needs your response.

SenseLayer is a Silent Specs accessibility prototype for a Deaf or hard-of-hearing student in a small project meeting. When the student looks away from captions to check code, the group can change plans. **I MISSED THAT** helps them re-enter without reconstructing the whole transcript.

## Experience

- **What changed:** current decisions, before/after changes, and an explicitly stated reason when available.
- **Needs you:** personal requests, with seeing a task kept separate from completing it.
- **Still open:** relevant unanswered questions.
- A stable recovery panel while the conversation continues, with new updates indicated separately.
- Sources available on demand; an interpretation is inspectable, not guaranteed correct.
- Readable text, keyboard access, controllable transcript scrolling and quiet visual attention.

Text and explicit direct calls are accepted without waiting for semantic AI. Slow or failed interpretation does not remove accepted captions or stop microphone capture. The UI reports analysis progress and offers retry.

The recovery interval starts at the last acknowledged catch-up. SenseLayer does not infer when someone looked away.

## Run

Requirements: Node.js 22+, pnpm 11.25.0, and Chrome for the microphone/browser test suite.

```sh
pnpm install
pnpm dev
```

Frontend: http://127.0.0.1:5173 — backend: http://127.0.0.1:3001.

If this machine has Corepack but no `pnpm` command, use:

```sh
corepack pnpm install
corepack pnpm --parallel --filter @senselayer/web --filter @senselayer/server dev
```

By default the semantic provider is deterministic (`mock`), with no key required for replay. Select **Project meeting** in Demo replay to exercise the full recovery scenario. Its narrow grammar is explicitly labelled; it is not a demonstration of free-form language understanding.

For real microphone and semantic interpretation, export configuration in the launching shell:

```sh
export OPENAI_API_KEY='<your-key>'
export CONTEXT_PROVIDER=openai
export SENSELAYER_USER_NAME=Emilio
export SENSELAYER_LANGUAGE=en
pnpm dev
```

No environment-file loader is installed. Never expose keys in `VITE_*`, screenshots or committed files. See [`.env.example`](.env.example) for all settings and [live transcription](docs/live-stt.md) for microphone setup.

## Interchangeable semantic engine

`ContextProvider.propose(input)` is the provider boundary. Implement it and select the adapter in `config.ts` to replace the semantic engine. Current adapters are OpenAI, Claude and deterministic mock. Vendor SDKs and response formats remain inside adapters.

Application code owns IDs, timestamps, source validation, lifecycle, state changes and acknowledgement watermarks. The provider proposes five restricted operations; the reducer validates and applies them.

Speech recognition is a separate integration and currently uses OpenAI WebRTC. Changing `CONTEXT_PROVIDER` changes interpretation, not the speech-recognition service. Both microphone and replay converge at the finalized `TranscriptEvent` boundary.

See [architecture and HTTP contracts](docs/architecture.md) and [OpenAI adapter notes](docs/openai-context.md).

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm replay
pnpm replay fixtures/project-meeting.json
# With the mock development server running:
pnpm --filter @senselayer/web test:ui
```

Automated tests cover slow/failing analysis, source validation, state transitions, task lifecycle, catch-up acknowledgements and provider adapters. Browser tests also exercise the microphone with simulated provider events. Real-provider acceptance and usability with Deaf/HoH participants require separate checks.

See the [130-second demo and fallback](docs/demo.md).

## Scope

TypeScript, React/Vite, Node, Zod and one in-memory session. No new state framework, database or message broker. Restarting clears the session, and multiple browser windows share it.

Live speaker identity is not inferred. English is the rehearsed demo language; the direct-address grammar is conservative and primarily English. Model interpretation and speech recognition can be wrong. Haptics, wearables, environmental sound and parallel conversation reconstruction are future work.
