import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatchupResponse, ContextState, TranscriptEvent } from '../packages/shared/src/contracts.js';
import { catchupItems, outstandingRequests, semanticItems } from '../apps/web/src/semantic.js';

const stamp = '2026-09-26T12:00:00.000Z';
const evidence: TranscriptEvent = { id: 'event-1', timestamp: stamp, speaker: 'Ari', text: 'Use mobile because the room screen is too small.' };
const empty = (): ContextState => ({ topic: null, decisions: [], questions: [], user_requests: [] });
const snapshot = (state: ContextState, changes: CatchupResponse['changes']): CatchupResponse => ({
  id: 'catchup-1', created_at: stamp, acknowledged_at: null, from_time: null, from_seq: 0, upper_bound: changes.length,
  state, changes, processing: { status: 'ready', received_seq: 1, analyzed_seq: 1, analyzed_at: stamp, error: null },
});

test('recovery shows the current instruction, the replaced instruction and an explicitly sourced reason', () => {
  const state = empty();
  state.decisions = [
    { id: 'old', text: 'Use desktop.', created_at: stamp, event_ids: ['event-1'], superseded_by: 'new' },
    { id: 'new', text: 'Use mobile.', created_at: stamp, event_ids: ['event-1'], rationale: { text: 'The room screen is too small.', event_ids: ['event-1'] } },
  ];
  const result = catchupItems(snapshot(state, [
    { seq: 1, op: 'add_decision', entity_id: 'old', text: 'Use desktop.', evidence: [evidence] },
    { seq: 2, op: 'add_decision', entity_id: 'new', supersedes_id: 'old', text: 'Use mobile.', evidence: [evidence] },
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.text, 'Use mobile.');
  assert.equal(result[0]?.previous, 'Use desktop.');
  assert.equal(result[0]?.rationale?.text, 'The room screen is too small.');
});

test('seen tasks remain outstanding, while acknowledged attention and completed tasks do not', () => {
  const state = empty();
  state.user_requests = [
    { id: 'task', kind: 'task', text: 'Test mobile.', created_at: stamp, event_ids: ['event-1'], acknowledged_at: stamp },
    { id: 'question', kind: 'question', text: 'Which layout?', created_at: stamp, event_ids: ['event-1'], acknowledged_at: stamp },
    { id: 'attention', kind: 'attention', text: 'Emilio?', created_at: stamp, event_ids: ['event-1'], acknowledged_at: stamp },
    { id: 'done', kind: 'task', text: 'Fix slides.', created_at: stamp, event_ids: ['event-1'], acknowledged_at: stamp, resolved_at: stamp },
  ];
  assert.deepEqual(outstandingRequests(state).map(item => item.id), ['task', 'question']);
});

test('interval recovery does not pretend to list all older open questions and does not repeat a decision as its resolved question', () => {
  const state = empty();
  state.decisions = [{ id: 'decision', text: 'Use mobile.', created_at: stamp, event_ids: ['event-1'] }];
  state.questions = [
    { id: 'old-question', text: 'Who presents?', created_at: stamp, event_ids: ['event-1'], resolution: null },
    { id: 'resolved-question', text: 'Which layout?', created_at: stamp, event_ids: ['event-1'], resolution: { resolved_at: stamp, text: 'Use mobile.', event_ids: ['event-1'] } },
  ];
  const result = catchupItems(snapshot(state, [
    { seq: 1, op: 'add_decision', entity_id: 'decision', text: 'Use mobile.', evidence: [evidence] },
    { seq: 2, op: 'resolve_question', entity_id: 'resolved-question', text: 'Use mobile.', evidence: [evidence] },
  ]));
  assert.equal(result.length, 1);
  assert.equal(semanticItems(state).find(item => item.key === 'old-question')?.group, 'STILL OPEN');
});
