# SenseLayer conversation UI

A full-height conversation with two modes: **Demo** starts one extended sample, **Live** starts a fresh conversation when leaving the demo. The bottom-left microphone button toggles capture. Transcript and Summary switch the main reading view. Reset is a small header action.

## Components

- `App.tsx` coordinates the session, polling, demo playback, microphone and catch-up modal. It prevents an old demo request from refilling a new Live session.
- `NotificationDeck.tsx` shows one card at a time, with a counter, previous/next buttons, keyboard arrows and horizontal swipe. A new card does not replace the selected card.
- `notifications.ts` turns active domain state into cards. Green is context, yellow is attention, red requires a direct task with explicit immediate wording in both the request and source. This is a conservative wording rule, not a general urgency classifier.
- `Summary.tsx` displays the plan, explicitly stated reasons, personal requests and unresolved questions. A single Source disclosure combines decision and reason evidence without duplicate quotations. `semantic.ts` selects current items and changes within a catch-up interval.
- `live.ts` captures microphone audio, connects to speech recognition and submits only completed utterances. Live speakers remain labelled Microphone.
- `api.ts` validates HTTP responses against shared contracts. No provider keys enter the UI.
- `fixtures.ts` contains one natural English sample conversation, without semantic instruction labels. It sends only transcript input; semantic output comes from the configured backend engine. The offline mock recognizes a limited subset of the dialogue.

**Seen** dismisses the notification and updates its counter. Seen tasks and unanswered questions remain in Summary; tasks can still be marked **Completed** there. That button appears only for tasks. Context-card read marks are local to the mounted UI; personal request acknowledgements are retained by the server.

**I missed that** opens a native modal dialog, trapping keyboard focus and returning it on close. The underlying conversation continues. The snapshot stays still until **Update summary** is pressed; **I’m caught up** acknowledges only that snapshot, leaving later changes unread. Closing does not acknowledge it.

The analysis status has reserved space above notifications to avoid moving the card as processing starts and finishes. Errors stay visible below notifications, with retry for failed analysis. The transcript follows new words only while the reader is at its end.

## Data and checks

The UI polls `GET /session` every second. Monotonic revisions reject older responses. The shared in-memory server retains words across browser reloads; restarting the server clears them. Switching modes or resetting clears that shared session.

Run frontend/backend from the repository root and open http://127.0.0.1:5173.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @senselayer/web test:ui
```

Browser tests use installed Chrome, mocked speech events and an isolated deterministic backend. They do not use the configured OpenAI key or reset the user's running session. `UI_BASE_URL` selects the frontend; `UI_BROWSER=msedge` selects Edge. Screenshots go into ignored `dist/qa`; build clears that folder.

Physical microphone accuracy and usability with Deaf/HoH participants need separate evaluation.
