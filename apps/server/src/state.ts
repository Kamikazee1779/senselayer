import { randomUUID } from 'node:crypto';
import {
  ContextStateSchema, parseDeltaOps, TranscriptRequestSchema, TranscriptEventSchema,
  requestStatus,
  type ContextState, type TranscriptEvent, type CatchupResponse, type DeltaOp, type SemanticChange,
  type Processing, type SessionResponse, type TranscriptResponse,
} from '@senselayer/shared';
import { contextKey, DeterministicProvider, type ContextProvider } from './provider.js';
import { isExplicitAddress, normalizeText, type UserIdentity } from './vocative.js';

export function emptyState(): ContextState {
  return { topic: null, decisions: [], questions: [], user_requests: [] };
}

export class SemanticBatchError extends Error {}
export class RequestLifecycleError extends Error {}
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
        next.decisions.push({ ...content, id, created_at: now(),
          ...(op.rationale ? { rationale: structuredClone(op.rationale) } : {}),
        });
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
          if (request.question_id === question.id && request.kind !== 'task' && !request.resolved_at) request.resolved_at = resolved_at;
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
        const kind = op.kind ?? (question ? 'question' : 'task');
        // A delayed proposal can enrich the original alert even after it was seen.
        // Match only provisional alerts by source: one transcript chunk can hold
        // several distinct requests, and must not overwrite a classified task.
        const sourceMatch = next.user_requests.find(item => item.explicit_address && item.kind === 'attention' &&
          item.event_ids.some(id => op.event_ids.includes(id)));
        const duplicate = sourceMatch ?? next.user_requests.find(item => !item.resolved_at && sameText(item));
        if (duplicate) {
          const before = JSON.stringify(duplicate);
          if (sourceMatch) {
            if (duplicate.kind === 'attention') delete duplicate.resolved_at;
            duplicate.text = op.text;
            duplicate.event_ids = [...new Set([...duplicate.event_ids, ...op.event_ids])];
          }
          duplicate.kind = kind;
          if (question) duplicate.question_id = question.id;
          if (JSON.stringify(duplicate) !== before) {
            changes.push([op, duplicate.id]);
          }
          break;
        }
        const id = nextId();
        next.user_requests.push({ ...content, id, created_at: now(), acknowledged_at: null, kind,
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
  private readonly instanceId = randomUUID();
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
  private revision = 0;
  private analysisError: string | null = null;
  private acknowledgedAt: string | null = null;
  private watermarkTime: string | null = null;

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

  getProcessing(): Processing {
    return {
      status: this.analysisError ? 'error' : this.analyzedSeq < this.events.length ? 'processing' : 'ready',
      received_seq: this.events.length, analyzed_seq: this.analyzedSeq,
      analyzed_at: this.events[this.analyzedSeq - 1]?.timestamp ?? null,
      error: this.analysisError,
    };
  }

  getSession(): SessionResponse {
    return {
      instance_id: this.instanceId,
      state: this.getState(), events: this.getTranscript(), processing: this.getProcessing(),
      change_seq: this.changes.length, acknowledged_seq: this.watermark,
      acknowledged_at: this.acknowledgedAt, revision: this.revision,
      user: { name: this.user.name, language: this.user.language ?? 'en' },
    };
  }

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
    if (added.length) this.revision++;
    added.forEach(event => this.reservedIds.add(event.id));
    for (const event of added) {
      if (!isExplicitAddress(event.text, this.user)) continue;
      if (this.state.user_requests.some(request => request.explicit_address && requestStatus(request) === 'active' &&
        normalizeText(request.text) === normalizeText(event.text))) continue;
      // Only application code can mark an interruption, never a provider.
      const request = {
        id: this.nextId(), created_at: this.now(), text: event.text,
        event_ids: [event.id], acknowledged_at: null, explicit_address: true as const, kind: 'attention' as const,
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
      evidence: [...new Set([...op.event_ids, ...(op.op === 'add_decision' ? op.rationale?.event_ids ?? [] : [])])]
        .map(id => structuredClone(this.events.find(event => event.id === id)!)),
    });
  }

  private commit(proposal: unknown, batch: readonly TranscriptEvent[], upperBound: number): void {
    const applied: [DeltaOp, string | null][] = [];
    const next = applyDeltaOps(this.state, proposal, batch, this.nextId, this.now, this.events.slice(0, upperBound),
      (op, id) => applied.push([op, id]));
    this.state = next;
    applied.forEach(([op, id]) => this.record(op, id));
    this.analyzedSeq = upperBound;
    this.analysisError = null;
    this.revision++;
  }

  // Preserve the foundation synchronous seam using the same append/commit path.
  ingest(input: unknown, propose: (new_events: readonly TranscriptEvent[]) => unknown = () => []) {
    if (this.pending) throw new Error('Semantic processing is already queued');
    const new_events = this.appendFinalized(this.finalize(input));
    const batch = this.events.slice(this.analyzedSeq);
    this.commit(propose(structuredClone(batch)), batch, this.events.length);
    return this.transcriptResponse(new_events);
  }

  async submit(input: unknown) {
    return this.ingestFinalized(this.finalize(input));
  }

  private transcriptResponse(new_events: TranscriptEvent[]): TranscriptResponse {
    return {
      instance_id: this.instanceId,
      new_events, state: this.getState(), processing: this.getProcessing(), revision: this.revision,
      attention: this.state.user_requests.filter(request => request.explicit_address &&
        request.event_ids.some(id => new_events.some(event => event.id === id))).map(request => request.id),
    };
  }

  // HTTP acknowledges durable-in-this-session receipt without waiting for a model.
  accept(input: unknown): TranscriptResponse { return this.acceptFinalized(this.finalize(input)); }

  acceptFinalized(input: readonly TranscriptEvent[]): TranscriptResponse {
    const new_events = this.appendFinalized(input);
    if (new_events.length || (!this.pending && this.analyzedSeq < this.events.length)) {
      void this.analyze().catch(() => {}); // Failure remains visible through /session.
    }
    return this.transcriptResponse(new_events);
  }

  retryAnalysis(): SessionResponse {
    if (!this.pending && this.analyzedSeq < this.events.length) void this.analyze().catch(() => {});
    return this.getSession();
  }

  // The single TranscriptEvent boundary for replay and future finalized STT.
  async ingestFinalized(input: readonly TranscriptEvent[]) {
    const generation = this.generation;
    const new_events = this.appendFinalized(input);
    await this.analyze();
    if (generation !== this.generation) throw new SemanticBatchError('Session reset during processing');
    return this.transcriptResponse(new_events);
  }

  // A failed batch keeps its transcript and old cursor for the next retry.
  analyze(): Promise<void> {
    const generation = this.generation;
    this.pending++;
    this.analysisError = null;
    this.revision++;
    const run = this.queue.then(async () => {
      if (generation !== this.generation) throw new SemanticBatchError('Session reset during processing');
      if (this.analysisError) { this.analysisError = null; this.revision++; }
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
        if (generation === this.generation) {
          this.analysisError = 'Context analysis failed. Your transcript is retained; retry when ready.';
          this.revision++;
        }
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
      processing: this.getProcessing(), from_time: this.watermarkTime,
    };
    this.catchups.set(result.id, result);
    return structuredClone(result);
  }

  acknowledgeCatchup(id: string): CatchupResponse | undefined {
    const catchup = this.catchups.get(id);
    if (!catchup) return undefined;
    if (!catchup.acknowledged_at) {
      catchup.acknowledged_at = this.now();
      if (catchup.upper_bound > this.watermark || !this.watermarkTime ||
        (catchup.upper_bound === this.watermark && catchup.created_at > this.watermarkTime)) {
        this.watermark = catchup.upper_bound;
        this.watermarkTime = catchup.created_at;
        this.acknowledgedAt = catchup.acknowledged_at;
      }
      this.revision++;
    }
    return structuredClone(catchup);
  }

  acknowledgeAttention(id: string) {
    const request = this.state.user_requests.find(item => item.id === id);
    if (!request) return undefined;
    if (requestStatus(request) === 'active') {
      request.acknowledged_at = this.now();
      if (request.kind === 'attention') request.resolved_at = request.acknowledged_at;
      this.revision++;
    }
    return structuredClone(request);
  }

  completeRequest(id: string) {
    const request = this.state.user_requests.find(item => item.id === id);
    if (!request) return undefined;
    const kind = request.kind ?? (request.question_id ? 'question' : request.explicit_address ? 'attention' : 'task');
    if (kind !== 'task') throw new RequestLifecycleError('Only tasks can be marked complete; questions need an answer.');
    if (!request.resolved_at) {
      request.resolved_at = this.now();
      request.acknowledged_at ??= request.resolved_at;
      this.revision++;
    }
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
    this.analysisError = null;
    this.acknowledgedAt = null;
    this.watermarkTime = null;
    this.revision++;
    // Do not reuse acknowledgement IDs across resets.
    return this.getState();
  }
}
