import type { ContextState, TranscriptEvent } from '@senselayer/shared';
import { semanticItems, type SemanticItem } from './semantic.js';

export const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Evidence({ ids, events }: { ids: string[]; events: TranscriptEvent[] }) {
  return <details className="evidence"><summary>Source</summary><div className="source-content">
    {[...new Set(ids)].map(id => {
      const event = events.find(item => item.id === id);
      return event ? <blockquote key={id}><p>{event.text}</p><footer>{event.speaker} · {time(event.timestamp)}</footer></blockquote>
        : <p key={id}>Source unavailable.</p>;
    })}
  </div></details>;
}

export function Summary({ state, events, items = semanticItems(state), onComplete, completing = false }: {
  state: ContextState; events: TranscriptEvent[]; items?: SemanticItem[];
  onComplete?: (id: string) => void; completing?: boolean;
}) {
  return <div className="summary-content">
    {state.topic && <section className="summary-topic"><h3>We’re talking about</h3><p>{state.topic.text}</p></section>}
    {(['WHAT CHANGED', 'NEEDS YOU', 'STILL OPEN'] as const).map(group => {
      const matching = items.filter(item => item.group === group);
      if (!matching.length) return null;
      return <section className="summary-group" key={group}>
        <h3>{group === 'WHAT CHANGED' ? 'The plan' : group === 'NEEDS YOU' ? 'For you' : 'Still open'}</h3>
        <ul>{matching.map(item => {
          const task = state.user_requests.find(request => request.id === item.key && request.kind === 'task' && !request.resolved_at);
          return <li key={item.key}>
          {item.previous && <p className="previous">Before: {item.previous}</p>}
          <p className="summary-text">{item.previous ? 'Now: ' : item.resolved ? 'Answered: ' : ''}{item.text}</p>
          {group === 'WHAT CHANGED' && !item.resolved && <p className="rationale"><strong>Why:</strong> {item.rationale?.text ?? 'No reason stated.'}</p>}
          <Evidence ids={[...item.event_ids, ...(item.rationale?.event_ids ?? [])]} events={events} />
          {task && onComplete && <div className="summary-task-action">
            <span>{task.acknowledged_at ? 'Seen · Task open' : 'Task open'}</span>
            <button className="complete-button" disabled={completing} onClick={() => onComplete(task.id)}>Completed</button>
          </div>}
        </li>; })}</ul>
      </section>;
    })}
    {!items.length && <p className="empty-summary">No decisions or requests captured yet. Your saved words are in Transcript.</p>}
  </div>;
}
