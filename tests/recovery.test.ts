import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import {
  CatchupResponseSchema, SessionResponseSchema, TranscriptResponseSchema, UserRequestSchema,
} from '../packages/shared/src/index.js';
import { createApp } from '../apps/server/src/server.js';
import { InMemoryStore } from '../apps/server/src/state.js';

const now = () => '2026-09-26T12:00:00.000Z';
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function http(t: TestContext, store: InMemoryStore) {
  const server = createApp(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    post: (path: string, body: unknown = {}) => fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    }),
    session: async () => SessionResponseSchema.parse(await (await fetch(base + '/session')).json()),
  };
}

test('HTTP receipt, attention and catch-up stay available while semantic interpretation waits', async t => {
  const waiting = gate();
  t.after(waiting.release);
  const store = new InMemoryStore(now, { async propose(input) {
    await waiting.promise;
    return input.new_events[0]!.text === 'Use mobile.'
      ? [{ op: 'add_decision', text: 'Use mobile.', event_ids: [input.new_events[0]!.id] }] : [];
  } });
  const client = await http(t, store);
  const first = TranscriptResponseSchema.parse(await (await client.post('/transcript', {
    events: [{ speaker: 'Sam', text: 'Use mobile.' }],
  })).json());
  assert.equal(first.processing.status, 'processing');
  assert.equal(first.new_events[0]!.text, 'Use mobile.');
  const addressed = TranscriptResponseSchema.parse(await (await client.post('/transcript', {
    events: [{ speaker: 'Sam', text: 'Emilio?' }],
  })).json());
  assert.equal(addressed.attention!.length, 1);
  const session = await client.session();
  assert.equal(session.events.length, 2);
  assert.equal(session.processing.analyzed_seq, 0);
  assert.ok(session.revision > first.revision);
  const catchup = CatchupResponseSchema.parse(await (await client.post('/catchup')).json());
  assert.equal(catchup.processing.status, 'processing');
  await client.post('/catchup/ack', { catchup_id: catchup.id });
  waiting.release();
  await store.analyze();
  const ready = await client.session();
  assert.equal(ready.processing.status, 'ready');
  assert.equal(ready.processing.analyzed_seq, 2);
  assert.equal(ready.processing.analyzed_at, now());
  assert.equal(catchup.state.decisions.length, 0, 'the already opened snapshot stays unchanged');
  assert.equal(store.catchup().changes.some(change => change.text === 'Use mobile.'), true);
});

test('semantic failure keeps words available and retry accepts without waiting for the provider', async t => {
  let fail = true;
  const waiting = gate();
  t.after(waiting.release);
  const store = new InMemoryStore(now, { async propose(input) {
    if (fail) throw new Error('Private provider diagnostic');
    await waiting.promise;
    return [{ op: 'add_decision', text: 'Use mobile.', event_ids: [input.new_events[0]!.id] }];
  } });
  const client = await http(t, store);
  const receipt = await client.post('/transcript', { events: [{ speaker: 'Sam', text: 'Use mobile.' }] });
  assert.equal(receipt.status, 200);
  const failed = await client.session();
  assert.equal(failed.processing.status, 'error');
  assert.equal(failed.events[0]!.text, 'Use mobile.');
  assert.equal(failed.processing.analyzed_seq, 0);
  assert.doesNotMatch(failed.processing.error!, /Private provider/);
  fail = false;
  const retry = SessionResponseSchema.parse(await (await client.post('/analysis/retry')).json());
  assert.equal(retry.processing.status, 'processing');
  assert.ok(retry.revision > failed.revision);
  waiting.release();
  await store.analyze();
  const ready = await client.session();
  assert.equal(ready.processing.status, 'ready');
  assert.equal(ready.events.length, 1);
  assert.equal(ready.state.decisions.length, 1);
});

test('rationale can cite earlier words, retains those sources, and rejects invented references atomically', () => {
  const store = new InMemoryStore(now);
  const reason = store.ingest({ events: [{ speaker: 'Sam', text: 'The projector makes desktop text too small.' }] }).new_events[0]!;
  const rationale = { text: 'Desktop text is too small on the projector.', event_ids: [reason.id] };
  store.ingest({ events: [{ speaker: 'Sam', text: 'So use mobile.' }] }, events => [{
    op: 'add_decision', text: 'Use mobile.', event_ids: [events[0]!.id], rationale,
  }]);
  assert.deepEqual(store.getState().decisions[0]!.rationale, rationale);
  assert.equal(store.catchup().changes[0]!.evidence.some(event => event.id === reason.id), true);
  const before = store.getState();
  assert.throws(() => store.ingest({ events: [{ speaker: 'Sam', text: 'Use the desktop version.' }] }, events => [{
    op: 'add_decision', text: 'Use desktop.', event_ids: [events[0]!.id],
    rationale: { text: 'Invented reason.', event_ids: ['invented'] },
  }]));
  assert.deepEqual(store.getState(), before);
});

