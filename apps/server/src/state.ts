import {
  ContextStateSchema, parseDeltaOps, TranscriptRequestSchema, TranscriptEventSchema,
  requestStatus,
  type ContextState, type TranscriptEvent, type CatchupResponse, type DeltaOp, type SemanticChange,
} from '@senselayer/shared';
import { contextKey, DeterministicProvider, type ContextProvider } from './provider.js';
import { isExplicitAddress, normalizeText, type UserIdentity } from './vocative.js';

export function emptyState(): ContextState {
  return { topic: null, decisions: [], questions: [], user_requests: [] };
}

export class SemanticBatchError extends Error {}
type Applied = (op: DeltaOp, entityId: string | null) => void;

// Atomic reducer: only commit the returned copy after the whole batch validates.
export function applyDeltaOps(
  state: ContextState, proposal: unknown, new_events: readonly TranscriptEvent[],
  nextId: () => string, now: () => string,
  transcript: readonly TranscriptEvent[] = new_events,
  applied: Applied = () => {},
): ContextState {
  const ops = parseDeltaOps(proposal, new_events, transcript);
  const next = structuredClone(ContextStateSchema.parse(state));
  const changes: [DeltaOp, string | null][] = [];
  for (const op of ops) {
    const content = { text: op.text, event_ids: [...new Set(op.event_ids)] };
    const sameText = (item: { text: string }) => contextKey(item.text) === contextKey(op.text);
    switch (op.op) {
      case 'set_topic':
        if (next.topic && sameText(next.topic)) break;
        next.topic = content;
        changes.push([op, null]);
        break;
      case 'add_decision': {
        const previous = op.supersedes_id ? next.decisions.find(item => item.id === op.supersedes_id) : undefined;
        if (op.supersedes_id && (!previous || previous.superseded_by)) throw new Error('Only an active decision can be superseded');
        const duplicate = next.decisions.find(item => !item.superseded_by && sameText(item));
        if (duplicate) {
          if (previous && previous.id !== duplicate.id) {
            previous.superseded_by = duplicate.id;
            changes.push([op, duplicate.id]);
          }
          break;
        }
        const id = nextId();
        next.decisions.push({ ...content, id, created_at: now() });
        if (previous) previous.superseded_by = id;
        changes.push([op, id]);
        break;
      }
      case 'open_question': {
        if (next.questions.some(item => !item.resolution && sameText(item))) break;
        const id = nextId();
        next.questions.push({ ...content, id, created_at: now(), resolution: null });
        changes.push([op, id]);
        break;
      }
      case 'resolve_question': {
        const question = next.questions.find(item => item.id === op.question_id);
        if (!question || question.resolution !== null) throw new Error('Only an existing open question may be resolved');
        const resolved_at = now();
        question.resolution = { ...content, resolved_at };
        for (const request of next.user_requests) {
          if (request.question_id === question.id && requestStatus(request) === 'active') request.resolved_at = resolved_at;
        }
        changes.push([op, question.id]);
        break;
      }
      case 'add_user_request': {
        // Same-batch pairs can link without a model-created question ID.
        const question = op.question_id
          ? next.questions.find(item => item.id === op.question_id)
          : next.questions.find(item => !item.resolution && sameText(item) && item.event_ids.some(id => op.event_ids.includes(id)));
        if (op.question_id && (!question || question.resolution)) throw new Error('Request must reference an open question');
        const duplicate = next.user_requests.find(item => requestStatus(item) !== 'resolved' && sameText(item));
        if (duplicate) {
          if (question && !duplicate.question_id) {
            duplicate.question_id = question.id;
            changes.push([op, duplicate.id]);
          }
          break;
        }
        const id = nextId();
        next.user_requests.push({ ...content, id, created_at: now(), acknowledged_at: null,
          ...(question ? { question_id: question.id } : {}),
        });
        changes.push([op, id]);
        break;
      }
    }
  }
  const validated = ContextStateSchema.parse(next);
  changes.forEach(([op, id]) => applied(op, id));
  return validated;
}

