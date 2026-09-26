# SenseLayer conversation UI

The UI helps a participant recover a changed plan, an explicit reason and pending personal requests. It consumes domain contracts only; it has no dependency on a semantic provider SDK.

## Interaction

**I MISSED THAT** opens a stable, nonmodal recovery panel. The live conversation and replay continue while it is open. New semantic changes are indicated separately; refreshing is explicit. Closing does not acknowledge anything. **I’m caught up** acknowledges the captured snapshot only, leaving later changes available.

Recovery groups are **What changed**, **Needs you**, and **Still open**. Decisions show before/after when available, and a reason only when explicitly extracted with sources. Exact transcript sources are progressively disclosed. Earlier open questions and the interval history remain accessible.

**Seen** silences an attention highlight; an unfinished task or unanswered question remains pending. **Completed** closes a task. A bare call can be dismissed, and a later call can return. Users can adjust text size and attention highlighting. Incoming content does not steal focus or force transcript scrolling if the reader has scrolled up.

Processing indicators distinguish pending analysis, failure and completed coverage. A model failure does not remove received words or stop capture; **Retry context** retries the retained transcript. Speech connection or HTTP text-submission errors remain visible.

## Data flow

The UI polls `GET /session` once per second for state, saved transcript, processing status, cursors and user identity. Monotonic revisions prevent an older response from replacing newer state. Finalized speech ingestion is independent of UI actions and does not wait for semantic interpretation.

The transcript comes from the retained server session, so reloading the page restores saved words. The session is shared and in memory; restarting the backend clears it. Name and speech language shown in the UI come from server configuration.

## Development and tests

Run the frontend and backend from the workspace root; open http://127.0.0.1:5173. Choose the project-meeting replay for the full recovery scenario.

```sh
pnpm typecheck
pnpm test
pnpm build
# With the mock development server running:
pnpm --filter @senselayer/web test:ui
```

Browser tests use installed Chrome in headless mode. `UI_BROWSER=msedge` selects Edge and `UI_BASE_URL` selects another frontend URL. Tests reset the local demo session. Screenshots are saved under ignored `apps/web/dist/qa`; a later build clears them.

Automated browser tests and simulated microphone/provider events do not establish physical microphone recognition quality, model accuracy or usefulness for Deaf/HoH users. See [the demo runbook](../../docs/demo.md) for separate real-provider and usability checks.
