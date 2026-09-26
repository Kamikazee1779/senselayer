import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  ContextStateSchema, DeltaOpSchema, parseDeltaOps, TranscriptRequestSchema,
  type TranscriptRequest,
} from '../packages/shared/src/index.js';
import { InMemoryStore, emptyState } from '../apps/server/src/state.js';

const timestamp = '2026-09-25T12:00:00.000Z';
const event = { id: 'current', timestamp, speaker: 'Sam', text: 'Demo today.' };
const decision = { op: 'add_decision', text: 'Demo today.', event_ids: ['current'] };

for (const name of ['topic-and-decision', 'question-resolution', 'user-request']) {
  test(`replay ${name}`, async () => {
    const fixture = JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as {
      batches: { events: TranscriptRequest['events']; ops: unknown }[];
      expected: unknown;
    };
    const store = new InMemoryStore(() => timestamp);
    for (const batch of fixture.batches) store.ingest({ events: batch.events }, () => batch.ops);
    const expected = ContextStateSchema.parse(fixture.expected);
    expected.user_requests.forEach(request => { request.kind ??= request.question_id ? 'question' : 'task'; });
    assert.deepEqual(store.getState(), expected);
  });
}

test('every operation requires current batch evidence', () => {
  const operations = [
    { op: 'set_topic' }, { op: 'add_decision' }, { op: 'open_question' },
    { op: 'resolve_question', question_id: 'question' }, { op: 'add_user_request' },
  ];
  for (const operation of operations) {
    const base = { ...operation, text: 'Content' };
    assert.throws(() => parseDeltaOps([base], [event]));
    for (const ids of [[], ['old'], ['current', 'old']]) {
      assert.throws(() => parseDeltaOps([{ ...base, event_ids: ids }], [event]));
    }
    assert.equal(parseDeltaOps([{ ...base, event_ids: ['current'] }], [event]).length, 1);
  }
  assert.throws(() => parseDeltaOps([decision], []));
});

test('model cannot issue IDs, timestamps, lifecycle flags or arbitrary mutations', () => {
  for (const field of ['id', 'created_at', 'timestamp', 'acknowledged_at', 'resolution', 'status']) {
    assert.equal(DeltaOpSchema.safeParse({ ...decision, [field]: 'injected' }).success, false);
  }
  assert.equal(DeltaOpSchema.safeParse({ op: 'delete_decision', event_ids: ['current'] }).success, false);
  assert.equal(TranscriptRequestSchema.safeParse({ events: [event] }).success, false);
});

test('invalid transitions are atomic and resolved questions cannot resolve again', () => {
  const store = new InMemoryStore(() => timestamp);
  const ingest = (ops: (id: string) => unknown) => store.ingest(
    { events: [{ speaker: 'Sam', text: 'Demo.' }] }, events => ops(events[0]!.id),
  );
  assert.throws(() => ingest(id => [
    { op: 'set_topic', text: 'Should not persist', event_ids: [id] },
    { op: 'resolve_question', question_id: 'missing', text: 'Answer', event_ids: [id] },
  ]));
  assert.deepEqual(store.getState(), emptyState());
  ingest(id => [{ op: 'open_question', text: 'When?', event_ids: [id] }]);
  const questionId = store.getState().questions[0]!.id;
  const resolve = (id: string) => [{ op: 'resolve_question', question_id: questionId, text: 'Today', event_ids: [id] }];
  ingest(resolve);
  const before = store.getState();
  assert.throws(() => ingest(resolve));
  assert.deepEqual(store.getState(), before);
});

test('acknowledgements are idempotent, snapshots are isolated, reset invalidates old IDs', () => {
  let tick = 0;
  const store = new InMemoryStore(() => new Date(Date.UTC(2026, 8, 25, 12, 0, tick++)).toISOString());
  store.ingest({ events: [{ speaker: 'Sam', text: 'Please reply.' }] }, events => [
    { op: 'add_user_request', text: 'Please reply.', event_ids: [events[0]!.id] },
  ]);
  const requestId = store.getState().user_requests[0]!.id;
  const catchup = store.catchup();
  const ack = store.acknowledgeAttention(requestId)!;
  assert.ok(ack.acknowledged_at);
  assert.deepEqual(store.acknowledgeAttention(requestId), ack);
  assert.equal(catchup.state.user_requests[0]!.acknowledged_at, null);
  const catchupAck = store.acknowledgeCatchup(catchup.id)!;
  assert.ok(catchupAck.acknowledged_at);
  assert.deepEqual(store.acknowledgeCatchup(catchup.id), catchupAck);
  const copy = store.getState();
  copy.user_requests.length = 0;
  assert.equal(store.getState().user_requests.length, 1);
  assert.deepEqual(store.reset(), emptyState());
  assert.equal(store.acknowledgeAttention(requestId), undefined);
  assert.equal(store.acknowledgeCatchup(catchup.id), undefined);
  assert.notEqual(store.catchup().id, catchup.id);
});
