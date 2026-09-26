# Judges’ demo — “The plan changed while I was looking away”

## The scene

Enrico, Alexandra and Emilio are preparing to present their project. They have
agreed to start with slides. While Emilio checks the laptop screen, Enrico finds
out their presentation slot has been shortened. The team changes the plan and
asks Emilio to do something before the judges arrive.

The moment to demonstrate: **Emilio returns to the conversation knowing what
changed, why it changed, and what he needs to do next.**

- **Speaking order:** Enrico → Alexandra → Emilio, repeated four times.
- **Length:** about 3 minutes, including the screen demonstration.
- **Language:** English.
- **Emilio’s role:** an active teammate. He speaks, makes choices and answers questions.
- **Delivery:** a conversation between teammates, not twelve miniature speeches.
  Read the quoted dialogue only. Directions in italics are silent stage cues.

## Before playback — say this to the judges

> “Reading captions takes visual attention. This is a recorded conversation between
> three teammates. Watch what happens when Emilio looks away to prepare the screen
> and the plan changes. The system is processing the recording as we play it.”

Use that last sentence only when audio is actually being processed during the
presentation. For a prerecorded screen video, replace it with:
“We’ll show you a recording of the prototype handling that conversation.”
Keep the introduction outside the audio sent to the app.

## Recording script

### Round 1 — everyone knows the original plan

**01 · Enrico**

> “Okay, we’ve got five minutes with the judges. Let’s start with the slides,
> explain the problem, and then show the prototype. Alexandra, you can walk them
> through it. Emilio and I can take the questions.”

**02 · Alexandra**

> “Sounds good. I’ll keep the walkthrough short. One conversation, one change
> of plan, and then we show how someone catches up. We can save the technical
> details for the questions.”

**03 · Emilio**

> “Works for me. Give me a moment to get the screen ready. I’m going to check
> the text size from the other side of the table. Keep going while I do that.”

*Emilio turns his attention to the laptop setup. Let the first three turns finish
processing. During rehearsal, open “I missed that” and acknowledge this initial
plan so that the next catch-up has a clear starting point. Close the modal.*

### Round 2 — the plan changes while Emilio is occupied

**04 · Enrico**

> “Quick update: the organiser says we’ve only got two minutes now. Let’s open
> with the prototype instead of the slides. Otherwise we’ll spend the whole slot
> explaining it and they won’t get to see it work.”

**05 · Alexandra**

> “All right, straight into the prototype. The screen is a little hard to read
> from this side, though, and they’re almost here. Emilio, could you turn the
> laptop brightness up now?”

*PAUSE PLAYBACK before Emilio’s reply. This is the main demonstration beat.*

*Show the personal request, then press “I missed that”. Once analysis has caught
up, the summary should convey these three facts, in its own wording:*

> **New plan:** start with the prototype instead of slides.
>
> **Reason:** the presentation slot has been cut from five minutes to two.
>
> **For Emilio:** turn up the laptop brightness now.

*Keep this pause to roughly 10–15 seconds once the result is ready. Read enough
of the summary to orient the audience; there is no need to read every word aloud.
Resume playback.*

**06 · Emilio**

> “Oh, two minutes? I was still getting the screen ready. Okay, I’ve caught up:
> prototype first, slides can wait. I’ve seen the brightness request too.
> I’ll turn it up before they come over.”

*Emilio closes catch-up and can press “Seen” on the request. It leaves the
notification deck, but the task is still open. He then adjusts the brightness.
Prepare the laptop at a moderate brightness so there is a real action to perform.*

### Round 3 — Emilio contributes to the new plan

**07 · Enrico**

> “Thanks. I’ll keep the introduction to one sentence. That should leave about
> ninety seconds for the prototype and a little time for a question. We can
> explain the implementation afterward if they want more detail.”

**08 · Alexandra**

> “That works. Emilio, would you rather run the walkthrough or take the question
> at the end? I’m happy to do either, but let’s decide before they get here
> so we’re not talking over each other.”

