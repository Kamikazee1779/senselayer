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
Examples: "Which room is the meeting in?" is a general question; "Emilio, which room should we use?"
is a personal question when Emilio is the configured user; "Emilio, can you read the captions?" is a
substantive accessibility question, not small talk. "Emilio, can you test login?" is a task request.
A user_requests entry with kind=attention is only a provisional direct-call signal, not an already
interpreted task or question. When its cited speech contains a substantive request, emit add_user_request
with the same source event_ids and the correct kind to enrich it. This is required classification,
not a duplicate: for an attention entry citing "Emilio, can you test login?", emit kind=task.
Once it is classified as task or question, do not repeat it without new material information.`;
