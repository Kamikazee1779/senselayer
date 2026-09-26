import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { CatchupResponseSchema, TranscriptResponseSchema, SessionResponseSchema } from '../packages/shared/src/index.js';
import { createApp } from '../apps/server/src/server.js';
import { InMemoryStore } from '../apps/server/src/state.js';

test('HTTP engine routes expose real provenance and acknowledge only captured changes', async t => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const first = await post('/transcript', { events: [{ speaker: 'Ari', text: 'Decision: Use staging.' }] });
  assert.equal(first.status, 200);
  const transcript = TranscriptResponseSchema.parse(await first.json());
  const session = SessionResponseSchema.parse(await (await fetch(base + '/session')).json());
  assert.equal(session.state.decisions.length, 1);
  const panel = CatchupResponseSchema.parse(await (await post('/catchup')).json());
  assert.deepEqual(panel.changes[0]!.evidence, transcript.new_events);
  const addressed = await post('/transcript', { events: [{ speaker: 'Ari', text: 'Emilio?' }] });
  const attention = TranscriptResponseSchema.parse(await addressed.json()).attention!;
  assert.equal(attention.length, 1);
  await post('/catchup/ack', { catchup_id: panel.id });
  const next = CatchupResponseSchema.parse(await (await post('/catchup')).json());
  assert.equal(next.changes.length, 1);
  assert.equal(next.changes[0]!.text, 'Emilio?');
  assert.equal((await post(`/attention/${attention[0]}/ack`)).status, 200);
  await post('/reset');
  const reset = CatchupResponseSchema.parse(await (await post('/catchup')).json());
  assert.equal(reset.from_seq, 0);
  assert.equal(reset.upper_bound, 0);
  assert.equal((await post('/catchup/ack', { catchup_id: panel.id })).status, 404);
});

test('HTTP provider failures retain accepted transcript and expose retryable processing error', async t => {
  const store = new InMemoryStore(undefined, { propose() { throw new Error('Provider offline'); } });
  const server = createApp(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/transcript`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events: [{ speaker: 'Ari', text: 'Decision: Use staging' }] }),
  });
  assert.equal(response.status, 200);
  const accepted = TranscriptResponseSchema.parse(await response.json());
  assert.equal(accepted.new_events.length, 1);
  const session = SessionResponseSchema.parse(await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/session`)).json());
  assert.equal(session.processing.status, 'error');
  assert.equal(session.events.length, 1);
  assert.equal(store.lastAnalyzedSeq, 0);
  assert.equal(store.getTranscript().length, 1);
  assert.equal(store.catchup().changes.length, 0);
});
