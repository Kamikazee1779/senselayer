import {
  ContextStateSchema, parseDeltaOps, TranscriptRequestSchema,
  type ContextState, type TranscriptEvent, type CatchupResponse,
} from '@senselayer/shared';

export function emptyState(): ContextState {
  return { topic: null, decisions: [], questions: [], user_requests: [] };
}

// This is the application-owned mutation boundary for the future Engine.
// Work on a copy so an invalid transition never partially updates state.
export function applyDeltaOps(
  state: ContextState,
  proposal: unknown,
  new_events: readonly TranscriptEvent[],
  nextId: () => string,
  now: () => string,
): ContextState {
  const ops = parseDeltaOps(proposal, new_events);
  const next = structuredClone(ContextStateSchema.parse(state));
  for (const op of ops) {
    const content = { text: op.text, event_ids: [...op.event_ids] };
    switch (op.op) {
      case 'set_topic': next.topic = content; break;
      case 'add_decision':
        next.decisions.push({ ...content, id: nextId(), created_at: now() });
        break;
      case 'open_question':
        next.questions.push({ ...content, id: nextId(), created_at: now(), resolution: null });
        break;
      case 'resolve_question': {
        const question = next.questions.find(item => item.id === op.question_id);
        if (!question || question.resolution !== null) {
          throw new Error('Only an existing open question may be resolved');
        }
        question.resolution = { ...content, resolved_at: now() };
        break;
      }
      case 'add_user_request':
        next.user_requests.push({ ...content, id: nextId(), created_at: now(), acknowledged_at: null });
        break;
    }
  }
  return ContextStateSchema.parse(next);
}

export class InMemoryStore {
  private state = emptyState();
  private events: TranscriptEvent[] = [];
  private catchups = new Map<string, CatchupResponse>();
  private sequence = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}
  private nextId = (): string => `sl-${++this.sequence}`;

  getState(): ContextState { return structuredClone(this.state); }

  // Proposals are an internal Engine seam, never accepted from HTTP clients.
  // The Engine can use the application-issued IDs in its new_events batch.
  ingest(input: unknown, propose: (new_events: readonly TranscriptEvent[]) => unknown = () => []) {
    const request = TranscriptRequestSchema.parse(input);
    const new_events = request.events.map(event => ({
      ...event, id: this.nextId(), timestamp: this.now(),
    }));
    const proposal = propose(structuredClone(new_events));
    const next = applyDeltaOps(this.state, proposal, new_events, this.nextId, this.now);
    this.events.push(...new_events);
    this.state = next;
    return { new_events: structuredClone(new_events), state: this.getState() };
  }

  catchup(): CatchupResponse {
    const result = {
      id: this.nextId(), created_at: this.now(),
      state: this.getState(), acknowledged_at: null,
    };
    this.catchups.set(result.id, result);
    return structuredClone(result);
  }

  acknowledgeCatchup(id: string): CatchupResponse | undefined {
    const catchup = this.catchups.get(id);
    if (!catchup) return undefined;
    catchup.acknowledged_at ??= this.now();
    return structuredClone(catchup);
  }

  acknowledgeAttention(id: string) {
    const request = this.state.user_requests.find(item => item.id === id);
    if (!request) return undefined;
    request.acknowledged_at ??= this.now();
    return structuredClone(request);
  }

  reset(): ContextState {
    this.state = emptyState();
    this.events = [];
    this.catchups.clear();
    // Do not recycle IDs: stale acknowledgements must not address new items.
    return this.getState();
  }
}
