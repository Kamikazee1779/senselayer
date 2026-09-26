// Shared semantic rules; provider transport and output formats stay in their adapters.
export const conversationPolicy = `Persistent context should help someone recover a material change or an outstanding need.
Ordinary greetings, thanks and reciprocal small talk remain in the transcript; do not create persistent
questions or user requests for them. For example, "How are you? I'm fine, thanks. And you?" is not an
outstanding work item. This is not a phrase blacklist: explicit needs for help, accessibility, safety,
information or a real choice are substantive, even when phrased as a friendly check-in.
Read the entire new event before proposing operations. A transcription chunk may contain a question
and its answer, or several conversational turns. Do not open a question already answered in that chunk.
If an existing substantive question is answered, resolve its existing ID. A reciprocal greeting does
not reopen it. A genuinely new substantive question may still need its own entry.
For add_user_request, cited speech must establish that the configured user is the recipient or assignee.
An earlier mention of their name does not make every later "you" a request to that user. Do not guess
the recipient from proximity, alternating turns or an assumed speaker identity. When the recipient is
unclear, retain a substantive group question as open_question only, without a personal user request.
continuing_address, when present, identifies a standalone direct call immediately followed by a
second-person request in a separate transcript event, within 15 seconds and with the same speaker label.
This can be one spoken request split by speech recognition: "Emilio." then "Can you please load the dishwasher".
Read those events with their surrounding speech. This is a continuation candidate, not proof of speaker
identity or recipient: labels such as Microphone or Conversation may cover different speakers. If the name
answers a preceding question ("Who will present?" / "Emilio."), or the new speech explicitly addresses
someone else ("Can you load the dishwasher, Alexandra?"), do not bind the request to the earlier name.
When it is a direct call followed by its substantive request, use that explicit addressee and cite BOTH
address_event_id and request_event_id in add_user_request.
For that example emit kind=task, not just a question or the existing attention signal; household work counts
as a task just like project work. Use the request's actual words for its meaning.
The candidate does not prove a task exists: hypothetical, quoted or cancelled requests and small talk still
require conservative interpretation. Without continuing_address, do not carry an earlier standalone call
across separate events based only on proximity. A name mention or greeting never supplies this candidate.
Examples: "Which room is the meeting in?" is a general question; "Emilio, which room should we use?"
is a personal question when Emilio is the configured user; "Emilio, can you read the captions?" is a
substantive accessibility question, not small talk. "Emilio, can you test login?" is a task request.
A user_requests entry with kind=attention is only a provisional direct-call signal, not an already
interpreted task or question. When its cited speech contains a substantive request, emit add_user_request
with the same source event_ids and the correct kind to enrich it. This is required classification,
not a duplicate: for an attention entry citing "Emilio, can you test login?", emit kind=task.
Once it is classified as task or question, do not repeat it without new material information.`;
