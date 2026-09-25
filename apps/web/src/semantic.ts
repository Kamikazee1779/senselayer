import { requestStatus, type CatchupResponse, type ContextState } from '@senselayer/shared';
export type SemanticItem = { key: string; group: string; text: string; event_ids: string[] };

// Presentation only: compare server snapshots within this browser session.
export function semanticItems(state: ContextState): SemanticItem[] {
  const items: SemanticItem[] = [];
  const add = (group: string, identity: string, text: string, event_ids: string[]) => {
    items.push({ key: JSON.stringify([group, identity, text, event_ids]), group, text, event_ids });
  };
  if (state.topic) add('TOPIC', 'topic', state.topic.text, state.topic.event_ids);
  state.decisions.filter(item => !item.superseded_by).forEach(item => add('DECIDED', item.id, item.text, item.event_ids));
  state.questions.forEach(item => {
    if (item.resolution) add('RESOLVED', item.id, `${item.text} — ${item.resolution.text}`, item.resolution.event_ids);
    else add('STILL OPEN', item.id, item.text, item.event_ids);
  });
  state.user_requests.filter(item => requestStatus(item) === 'active')
    .forEach(item => add('ABOUT YOU', item.id, item.text, item.event_ids));
  return items;
}

// Use the backend's bounded change list, but present each current entity once.
// Superseded decisions and resolved questions must not appear as current/open.
export function catchupItems(catchup: CatchupResponse): SemanticItem[] {
  const keys = new Set(catchup.changes.map(change => `${change.op}:${change.entity_id ?? 'topic'}`));
  const items = semanticItems(catchup.state).filter(item => {
    const [, id] = JSON.parse(item.key) as string[];
    const op = ({ TOPIC: 'set_topic', DECIDED: 'add_decision', 'STILL OPEN': 'open_question', RESOLVED: 'resolve_question', 'ABOUT YOU': 'add_user_request' } as Record<string, string>)[item.group];
    return keys.has(`${op}:${id}`);
  });
  const presentedRequestQuestions = new Set(catchup.state.user_requests
    .filter(request => requestStatus(request) === 'active' && keys.has(`add_user_request:${request.id}`))
    .map(request => request.question_id));
  return items.filter(item => item.group !== 'STILL OPEN' || !presentedRequestQuestions.has((JSON.parse(item.key) as string[])[1]));
}
