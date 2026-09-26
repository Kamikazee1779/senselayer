import type { ContextState, TranscriptEvent, UserRequest } from '@senselayer/shared';
import { outstandingRequests } from './semantic.js';

export type Notification = {
  id: string;
  text: string;
  event_ids: string[];
  level: 'context' | 'attention' | 'action';
  request?: UserRequest;
};

// Conservative presentation rule, not an urgency prediction. Red requires a
// task and an explicit immediate instruction in both the request and its source.
// Ambiguous wording stays yellow; deadlines alone never turn a card red.
function immediateInstruction(text: string) {
  return /\b(?:now|immediately|right away|subito|adesso)[.!?]*\s*$/i.test(text)
    && !/\b(?:not|no|never|don.t|doesn.t|isn.t|non|later|whenever|thought|said|maybe|if)\b/i.test(text);
}

export function notifications(state: ContextState, events: TranscriptEvent[], seen: ReadonlySet<string> = new Set()): Notification[] {
  const requests = outstandingRequests(state);
  const cards: Notification[] = requests.map(request => ({
    id: request.id, text: request.text, event_ids: request.event_ids, request,
    level: request.kind === 'task' && request.explicit_address && immediateInstruction(request.text)
      && events.some(event => request.event_ids.includes(event.id) && immediateInstruction(event.text)) ? 'action' : 'attention',
  }));
  const linked = new Set(requests.map(request => request.question_id));
  state.questions.filter(item => !item.resolution && !linked.has(item.id)).forEach(item => {
    cards.push({ id: item.id, text: item.text, event_ids: item.event_ids, level: 'attention' });
  });
  state.decisions.filter(item => !item.superseded_by).forEach(item => {
    cards.push({ id: item.id, text: item.text, event_ids: item.event_ids, level: 'context' });
  });
  const rank = { action: 0, attention: 1, context: 2 };
  // Keep seen work in domain state and Summary, but dismiss its notification.
  return cards.filter(card => !card.request?.acknowledged_at && !seen.has(card.id))
    .sort((a, b) => rank[a.level] - rank[b.level]);
}
