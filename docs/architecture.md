# SenseLayer foundation

This repository is a scaffold for the BAINSA “I Missed That” challenge. It contains no Claude integration, live STT, database, authentication, or polished product UI. State is local to one Node process and disappears on restart.

## Run

Use Node 22+ and pnpm 11.25.0 (the version pinned in package.json).

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`dev` runs Vite on http://127.0.0.1:5173 and the server on http://127.0.0.1:3001. Vite proxies `/api/*` to the server without the `/api` prefix. The frontend only checks the shared state response contract and displays connection status. `build` builds the frontend; the backend runs TypeScript with `pnpm --filter @senselayer/server start`. Shared source is consumed directly by Vite and tsx; no shared build step is needed. Docker is not required.

## Ownership

- `packages/shared/src/contracts.ts`: shared Zod schemas and inferred TypeScript types. Coordinate contract changes between Engine and UI work.
- `apps/server/src/state.ts`: Engine integration boundary, deterministic mutation rules and process-local storage. `ingest` assigns transcript IDs and timestamps before passing a copy of `new_events` to a proposal callback. The default callback returns no operations; HTTP transcript ingestion does not infer meaning yet. The callback is a synchronous fixture/foundation seam; asynchronous model integration is future work.
- `apps/web`: UI work consumes `@senselayer/shared` and the documented HTTP API.
- `fixtures`: three independent replays with input batches, semantic proposals, and complete expected states. Each starts from an empty store with a fixed application clock; IDs in proposals reference application-issued events or existing questions.
- `tests`: fixture replays, contract invariants, lifecycle rules and HTTP integration checks.

The five allowed delta operations are `set_topic`, `add_decision`, `open_question`, `resolve_question`, and `add_user_request`. All require nonempty evidence. `parseDeltaOps` rejects every citation outside the current `new_events` batch, including mixed old/new citations. Structural validation alone is insufficient; the reducer always performs batch validation.

Models propose text, evidence IDs, and (for resolution) an existing question ID. Strict schemas reject model-supplied new IDs, timestamps, lifecycle fields and arbitrary patches. Application code assigns monotonic IDs and clock timestamps, applies operations to a copy, and commits only after the complete batch succeeds. A failed batch may consume IDs but never commits partial state. Question resolution transitions from `null` (open) to a resolution record; unknown or already resolved questions fail. User-request acknowledgements transition from `null` to an application timestamp and are idempotent.

## HTTP contracts

All responses are JSON. Each successful route returns 200. Invalid bodies return 400; missing acknowledgement targets and unknown routes return 404; unexpected failures return 500. Errors have `{ "error": "..." }`. Empty-body POSTs below accept `{}` or no body. All object contracts reject extra fields. Exact response shapes and exported types live in `packages/shared`.

| Route | Request | Response |
| --- | --- | --- |
| `POST /transcript` | `{ events: [{ speaker, text }] }` (nonempty) | `{ new_events: TranscriptEvent[], state: ContextState }` |
| `GET /state` | None | `ContextState` |
| `POST /catchup` | `{}` | `{ id, created_at, state, acknowledged_at }` |
| `POST /catchup/ack` | `{ catchup_id }` | The catch-up with `acknowledged_at` populated |
| `POST /attention/:id/ack` | `{}`; ID is an existing `UserRequest.id` | The user request with `acknowledged_at` populated |
| `POST /reset` | `{}` | Empty `ContextState` |

Catch-up is only an immutable state snapshot, with an independent idempotent acknowledgement; it does not generate a summary or track missed intervals. Attention is an acknowledgement of a user request, not a separate entity. Reset clears transcript events, context and catch-ups. IDs are not recycled during the process lifetime, so stale acknowledgements cannot affect new records. These minimal semantics are the foundation contract, not the full accessibility product.