test('a delayed paraphrased task enriches an already seen alert without marking the work complete', async t => {
  const entered = gate(); const waiting = gate();
  t.after(waiting.release);
  const store = new InMemoryStore(now, { async propose(input) {
    entered.release(); await waiting.promise;
    return [{ op: 'add_user_request', text: 'Check the mobile layout.', kind: 'task', event_ids: [input.new_events[0]!.id] }];
  } });
  const pending = store.submit({ events: [{ speaker: 'Sam', text: 'Emilio, can you check the mobile layout?' }] });
  await entered.promise;
  const alert = store.getState().user_requests[0]!;
  assert.equal(alert.kind, 'attention');
  store.acknowledgeAttention(alert.id);
  assert.ok(store.getState().user_requests[0]!.resolved_at);
  const viewed = store.catchup(); store.acknowledgeCatchup(viewed.id);
  waiting.release(); await pending;
  const requests = store.getState().user_requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.id, alert.id);
  assert.equal(requests[0]!.text, 'Check the mobile layout.');
  assert.equal(requests[0]!.kind, 'task');
  assert.ok(requests[0]!.acknowledged_at);
  assert.equal(requests[0]!.resolved_at, undefined);
  assert.equal(store.catchup().changes.length, 1);
  const client = await http(t, store);
  const completed = UserRequestSchema.parse(await (await client.post(`/attention/${alert.id}/complete`)).json());
  assert.ok(completed.resolved_at);
});

test('seen questions resolve with their answer; accepting a task does not complete the task', () => {
  for (const kind of ['question', 'task'] as const) {
    const store = new InMemoryStore(now);
    store.ingest({ events: [{ speaker: 'Sam', text: 'Emilio, can you help?' }] }, events => [
      { op: 'open_question', text: 'Can Emilio help?', event_ids: [events[0]!.id] },
      { op: 'add_user_request', text: 'Can Emilio help?', kind, event_ids: [events[0]!.id] },
    ]);
    const request = store.getState().user_requests[0]!;
    store.acknowledgeAttention(request.id);
    store.ingest({ events: [{ speaker: 'Emilio', text: 'Yes.' }] }, events => [{
      op: 'resolve_question', question_id: request.question_id, text: 'Emilio agreed.', event_ids: [events[0]!.id],
    }]);
    assert.equal(Boolean(store.getState().user_requests[0]!.resolved_at), kind === 'question');
  }
});

test('completion rejects questions instead of leaving a resolved request with an open question', async t => {
  const store = new InMemoryStore(now);
  await store.submit({ events: [{ speaker: 'Sam', text: 'Emilio, what do you think?' }] });
  const request = store.getState().user_requests[0]!;
  const client = await http(t, store);
  const response = await client.post(`/attention/${request.id}/complete`);
  assert.equal(response.status, 409);
  assert.equal(store.getState().user_requests[0]!.resolved_at, undefined);
  assert.equal(store.getState().questions[0]!.resolution, null);
  assert.equal((await client.post('/attention/missing/complete')).status, 404);
});

test('later identical calls return after acknowledgement, replayed event IDs stay idempotent, reset revisions advance', async () => {
  const store = new InMemoryStore(now);
  const first = await store.submit({ events: [{ speaker: 'Sam', text: 'Emilio?' }] });
  store.acknowledgeAttention(first.attention![0]!);
  const second = await store.submit({ events: [{ speaker: 'Sam', text: 'Emilio?' }] });
  assert.equal(second.attention!.length, 1);
  assert.notEqual(second.attention![0], first.attention![0]);
  await store.ingestFinalized(second.new_events);
  assert.equal(store.getState().user_requests.length, 2);
  const revision = store.getSession().revision;
  store.reset();
  assert.ok(store.getSession().revision > revision);
  assert.equal(store.getSession().processing.status, 'ready');
  assert.equal(store.getSession().acknowledged_at, null);
});
