# SenseLayer demo runbook

This runbook is optimized for a short live hackathon demo. The goal is to prove the product thesis, not to expose every internal detail.

## Core message

> Captions help you follow words. SenseLayer helps you stay part of the conversation.

The demo should make two capabilities obvious:

1. **Re-entry** — recover what materially changed while the user was not following.
2. **Relevance** — interrupt only when the conversation explicitly needs the user.

## Pre-demo checklist

- Repository is on the intended commit.
- `pnpm install` has completed.
- API keys are loaded in the shell, never shown on screen.
- `CONTEXT_PROVIDER` is set deliberately.
- Frontend is reachable at `http://127.0.0.1:5173`.
- Backend is reachable at `http://127.0.0.1:3001`.
- Microphone permission is granted in Chrome.
- Physical microphone is selected and tested.
- Replay fallback is available.
- Debug panel is closed unless a judge asks for internals.

## Recommended live scenario

Use short pauses between utterances so live transcription finalizes cleanly.

### 1. Establish an open question

Say:

> What should we get for dinner, Chinese or burritos?

Then:

> I think Chinese could be good.

Press **I MISSED THAT**.

Expected:

- the dinner question remains **STILL OPEN**;
- no decision is invented.

Acknowledge with **I'm caught up**.

### 2. Commit a decision

Say:

> Actually, let's go with burritos.

Press **I MISSED THAT** again.

Expected:

- burritos appear under **DECIDED**;
- the previous dinner question is resolved.

Acknowledge with **I'm caught up**.

### 3. Prove mention vs direct address

Say:

> I thought Emilio was going to pick them up.

Expected:

- no direct-attention alert.

Then say:

> Emilio, can you go pick them up?

Expected:

- explicit-vocative fast path fires;
- priority request appears.

This contrast is the most important moment in the demo.

### 4. Optional resolution

Respond:

> Yeah, I can pick them up.

Expected:

- the related request/question resolves according to the current state lifecycle.

## What to say while demoing

Keep narration simple:

- "This is a real microphone and live transcription."
- "SenseLayer is not continuously summarizing the transcript. It tracks explicit conversation-state changes."
- "I MISSED THAT shows only what changed since the last acknowledged catch-up."
- "Talking about the user is not the same as talking to the user."
- "Every semantic item is grounded in transcript evidence."

## What not to show unless asked

Avoid distracting from the product story with:

- raw JSON;
- Zod schemas;
- provider implementation details;
- API keys;
- long debug output;
- speculative roadmap features presented as if implemented.

## Failure fallbacks

### Microphone / STT fails

Switch to **Demo replay**. Replay enters the same finalized transcript boundary as live speech, so downstream state, catch-up, and UI behavior remain representative.

### Semantic provider fails or latency spikes

Use the deterministic/mock provider or the prepared replay path. Do not debug provider credentials during the pitch.

### Venue noise prevents clean utterance segmentation

Move the microphone closer, use shorter utterances, and pause clearly between them. If segmentation remains unreliable, use replay.

### Network fails

Use the deterministic offline replay. The demo should still prove state lifecycle, catch-up, provenance, and attention behavior.

## Judge questions

### "Isn't this just summarization?"

No. SenseLayer stores explicit state changes and lifecycles. The model proposes evidence-backed semantic operations; application code owns the state. Catch-up is a deterministic diff since the user's last acknowledged watermark.

### "Why not just captions?"

Captions still require continuous visual attention. SenseLayer is designed for moments when the user looks away or needs only the minimum relevant state to re-enter the conversation.

### "What if the model is wrong?"

Semantic operations are constrained to a small schema and must cite actual transcript-event IDs. Invalid or ungrounded operations are rejected by application code. Ambiguous direct-attention cases are intentionally treated conservatively.

### "Why haptics?"

Haptics are a future output modality for direct attention when the user is not looking at a screen. The current hackathon prototype proves the routing event; haptic hardware is not required for the core system.

## Freeze rule

Before judging begins, prefer reliability over new features. Do not introduce database, authentication, diarization, emotion inference, large UI rewrites, or new semantic operation types unless a critical demo blocker requires it.
