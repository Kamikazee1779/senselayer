# SenseLayer — live showcase script

Allow about three minutes, including interaction and processing pauses. Three
speakers: Enrico, Alexandra and Emilio. Italic text is a silent stage direction.
This is a shorter live alternative to [the extended judges’ recording](demo-giudici.md).

## Before presenting

- Project the app at a readable size, with notifications and “I missed that” visible.
- Use English and configure Emilio as the user. Rehearse with the real semantic
  provider: this free-form script is not a deterministic mock fixture.
- Set `CONTEXT_PROVIDER=openai` and restart the backend after changing the configuration.
- Start a fresh Live session. Keep the microphone off during the introduction.
- Prepare a separate code window for Emilio to check and set moderate brightness,
  so the request below leads to a visible action.
- Keep a captioned screen recording of a successful rehearsal ready as fallback.
  If using it, say: “This is a recording of our prototype running this scenario.”
- Speaker identification is optional and experimental. If showing names, first
  check recognition on the presentation hardware. Leave short pauses between
  speakers and avoid overlap; do not promise that every turn will be named.

## 1. Introduce the situation — microphone off

**Enrico, to the audience:**

> “Imagine following a project meeting through captions. You look away to check
> your code. When you look back, the team has changed the plan.
> SenseLayer helps you recover what changed, why, and what needs your response.
> Let’s show you.”

## 2. Establish the original plan — microphone on

**Enrico:**

> “For our presentation, we’ve decided to start with the slides, then show the
> prototype. We have five minutes, so there’s time for both.”

**Alexandra:**

> “Agreed. Slides first, prototype second. I’ll run the walkthrough, and we can
> take questions together at the end.”

*Wait for analysis. Emilio opens “I missed that”, checks the initial plan, then
presses “I’m caught up”. This establishes the review baseline in front of the
audience. The app does not detect where Emilio is looking.*

**Emilio:**

> “Sounds good. I’m going to check the code before we start. Keep going while
> I get it ready.”

*Emilio turns to the code window. Keep the projected app visible to the audience.*

## 3. Change the plan

**Enrico:**

> “The organiser has just cut our slot to two minutes. We’ve decided to show
> the prototype first instead of the slides, because we no longer have time
> for both.”

**Alexandra:**

> “Okay, prototype first. The screen looks a little dim from here.
> Emilio, can you turn up the laptop brightness now, before we start?”

*Let the request appear. Emilio returns to the app and presses “I missed that”.
Pause so the audience can read. If analysis is pending, wait and use “Update
summary” when ready. Check that the displayed result conveys prototype first,
the shorter slot, and the brightness request. Wording may vary.*

## 4. Show recovery and action

**Emilio, after reading the result:**

> “Okay, prototype first, because we only have two minutes. And you need me
> to turn up the brightness. I’m caught up.”

*Emilio presses “I’m caught up”, then “Seen” on the request. Briefly show the
unfinished task in Summary. He raises the actual laptop brightness, then marks
the task “Completed”. Do not recite the expected result if the app did not
capture it; inspect Source or switch to the labelled rehearsal recording.*

**Emilio:**

> “The brightness is up. Alexandra, you can run the walkthrough. I’ll take
> the questions at the end.”

**Alexandra:**

> “Perfect. I’ll show the prototype, and you’ll handle the questions.
> We’re ready.”

*Let the final turns finish processing, then turn off the microphone without
resetting the session. Open Source on the changed plan.*

## 5. Explain the value — microphone off

**Alexandra, to the audience:**

> “Here are the original words behind that update, so Emilio can check the
> interpretation. And seeing a request is separate from completing the task.”

**Enrico, to the audience:**

> “We’re building SenseLayer for Deaf and hard-of-hearing students in small
> project meetings. In this scenario, Emilio recovered the current plan and
> rejoined the conversation without asking everyone to start again.”

**Emilio, to the audience:**

> “What changed? Why? What do you need from me? That’s what I need to join
> the next decision.”

## Presentation choices

Keep the app on screen for most of the presentation. Give the catch-up result
five to ten seconds of quiet attention; it is the central moment of the demo.
Use the actual result to guide the explanation, rather than reading every card.

Save deeper architecture and speaker recognition details for
questions. The main demonstration is complete when Emilio understands the new
plan and contributes again. This scripted scenario demonstrates prototype
behavior; it is not a usability result with Deaf or hard-of-hearing participants.

If asked about continued conversation, demonstrate it separately: keep catch-up
open while someone states another decision, wait for the newer-update indicator,
then use “Update summary”. The existing snapshot stays still while it is read.
