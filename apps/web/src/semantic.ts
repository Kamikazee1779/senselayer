import { requestStatus, type CatchupResponse, type ContextState, type Decision } from '@senselayer/shared';

export type SemanticItem = {
  key: string;
  group: 'WHAT CHANGED' | 'NEEDS YOU' | 'STILL OPEN';
  text: string;
  event_ids: string[];
  previous?: string;
  rationale?: Decision['rationale'];
  resolved?: boolean;
};

// Acknowledging a task means it was seen, not that the task was completed.
export function outstandingRequests(state: ContextState) {
  return state.user_requests.filter(item => requestStatus(item) !== 'resolved' &&
    (item.kind !== 'attention' || requestStatus(item) === 'active'));
}

export function semanticItems(state: ContextState): SemanticItem[] {
  const decisions = state.decisions.filter(item => !item.superseded_by);
  const items: SemanticItem[] = decisions.map(item => {
    const previous = state.decisions.find(old => old.superseded_by === item.id);
    return { key: item.id, group: 'WHAT CHANGED', text: item.text, event_ids: item.event_ids,
      ...(previous ? { previous: previous.text } : {}), ...(item.rationale ? { rationale: item.rationale } : {}) };
  });
  const requests = outstandingRequests(state);
  const requestQuestions = new Set(requests.map(item => item.question_id));
  state.questions.filter(item => !item.resolution && !requestQuestions.has(item.id)).forEach(item => {
    items.push({ key: item.id, group: 'STILL OPEN', text: item.text, event_ids: item.event_ids });
  });
  requests.forEach(item => items.push({ key: item.id, group: 'NEEDS YOU', text: item.text, event_ids: item.event_ids }));
  return items;
}

// Keep the snapshot fixed while conversation continues. This is the interval's
// changes, not an inference about what the person saw or all unresolved history.
export function catchupItems(catchup: CatchupResponse): SemanticItem[] {
  const changed = new Set(catchup.changes.map(change => change.entity_id));
  const items = semanticItems(catchup.state).filter(item => changed.has(item.key));
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const decisions = items.filter(item => item.group === 'WHAT CHANGED');
  for (const question of catchup.state.questions) {
    if (!question.resolution || !catchup.changes.some(change => change.op === 'resolve_question' && change.entity_id === question.id)) continue;
    // The corresponding decision already communicates this answer.
    if (decisions.some(item => normalize(item.text) === normalize(question.resolution!.text))) continue;
    items.push({ key: question.id, group: 'WHAT CHANGED', text: `${question.text} — ${question.resolution.text}`,
      event_ids: question.resolution.event_ids, resolved: true });
  }
  return items;
}
