import type { ContextState, DeltaOp, TranscriptEvent } from '@senselayer/shared';
import { isExplicitAddress, normalizeText, type UserIdentity } from './vocative.js';

// Preserve meaningful punctuation (C++ vs C#, decimal values, etc.).
export function contextKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

export interface ContextInput {
  state: ContextState;
  transcript: readonly TranscriptEvent[];
  new_events: readonly TranscriptEvent[];
  user: UserIdentity;
}
export interface ContextProvider {
  propose(input: ContextInput): unknown | Promise<unknown>;
}

// Intentionally narrow, documented grammar for offline demos and tests.
// It reads transcript text and state, never fixture-supplied operations.
export class DeterministicProvider implements ContextProvider {
  propose({ state, new_events, user }: ContextInput): DeltaOp[] {
    const ops: DeltaOp[] = [];
    for (const event of new_events) {
      const evidence = { event_ids: [event.id] };
      const text = event.text.trim();
      const topic = /^Topic:\s*(.+)$/i.exec(text);
      const decision = /^(?:Decision:|We decided to|We agreed to)\s*(.+)$/i.exec(text);
      const correction = /^Correction:\s*(.+?)\s*=>\s*(.+)$/i.exec(text);
      const question = /^Question:\s*(.+\?)$/i.exec(text);
      const answer = /^Answer:\s*(.+\?)\s*=>\s*(.+)$/i.exec(text);
      if (topic) ops.push({ op: 'set_topic', text: topic[1]!, ...evidence });
      else if (decision) ops.push({ op: 'add_decision', text: decision[1]!, ...evidence });
      else if (correction) {
        const previous = state.decisions.find(item => !item.superseded_by && contextKey(item.text) === contextKey(correction[1]!));
        if (previous) ops.push({ op: 'add_decision', text: correction[2]!, supersedes_id: previous.id, ...evidence });
      } else if (question) ops.push({ op: 'open_question', text: question[1]!, ...evidence });
      else if (answer) {
        const previous = state.questions.find(item => !item.resolution && contextKey(item.text) === contextKey(answer[1]!));
        if (previous) ops.push({ op: 'resolve_question', question_id: previous.id, text: answer[2]!, ...evidence });
      } else if (isExplicitAddress(text, user) && /\?\s*$/.test(text) && /\byou\b/i.test(text)) {
        ops.push({ op: 'open_question', text, ...evidence });
        ops.push({ op: 'add_user_request', text, ...evidence });
      } else {
        // Explicit assignments ABOUT the configured user are context, not alerts.
        const normalized = normalizeText(text);
        if ([user.name, ...user.aliases].map(normalizeText).filter(Boolean)
          .some(name => normalized.startsWith(`${name} will `))) {
          ops.push({ op: 'add_user_request', text, ...evidence });
        }
      }
    }
    return ops;
  }
}
