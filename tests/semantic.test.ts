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

// Notification severity must not invent urgency from a deadline or a name call.
import { notifications } from '../apps/web/src/notifications.js';
import { demoBatches } from '../apps/web/src/fixtures.js';
import { InMemoryStore } from '../apps/server/src/state.js';

test('red notifications require an explicit immediate task with matching source; seen is not completed', () => {
  const state = empty();
  const source = { ...evidence, text: 'Emilio, can you test the login now?' };
  const task = { id: 'task', kind: 'task' as const, text: source.text, created_at: stamp, event_ids: [source.id], acknowledged_at: null, explicit_address: true as const };
  state.user_requests = [task];
  assert.equal(notifications(state, [source])[0]?.level, 'action');
  state.user_requests = [{ ...task, acknowledged_at: stamp }];
  assert.equal(notifications(state, [source]).length, 0);
  assert.equal(outstandingRequests(state).length, 1, 'seen work remains in Summary');
  state.user_requests = [{ ...task, resolved_at: stamp }];
  assert.equal(notifications(state, [source]).length, 0);
  for (const text of ['Emilio, can you test login before Friday?', 'Emilio, can you test login, but not now?', 'Emilio, can you test login later?', 'I thought Emilio would test it now.']) {
    state.user_requests = [{ ...task, text }];
    assert.equal(notifications(state, [{ ...source, text }])[0]?.level, 'attention');
  }
  state.user_requests = [task];
  assert.equal(notifications(state, [evidence])[0]?.level, 'attention', 'ungrounded urgency stays yellow');
  state.user_requests = [{ ...task, kind: 'attention' }];
  assert.equal(notifications(state, [source])[0]?.level, 'attention', 'a direct call is not a task');
});

test('single extended demo supports context, attention and immediate action through the real reducer', async () => {
  const store = new InMemoryStore();
  for (const batch of demoBatches) await store.submit(batch);
  const cards = notifications(store.getState(), store.getTranscript());
  assert.ok(store.getTranscript().length >= 18);
  assert.ok(cards.some(card => card.level === 'context'));
  assert.ok(cards.some(card => card.level === 'attention'));
  assert.ok(cards.some(card => card.level === 'action'));
  assert.equal(store.getState().user_requests.filter(request => request.kind === 'task' && !request.resolved_at).length, 2);
});


test('dismissed cards stay out of notifications without hiding work or duplicating a linked question', () => {
  const state = empty();
  state.questions = [{ id: 'question', text: 'Which layout?', created_at: stamp, event_ids: [evidence.id], resolution: null }];
  state.user_requests = [{ id: 'request', kind: 'question', question_id: 'question', text: 'Which layout?', created_at: stamp, event_ids: [evidence.id], acknowledged_at: stamp }];
  state.decisions = [{ id: 'decision', text: 'Use mobile.', created_at: stamp, event_ids: [evidence.id] }];
  assert.deepEqual(notifications(state, [evidence]).map(card => card.id), ['decision']);
  assert.deepEqual(notifications(state, [evidence], new Set(['decision'])), []);
  assert.equal(semanticItems(state).length, 2);
  state.user_requests.push({ id: 'new-call', kind: 'attention', text: 'Emilio?', created_at: stamp, event_ids: ['new-event'], acknowledged_at: null });
  assert.deepEqual(notifications(state, [evidence], new Set(['decision'])).map(card => card.id), ['new-call']);
});