export class InMemoryStore {
  private state = emptyState();
  private events: TranscriptEvent[] = [];
  private catchups = new Map<string, CatchupResponse>();
  private changes: SemanticChange[] = [];
  private sequence = 0;
  private reservedIds = new Set<string>();
  private analyzedSeq = 0;
  private watermark = 0;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly provider: ContextProvider = new DeterministicProvider(),
    private readonly user: UserIdentity = { name: 'Emilio', aliases: [] },
  ) {}

  private nextId = (): string => {
    let id: string;
    do { id = `sl-${++this.sequence}`; } while (this.reservedIds.has(id));
    this.reservedIds.add(id);
    return id;
  };

  getState(): ContextState { return structuredClone(this.state); }
  getTranscript(): TranscriptEvent[] { return structuredClone(this.events); }
  get lastAnalyzedSeq(): number { return this.analyzedSeq; }
  get catchupWatermark(): number { return this.watermark; }

  // HTTP/replay stamp finalized text. Future STT must filter partial hypotheses
  // before calling this application-owned adapter.
  finalize(input: unknown): TranscriptEvent[] {
    return TranscriptRequestSchema.parse(input).events.map(event => ({
      ...event, id: this.nextId(), timestamp: this.now(),
    }));
  }

  private appendFinalized(input: readonly TranscriptEvent[]): TranscriptEvent[] {
    const parsed = input.map(event => TranscriptEventSchema.parse(event));
    const seen = new Map(this.events.map(event => [event.id, event]));
    const added: TranscriptEvent[] = [];
    for (const event of parsed) {
      const previous = seen.get(event.id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Transcript IDs are immutable');
        continue;
      }
      seen.set(event.id, event);
      added.push(event);
    }
    this.events.push(...added);
    added.forEach(event => this.reservedIds.add(event.id));
    for (const event of added) {
      if (!isExplicitAddress(event.text, this.user)) continue;
      if (this.state.user_requests.some(request => request.explicit_address && requestStatus(request) !== 'resolved' &&
        normalizeText(request.text) === normalizeText(event.text))) continue;
      // Only application code can mark an interruption, never a provider.
      const request = {
        id: this.nextId(), created_at: this.now(), text: event.text,
        event_ids: [event.id], acknowledged_at: null, explicit_address: true as const,
      };
      this.state.user_requests.push(request);
      this.record({ op: 'add_user_request', text: event.text, event_ids: [event.id] }, request.id);
    }
    return structuredClone(added);
  }

  private record(op: DeltaOp, entity_id: string | null): void {
    this.changes.push({
      seq: this.changes.length + 1, op: op.op, entity_id, text: op.text,
      ...(op.op === 'add_decision' && op.supersedes_id ? { supersedes_id: op.supersedes_id } : {}),
      evidence: [...new Set(op.event_ids)].map(id => structuredClone(this.events.find(event => event.id === id)!)),
    });
  }

  private commit(proposal: unknown, batch: readonly TranscriptEvent[], upperBound: number): void {
    const applied: [DeltaOp, string | null][] = [];
    const next = applyDeltaOps(this.state, proposal, batch, this.nextId, this.now, this.events.slice(0, upperBound),
      (op, id) => applied.push([op, id]));
    this.state = next;
    applied.forEach(([op, id]) => this.record(op, id));
    this.analyzedSeq = upperBound;
  }

  // Preserve the foundation synchronous seam using the same append/commit path.
  ingest(input: unknown, propose: (new_events: readonly TranscriptEvent[]) => unknown = () => []) {
    if (this.pending) throw new Error('Semantic processing is already queued');
    const new_events = this.appendFinalized(this.finalize(input));
    const batch = this.events.slice(this.analyzedSeq);
    this.commit(propose(structuredClone(batch)), batch, this.events.length);
    return { new_events, state: this.getState() };
  }

  async submit(input: unknown) {
    return this.ingestFinalized(this.finalize(input));
  }

  // The single TranscriptEvent boundary for replay and future finalized STT.
  async ingestFinalized(input: readonly TranscriptEvent[]) {
    const generation = this.generation;
    const new_events = this.appendFinalized(input);
    await this.analyze();
    if (generation !== this.generation) throw new SemanticBatchError('Session reset during processing');
    return {
      new_events, state: this.getState(),
      attention: this.state.user_requests.filter(request => request.explicit_address &&
        request.event_ids.some(id => new_events.some(event => event.id === id))).map(request => request.id),
    };
  }

  // A failed batch keeps its transcript and old cursor for the next retry.
  analyze(): Promise<void> {
    const generation = this.generation;
    this.pending++;
    const run = this.queue.then(async () => {
      if (generation !== this.generation) throw new SemanticBatchError('Session reset during processing');
      const upperBound = this.events.length;
      try {
        // Ordered one-event semantic batches let later events reference entities
        // created by earlier events, including within one HTTP submission.
        while (this.analyzedSeq < upperBound) {
          const nextSeq = this.analyzedSeq + 1;
          const batch = this.events.slice(this.analyzedSeq, nextSeq);
          const proposal = await this.provider.propose({
            state: this.getState(), transcript: structuredClone(this.events.slice(0, nextSeq)),
            new_events: structuredClone(batch), user: structuredClone(this.user),
          });
          if (generation !== this.generation) throw new Error('Session reset during processing');
          // Preserve acks and fast-path requests received while the provider waited.
          this.commit(proposal, batch, nextSeq);
        }
      } catch (error) {
        throw new SemanticBatchError('Semantic batch failed; finalized events retained for retry', { cause: error });
      }
    }).finally(() => { if (generation === this.generation) this.pending--; });
    this.queue = run.catch(() => {});
    return run;
  }

  catchup(): CatchupResponse {
    const upper_bound = this.changes.length;
    const result: CatchupResponse = {
      id: this.nextId(), created_at: this.now(), state: this.getState(), acknowledged_at: null,
      from_seq: this.watermark, upper_bound,
      changes: structuredClone(this.changes.slice(this.watermark, upper_bound)),
    };
    this.catchups.set(result.id, result);
    return structuredClone(result);
  }

  acknowledgeCatchup(id: string): CatchupResponse | undefined {
    const catchup = this.catchups.get(id);
    if (!catchup) return undefined;
    catchup.acknowledged_at ??= this.now();
    this.watermark = Math.max(this.watermark, catchup.upper_bound);
    return structuredClone(catchup);
  }

  acknowledgeAttention(id: string) {
    const request = this.state.user_requests.find(item => item.id === id);
    if (!request) return undefined;
    if (requestStatus(request) === 'active') request.acknowledged_at = this.now();
    return structuredClone(request);
  }

  reset(): ContextState {
    this.generation++;
    this.state = emptyState();
    this.events = [];
    this.changes = [];
    this.catchups.clear();
    this.analyzedSeq = 0;
    this.watermark = 0;
    this.queue = Promise.resolve();
    this.pending = 0;
    // Do not reuse acknowledgement IDs across resets.
    return this.getState();
  }
}
