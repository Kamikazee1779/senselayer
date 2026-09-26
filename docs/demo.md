# Project-meeting demo

The demo proves one thing: a student can recover a changed plan, its explicit reason and a personal request while the conversation continues. Aim for 90–150 seconds.

## Preparation

- Start frontend/backend with the intended semantic provider. Keep credentials out of the UI and recording.
- Confirm the configured name and speech language. The rehearsed script below is English, with the default user Emilio.
- Check microphone access and provider availability before judging.
- Keep the deterministic replay ready as a clearly labelled fallback.
- Do not describe automated/mock tests as evidence of real speech recognition or validation with Deaf/HoH users.

## Live script

**0–15 seconds — situation.** Emilio is checking code while two teammates discuss the project demo. Captions are available, but looking at code means looking away from them.

**15–30 seconds — baseline.** Sara says: “For the presentation, we decided to use the desktop version.” Open catch-up and acknowledge this starting point while Emilio is still following.

**30–60 seconds — missed exchange.** Emilio looks at the code. Speak naturally, leaving short pauses so utterances finalize:

1. Marta: “The desktop text is hard to read on the projector.”
2. Luca: “We could enlarge the text, or use the mobile version.”
3. Sara: “We decided to use the mobile version instead of desktop, because the text is easier to read on the projector.”
4. Luca: “Who will present the architecture?”
5. Sara: “Emilio, can you test the login button on the mobile version now?”

**60–85 seconds — recovery.** Emilio opens “I MISSED THAT”. Show the desktop → mobile change, the stated reason, the pending question and the personal task. Emilio responds: “I’ll check the mobile login.” Seeing the request must not mark the work completed.

**85–105 seconds — the present continues.** While the catch-up remains open, Luca says: “I will present the architecture.” The panel stays stable and indicates a newer update. Acknowledge the old snapshot and open the next catch-up to see the resolution.

**105–120 seconds — evidence.** Open the decision's source. Show that the suggestion to enlarge desktop text was not recorded as a commitment. Sources make the interpretation inspectable; they do not make the model infallible.

**120–130 seconds — outcome.** Emilio knows the current plan, the reason for the change, and what to do next. Mark the login test completed only after it has actually been done.

## Deterministic fallback

Select **Project meeting** in Demo replay. Its fixture contains only transcript input and passes through the same ingestion, reducer and catch-up logic. The mock provider uses a deliberately narrow grammar such as `Decision:`, `Correction:`, `Question:` and `Answer:`. This is a demonstration of application behavior, not free-form language understanding.

To establish the baseline deliberately, pause replay, advance the first batch, and acknowledge catch-up. Resume replay while looking away. Opening catch-up must not pause it; the later answer arrives while the earlier snapshot stays readable.

Command-line check:

```sh
pnpm replay fixtures/project-meeting.json
```

Replay with a real semantic provider removes the microphone dependency but still exercises model interpretation. Offline mock replay removes both external dependencies. Say which path is being shown.

## Failure behavior to demonstrate during rehearsal

- Slow semantics: text and direct attention remain available, and catch-up still opens with an honest processing indicator.
- Failed semantics: accepted words remain visible; retry interpretation without repeating speech. The microphone remains available.
- New information during reading: it is offered as a later update, not inserted under the reader's eyes or consumed by the old acknowledgement.
- Repeated call: after seeing a call, a later “Emilio?” can alert again.
- Task lifecycle: “Seen” removes the interrupt, but an unfinished task remains in pending requests until completed.

## Claims to keep precise

The prototype has one shared in-memory session and no live diarization. Replay speaker names are supplied fixture labels. Haptics, wearables, parallel-conversation reconstruction and environmental sound recognition are future work.

Measure end-of-speech → text, text → attention, and text → semantic change separately. A short recovery time is a design target, not an established result for Deaf/HoH users. If participants are available, ask them to recover the current plan, reason and personal request; record misunderstandings as well as successes.
