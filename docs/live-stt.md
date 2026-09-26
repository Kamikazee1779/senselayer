# Local microphone transcription

Use Node 22+ and pnpm 11.25.0. From the repository root in PowerShell:

```powershell
pnpm install
$env:OPENAI_API_KEY = '<your OpenAI API key>'
$env:CONTEXT_PROVIDER = 'mock'
pnpm dev
```

Open http://127.0.0.1:5173 in Chrome. Choose **Live**, press the microphone button at bottom left, grant permission, speak English, and pause briefly between utterances. Chrome's selected/default microphone is used. Pressing the same microphone button again releases capture and waits up to ten seconds for the trailing utterance to finalize. Connection and transcription failures display an error; **Demo** remains usable. Starting replay or resetting stops live capture before resetting the shared session.

`OPENAI_API_KEY` is the only new required variable, and only needed for live transcription. It must be available to the backend process with access to `gpt-live-transcribe`. Never prefix it with `VITE_`. The backend automatically loads `.env` from the repository root; exporting variables in the launching shell also works and takes precedence. Restart after changing `.env`. The existing optional `CONTEXT_PROVIDER`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL` settings are unchanged. The commands above keep semantic reasoning deterministic; set `CONTEXT_PROVIDER=openai` for OpenAI interpretation or use your existing Claude configuration if desired.

## Boundary and transport

The browser posts an SDP offer to `POST /transcription/session` as `{ sdp }`. The backend uses the long-lived key to create a transcription-only session at OpenAI `/v1/realtime/calls`, returning only the SDP answer. No key, including a temporary key, needs to reach the browser. Audio goes directly to OpenAI over WebRTC and is not stored by SenseLayer. The session uses `gpt-live-transcribe`. Speech language guidance comes from `SENSELAYER_LANGUAGE` (default `en`); keywords come from `SENSELAYER_USER_NAME` (default `Emilio`) and configured aliases. These are the same identity settings exposed to the UI and semantic engine. Changing recognition guidance does not add multilingual direct-address understanding; English remains the rehearsed demo language.

This model requires explicit audio commits, so a browser Web Audio RMS detector commits after 800 ms of silence following speech. This intentionally small detector is sensitive to background noise; quiet speech/noisy rooms need real-device testing. It adds no diarization or speaker identification. The `Microphone` label describes the input, not a person.

Only `conversation.item.input_audio_transcription.completed` events become transcript requests; deltas are ignored. Completed items are deduplicated and ordered against `input_audio_buffer.committed` events. Application code supplies a session-unique ID, sequence (starting at 1 per microphone start), and receive time. Each HTTP body is exactly:

```json
{"id":"live-<session>-1","seq":1,"text":"Emilio, can you review the demo?","final":true,"source":"live","receivedAt":"2026-09-25T12:00:00.000Z"}
```

The existing `/transcript` route validates this shape and maps `receivedAt` to the legacy `timestamp` plus the neutral `Microphone` label. Live metadata remains on the resulting `TranscriptEvent`. Both inputs converge at `InMemoryStore.ingestFinalized`; semantic processing, vocative detection, acknowledgements and catch-up remain provider-independent. The HTTP path returns after acceptance; queued interpretation is observed through `/session`. Existing replay requests and fixtures retain their shape. HTTP accepts finalized text without waiting for semantic analysis. Interpretation failures are reported separately through `/session` and do not stop live capture. A failed text submission or speech connection still stops capture visibly; no automatic resubmission can silently duplicate speech. Use the analysis retry control to retry retained text without re-ingesting it.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm replay
# With pnpm dev running in another terminal (mock context provider):
pnpm --filter @senselayer/web test:ui
```

The Chrome suite uses a synthetic microphone device and mocks the OpenAI WebRTC peer/handshake. It exercises Chrome permission grant/denial, real capture-track cleanup, final-only HTTP ingestion, live provenance and replay fallback. Unit tests mock the OpenAI HTTP call and verify model/session configuration and ordered final handling. These tests do not establish real OpenAI recognition accuracy or physical microphone operation.

For a real acceptance run, configure the key, grant the physical microphone permission, say an English sentence including “Emilio”, pause, and check the conversation. For provenance, inspect `GET /session` for `source: "live"` and `final: true`. Stop and run a replay. A successful real provider run must be reported separately from the automated mocked checks.

Implementation references: [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) and [WebRTC unified interface](https://developers.openai.com/api/docs/guides/realtime-webrtc).
