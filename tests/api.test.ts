import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  StateResponseSchema, TranscriptResponseSchema, CatchupResponseSchema,
  CatchupAckResponseSchema, AttentionAckResponseSchema, ResetResponseSchema, ErrorResponseSchema,
} from '../packages/shared/src/index.js';
import { createApp } from '../apps/server/src/server.js';
import { InMemoryStore, emptyState } from '../apps/server/src/state.js';

test('HTTP routes honor shared request and response contracts', async t => {
  const store = new InMemoryStore();
  const server = createApp(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const initial = await fetch(`${base}/state`);
  assert.equal(initial.status, 200);
  assert.deepEqual(StateResponseSchema.parse(await initial.json()), emptyState());
  const transcript = await post('/transcript', { events: [{ speaker: 'Sam', text: 'Hello.' }] });
  assert.equal(transcript.status, 200);
  const result = TranscriptResponseSchema.parse(await transcript.json());
  assert.equal(result.new_events.length, 1);
  assert.deepEqual(result.state, emptyState()); // No semantic engine yet.
  const invalid = await post('/transcript', { events: [{ id: 'model-owned', speaker: 'Sam', text: 'Hi' }] });
  assert.equal(invalid.status, 400);
  ErrorResponseSchema.parse(await invalid.json());
  const malformed = await fetch(`${base}/transcript`, { method: 'POST', body: '{' });
  assert.equal(malformed.status, 400);
  const caught = await post('/catchup');
  assert.equal(caught.status, 200);
  const catchup = CatchupResponseSchema.parse(await caught.json());
  const caughtAck = await post('/catchup/ack', { catchup_id: catchup.id });
  assert.equal(caughtAck.status, 200);
  assert.ok(CatchupAckResponseSchema.parse(await caughtAck.json()).acknowledged_at);
  assert.equal((await post('/catchup/ack', { catchup_id: 'missing' })).status, 404);
  store.ingest({ events: [{ speaker: 'Sam', text: 'Please reply.' }] }, events => [
    { op: 'add_user_request', text: 'Please reply.', event_ids: [events[0]!.id] },
  ]);
  const requestId = store.getState().user_requests[0]!.id;
  const attention = await post(`/attention/${requestId}/ack`);
  assert.equal(attention.status, 200);
  assert.ok(AttentionAckResponseSchema.parse(await attention.json()).acknowledged_at);
  assert.equal((await post('/attention/missing/ack')).status, 404);
  assert.equal((await post('/reset', { unexpected: true })).status, 400);
  const reset = await post('/reset');
  assert.equal(reset.status, 200);
  assert.deepEqual(ResetResponseSchema.parse(await reset.json()), emptyState());
  assert.equal((await post('/catchup/ack', { catchup_id: catchup.id })).status, 404);
});
