# SenseLayer foundation

This repository implements the foundation and context engine for the BAINSA “I Missed That” challenge. State is local to one Node process and disappears on restart. The engine includes an optional Claude adapter; it requires no API key by default. Optional [live microphone transcription](live-stt.md) uses OpenAI while replay remains key-free. No database, authentication, or Docker is required.

## Run

Use Node 22+ and pnpm 11.25.0 (the version pinned in package.json).

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm replay
```

`dev` runs Vite on http://127.0.0.1:5173 and the server on http://127.0.0.1:3001. Vite proxies `/api/*` to the server without the `/api` prefix. `build` builds the frontend; the backend runs TypeScript with `pnpm --filter @senselayer/server start`. Shared source is consumed directly by Vite and tsx; no shared build step is needed.

## Ownership

- `packages/shared/src/contracts.ts`: shared Zod schemas and inferred TypeScript types. Coordinate contract changes between Engine and UI work.
- `apps/server/src/state.ts`: finalized transcript boundary, serialized semantic processing, deterministic reducer, transcript/change logs and catch-up watermark. The foundation's synchronous `ingest` callback remains for reducer compatibility tests and refuses to run while async work is queued.
- `apps/server/src/provider.ts`: `ContextProvider.propose` extends the foundation callback to sync/async proposals over copied state, transcript, `new_events`, and configured user names. The default deterministic provider has a deliberately narrow offline grammar.
- `apps/server/src/vocative.ts`: exact configured-name/alias detector. Only this application path sets `explicit_address: true`; semantic providers cannot trigger interrupts.
- `apps/server/src/anthropic.ts` and `config.ts`: optional Claude Messages adapter and environment configuration. Provider output is untrusted and must pass the same reducer validation.
- `apps/web`: UI work consumes `@senselayer/shared` and the documented HTTP API.
- `fixtures`: the original three golden reducer fixtures remain unchanged. `engine-replay.json` contains transcript input only, with no semantic operations. `pnpm replay` processes it via `finalize` → `ingestFinalized`, the same boundary used by HTTP and intended for future STT. The replay module cannot read fixture-supplied operations.
- `tests`: fixture replays, contract invariants, lifecycle rules and HTTP integration checks.

The five allowed delta operations remain `set_topic`, `add_decision`, `open_question`, `resolve_question`, and `add_user_request`. Every operation must cite valid transcript IDs and at least one ID in `new_events`. Old citations are allowed only when accompanied by a new citation. The optional transcript argument to `parseDeltaOps` enables this check; without it, the foundation's stricter current-batch-only behavior is preserved. Evidence displayed in catch-up is copied from the actual transcript log, never quoted by the model.

Models propose text, evidence IDs and existing entity references. Two optional reference fields extend existing operations: `add_decision.supersedes_id` and `add_user_request.question_id`. Strict schemas reject model-supplied new IDs, timestamps, lifecycle fields, quotations and arbitrary patches. Application code assigns monotonic IDs and clock timestamps, reduces onto a copy, and commits only after the semantic batch succeeds. Failed batches may consume IDs but cannot partially commit semantic state.

Question status is derived from the existing `resolution` field (`null` means open); there is no dropped state. A correction retains the old decision and sets its application-owned `superseded_by`. Request status is derived by `requestStatus`: `resolved_at` means resolved, otherwise `acknowledged_at` means acknowledged, otherwise active. Resolving a related question also resolves its active requests. Acknowledged requests stay acknowledged. Same-batch question/request pairs with identical text and overlapping evidence are linked by application code without invented IDs. Repeated normalized topic/decision/open-question/request content does not create duplicate records; meaningful punctuation is preserved.

## Processing and configuration

`TranscriptEvent` means a finalized event. The existing HTTP body stays `{ events: [{ speaker, text }] }`; application code stamps IDs/timestamps. Strict schemas reject partial/finality metadata rather than silently reasoning over it. A future STT adapter must drop all partial callbacks and pass only finals into `finalize`/`ingestFinalized`. Speaker labels are supplied data, never inferred identities. Re-ingesting an identical finalized event ID is idempotent; changing its content is rejected.

The application detector checks exact names/aliases after case/punctuation normalization. It conservatively accepts standalone names and sentence-leading vocatives such as `Hey Emilio` and `Emilio, can you…`; third-person mentions and assignments never interrupt. It creates an ordinary user request marked `explicit_address` immediately, even while semantics waits. Such requests are readable through `GET /state`; `POST /transcript` also returns their IDs in `attention`. No streaming transport is introduced. Failed semantic processing does not undo an already detected explicit address.

Each session serializes provider calls. Semantic batches contain one finalized event so later events can reference entities created by earlier events, even inside one HTTP request. `lastAnalyzedSeq` counts successfully applied transcript events, including valid empty proposals. On provider/validation failure it remains at the last committed event; the transcript suffix stays available for `analyze()` retry or the next submission. A multi-event request can have a successfully committed prefix. Reset invalidates in-flight results before they can commit, clears logs/cursors/state, and does not recycle acknowledgement IDs.

Environment variables (set in the launching shell):

- `CONTEXT_PROVIDER=mock` (default) or `claude`.
- `SENSELAYER_USER_NAME=Emilio` (default); `SENSELAYER_USER_ALIASES` is a comma-separated list of explicit aliases.
- Claude mode requires both `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. There is no automatic fallback that hides configuration/provider errors. The adapter uses native fetch, a 15-second timeout, and validates complete JSON responses. It follows the [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create).

The offline provider recognizes `Topic: …`, `Decision: …`, `We decided to …`, `We agreed to …`, `Correction: <old text> => <new text>`, `Question: …?`, and `Answer: <question text> => <answer>`. Explicit user questions and `<configured name> will …` assignments are also supported. Other text yields no changes. This is a deterministic demo grammar, not general natural-language understanding. It does not infer emotion, intent, or identity. Claude proposes only the same five operations; it cannot move cursors, mutate state, or mark interrupts.

## HTTP contracts

All responses are JSON. Successful routes return 200. Invalid bodies return 400; missing acknowledgement targets and unknown routes return 404; failed semantic processing returns 503 with finalized events retained for retry; unexpected failures return 500. Errors have `{ "error": "..." }`. Empty-body POSTs accept `{}` or no body. Exact response schemas/types live in `packages/shared`.

| Route | Request | Response |
| --- | --- | --- |
| `POST /transcript` | `{ events: [{ speaker, text }] }` (nonempty, finalized only) | `{ new_events: TranscriptEvent[], state: ContextState, attention: string[] }` |
| `GET /state` | None | `ContextState` |
| `POST /catchup` | `{}` | `{ id, created_at, state, acknowledged_at, from_seq, upper_bound, changes }` |
| `POST /catchup/ack` | `{ catchup_id }` | The catch-up with `acknowledged_at` populated |
| `POST /attention/:id/ack` | `{}`; ID is an existing `UserRequest.id` | The user request with `acknowledged_at` populated |
| `POST /reset` | `{}` | Empty `ContextState` |

Catch-up is deterministic: `changes` contains committed material changes with `from_seq < seq <= upper_bound`. It also retains the foundation's immutable `state` snapshot. The change sequence is separate from transcript sequence: delayed semantic results must remain unseen even if their transcript arrived before the user opened a panel. Pressing catch-up never moves the watermark. Acknowledging a saved catch-up advances it to `max(current, that catchup.upper_bound)`; unknown IDs cannot advance it and old acknowledgements cannot move it backward. Later changes stay available for the next catch-up. Request acknowledgement is independent and does not move the catch-up watermark.
