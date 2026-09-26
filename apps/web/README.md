# SenseLayer conversation UI

Run `pnpm install` and `pnpm dev` at the workspace root. Open http://127.0.0.1:5173.

The default view is a transcript with one catch-up action. Active backend user requests appear one at a time, with exact request text and an independent **Got it** acknowledgement. Resolved/acknowledged requests disappear. Catch-up uses the backend's bounded `changes`, `from_seq` and `upper_bound`, groups current entities semantically, and omits superseded decisions. **I'm caught up** acknowledges only that catch-up ID. Failed acknowledgements keep their card/panel visible.

Evidence is displayed only from actual `TranscriptEvent` records returned by `/transcript` or embedded in catch-up changes. Missing events are identified as unavailable; semantic text is never substituted for a quotation. The transcript does not auto-scroll away from a reader who has scrolled up.

## Replay and verification

Expand **Demo replay**, select a fixture, and start. Starting replay resets the backend's shared in-memory session. Pause/resume and single-batch stepping are available. All fixture input goes through `POST /transcript`; the UI never imports or applies fixture semantic proposals. The full demo uses `fixtures/engine-replay.json` and the default deterministic provider (`CONTEXT_PROVIDER=mock`, default user Emilio). The three foundation fixtures are also selectable; their natural-language text may produce fewer semantic updates with this provider's intentionally narrow grammar.

With `pnpm dev` running:

```sh
pnpm typecheck
pnpm build
pnpm --filter @senselayer/web test:ui
```

Browser tests use installed Google Chrome in headless mode. Set `UI_BROWSER=msedge` to use installed Edge, or `UI_BASE_URL` to change the frontend URL. Tests reset the demo backend. They cover real replay, transcript, evidence, supersession, request resolution, catch-up/watermark acknowledgement and reset; mocked contract responses cover acknowledgement failures, concurrent updates, focus trapping/restoration, keyboard activation and narrow layout. Screenshots are generated under ignored `apps/web/dist/qa` (a subsequent build clears them).

## Backend boundaries

- This UI consumes the Engine work's existing schemas, including `requestStatus`, request resolution, supersession and catch-up changes; it does not change shared contracts or reducer logic.
- `/state` is polled every two seconds. The API has no transcript subscription/history route, so the transcript contains only batches submitted by this browser session. Catch-up evidence can still be inspected after a reload when supplied by the server. Evidence outside those available records is explicitly unavailable.
- The subtle unseen count compares semantic state against snapshots acknowledged in this browser session. The catch-up panel itself uses the server watermark. After reload or another client's acknowledgement, the hint may overcount until this browser acknowledges a catch-up; `/state` does not expose the watermark.
- The server does not expose raw DeltaOps, provider mode or processing timings. The hidden developer panel displays ContextState, evidence IDs, received transcript, last catch-up changes/watermarks, replay status, last receive time and client-measured round-trip duration.
- Live microphone setup and verification are documented in [live-stt.md](../../docs/live-stt.md). No diarization or local semantic inference is implemented. The microphone label identifies the input, not a speaker.

Native buttons, selects, disclosure controls and a modal dialog support keyboard interaction; the dialog traps Tab, supports Escape and restores focus. A skip link, explicit text statuses, visible focus rings, large transcript text and responsive layout support accessible use without audio or animation.
