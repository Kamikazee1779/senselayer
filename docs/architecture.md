# SenseLayer architecture

SenseLayer helps someone re-enter a project conversation: what changed, the stated reason, and what still needs their response. The application keeps one in-memory session. Restarting the server clears it; this is not a multi-user service.

## Data flow

```text
Microphone / replay
    → finalized TranscriptEvent
    → accept text + detect explicit address → immediate HTTP response
    → ordered semantic queue → ContextProvider.propose(input)
    → validate proposed DeltaOps → deterministic reducer
    → session polling → stable catch-up snapshot
```

The HTTP ingestion response means the text was accepted, not that interpretation is complete. A semantic error retains the text and analysis cursor, is visible in session status, and does not stop microphone capture. Retry analysis without resubmitting speech.

## Replacing the semantic provider

`ContextProvider` in `apps/server/src/provider.ts` is the complete provider boundary:

```ts
interface ContextProvider {
  propose(input: ContextInput): unknown | Promise<unknown>;
}
```

`ContextInput` contains copied domain state, transcript, new events, and configured user identity. Provider output is untrusted. Every provider passes through the same domain validation and reducer.

To add a different engine:

1. Implement this interface in an adapter; keep credentials, SDK types and vendor response formats there.
2. Select the adapter in `config.ts`, alongside `mock`, `openai`, and `claude`.
3. Run shared contract/lifecycle tests plus the adapter's response tests.

The UI, reducer, attention detector and catch-up do not depend on OpenAI. There is no plugin registry, provider inheritance framework, or silent fallback to another model.

Speech recognition is a separate integration. It currently uses OpenAI WebRTC and provider events in the microphone adapter. Switching `CONTEXT_PROVIDER` does not switch speech recognition. Its neutral output boundary is the finalized `TranscriptEvent`; another STT adapter must produce the same events.

## Semantic model

The five operations remain `set_topic`, `add_decision`, `open_question`, `resolve_question`, and `add_user_request`.

- Decisions can include `rationale: { text, event_ids }`. Extract a reason only when the conversation explicitly connects it to the decision. An absent reason is valid.
- Rationale is captured when a decision is created. Enriching an unchanged decision with a reason stated later is deferred; the later words remain in the transcript.
- `add_decision.supersedes_id` links a correction to the previous decision. History remains available for a before/after presentation.
- User requests distinguish `attention`, `question`, and `task`. Only application code creates the immediate attention signal; providers may classify a request as a question or task.
- A provider proposal can enrich an earlier fast-path request from the same transcript event instead of duplicating it.
- Seeing a task does not complete it. An explicit completion action closes it. Accepting a task in conversation is not evidence that it was performed.
- An acknowledged question can still resolve when explicitly answered. Bare attention can be dismissed independently.
- A later direct call can alert again after the earlier call was acknowledged. Re-ingesting the same finalized event ID remains idempotent.

All operations cite real transcript IDs and at least one ID in the current batch. Rationale citations can reference earlier transcript events but must exist in the retained log. Sources displayed by the UI are actual transcript records, not quotations supplied by the model.

These rules protect structure, state and source references. They do not prove semantic truth: a model can still misinterpret a real sentence. Prompt instructions require conservative interpretation and abstention on ambiguity.

## Processing and session state

`GET /session` provides the current semantic state, retained transcript, processing status, change and acknowledgement cursors, user name/language, and a monotonic revision. The UI uses revisions to reject older responses rather than blocking live input during user actions.

Processing reports `ready`, `processing`, or `error`, along with `received_seq`, `analyzed_seq`, `analyzed_at`, and a safe error message. It is transport/session metadata, not part of the model's semantic state.

The existing queue serializes semantic calls. Application code retains ownership of IDs, timestamps, atomic state mutation, deduplication and reset cancellation. A reset invalidates in-flight semantic results; acknowledgement IDs are not recycled.

For command-line replay and engine tests, the awaitable ingestion methods can wait for analysis. HTTP accepts through the same finalized event boundary and returns before semantic completion.

## Catch-up

Catch-up captures an immutable semantic snapshot and upper change bound. Opening or closing it does not move the watermark. Acknowledging a known snapshot advances only to its upper bound; late results and later changes remain available. An old acknowledgement cannot move the watermark backward.

The baseline is the last acknowledged catch-up, not inferred gaze or attention. `from_time` and the captured processing status make this explicit. The first catch-up covers the session so far.

The presentation combines current decisions, before/after context and rationale, relevant pending requests, and unresolved questions. It collapses redundant outcomes and offers exact sources on demand. The conversation and replay continue while the user reads a stable modal. New changes are indicated without rewriting the snapshot.

## HTTP routes

All bodies/responses are JSON. Shared schemas are in `packages/shared/src/contracts.ts`.

| Route | Behavior |
|---|---|
| `GET /session` | Current state, transcript, processing status, cursors, revision and configured user |
| `GET /state` | Semantic state only, retained for existing clients |
| `POST /transcript` | Accept finalized live event or replay batch; return accepted events, immediate state/attention, processing and revision |
| `POST /analysis/retry` | Schedule retained unanalyzed text for retry; return session snapshot |
| `POST /catchup` | Capture a bounded snapshot with processing status and baseline time |
| `POST /catchup/ack` | Acknowledge `{ catchup_id }` without consuming later changes |
| `POST /attention/:id/ack` | Mark a request seen; retain unfinished questions/tasks |
| `POST /attention/:id/complete` | Explicitly complete a request |
| `POST /transcription/session` | Exchange SDP; credentials remain on the server |
| `POST /reset` | Clear the shared session and invalidate old in-flight results |

Invalid input returns 400; unknown resources return 404. Completing a question or bare attention instead of a task returns 409. A failed semantic interpretation after accepted text is reported through processing status, rather than turning accepted speech into an HTTP failure.

## Configuration and verification

See `.env.example`. `CONTEXT_PROVIDER` selects the semantic adapter. `SENSELAYER_USER_NAME`, `SENSELAYER_USER_ALIASES`, and `SENSELAYER_LANGUAGE` configure the user and speech guidance consistently. English is the rehearsed demo language; the conservative direct-address grammar is not a general multilingual classifier.

Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm replay`. With the frontend running, run `pnpm --filter @senselayer/web test:ui`. Browser tests use an isolated mock backend. Real microphone/model acceptance is separate from mocked tests, and usability with Deaf/HoH participants is a separate evaluation again.