*Briefly pause before the answer to show the question directed to Emilio.
It needs an answer, rather than an immediate physical action.*

**09 · Emilio**

> “I’ll take the question at the end. You’ve rehearsed the walkthrough, so you
> should run that. The brightness is up now, by the way. Have a look from your
> side — the text should be easier to read.”

*Check that the question is resolved after the answer is processed. If the
brightness task remains open, mark it “Completed” now that the action has
actually been performed. A spoken confirmation and a button press are different
ways the interface may receive progress; do not claim a click happened automatically.*

### Round 4 — a shared plan, without restarting the meeting

**10 · Enrico**

> “Great. I’ll introduce the situation, Alexandra will show the prototype, and
> Emilio will handle the question at the end. We can leave the slides closed.
> That should fit comfortably into the two minutes.”

**11 · Alexandra**

> “Ready on my side. I’ll leave the conversation visible while I explain it.
> When we open a notification, we can show the original line as well,
> so they can see where it came from.”

**12 · Emilio**

> “All clear. I’ll take over when you finish the walkthrough. If they ask about
> the technical details, we can bring up the slides then. The screen’s ready —
> let’s go.”

## After playback — the closing line

> “Emilio recovered the new plan, the reason for the change, and the request
> addressed to him. Then he could take part in the next decision.”

Say this outside the captured conversation. If useful, open **Source** on the
plan change and show Enrico’s original words. End on that concrete evidence.

## Rehearsal checkpoints

| Moment | What to check |
| --- | --- |
| After 01–03 | The starting plan is slides first, with a five-minute slot. |
| After 04 | The current plan is prototype first; the reason is the shorter slot. A context update is appropriate. |
| After 05 | Emilio receives the brightness task. The explicit “now” provides the evidence for an immediate-action notification. |
| Before 06 | Catch-up conveys the new plan, reason and personal task. Wait if analysis is still pending. |
| After “Seen” | The notification disappears; an unfinished task remains in Summary. |
| After 08 | The choice of presentation role appears as a question needing Emilio’s attention. |
| After 09 | His answer resolves that choice; the brightness task can be completed after the action. |
| At the end | Source lets the judges compare the interpretation with the original words. |

Green context, yellow attention and red immediate-action notifications are
rehearsal expectations, not hardcoded outcomes. Check the actual transcription
and model interpretation before presenting them as working results.

## Recording and playback notes

- Keep the order **Enrico → Alexandra → Emilio** for all four rounds. Speak at a
  normal pace and leave about 1.5–2 seconds between turns. Avoid overlapping voices.
- Record the dialogue only. Keep stage directions, the judges’ introduction and
  the closing explanation out of the input audio.
- Save the individual turns as `01-enrico.wav`, `02-alexandra.wav`,
  `03-emilio.wav`, continuing in order through `12-emilio.wav`. They can then be
  assembled into one track with playback pauses before turns 06 and 09.
- Save recordings in the ignored local directory
  `tools/speaker-recognition/enrollments/demo-giudici/`. Use fresh recordings to
  test the existing speaker profiles; do not train on the same clips being assessed.
- Use `SENSELAYER_USER_NAME=Emilio` and `SENSELAYER_LANGUAGE=en`. Restart the server
  if you change these settings. Start with a fresh session and check the microphone
  name displayed in the app.
- **Live currently captures a microphone; this document does not add file playback.**
  A player or audio routing setup is needed to feed a recording into that path.
  Playing through speakers into the microphone adds room noise and echo. For a
  direct local speaker-identification test, use `identify_audio.py` as described
  in the [speaker-recognition README](../tools/speaker-recognition/README.md).
- Pause the audio player at the two marked beats. Opening “I missed that” alone
  does not pause audio or incoming transcription. Account for this when recording
  a screen video as well.
- Fixed speaking order makes the performance repeatable. The live recognizer
  still compares voices with enrolled profiles; it does not cycle through the
  scripted names. Label a replay with preassigned names as a replay.
