import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { FinalTranscripts } from '../apps/web/src/live.js';
import { createTranscriptionSession } from '../apps/server/src/transcription.js';
import { userConfig } from '../apps/server/src/config.js';
import { createApp } from '../apps/server/src/server.js';
import { InMemoryStore } from '../apps/server/src/state.js';
import { SpeakerIdentity } from '../apps/server/src/speakerIdentity.js';
import { TranscriptResponseSchema } from '../packages/shared/src/index.js';

test('live adapter emits only ordered final utterances, once, with application metadata', () => {
  const adapter = new FinalTranscripts('test');
  assert.deepEqual(adapter.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'Partial' }), []);
  for (const item_id of ['a', 'b']) adapter.receive({ type: 'input_audio_buffer.committed', item_id });
  const second = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'b', transcript: 'Second' };
  assert.deepEqual(adapter.receive(second), []);
  const result = adapter.receive({ type: second.type, item_id: 'a', transcript: 'First' });
  assert.deepEqual(result.map(item => [item.text, item.seq, item.final, item.source]), [['First', 1, true, 'live'], ['Second', 2, true, 'live']]);
  assert.ok(result.every(item => item.id.startsWith('live-test-') && !Number.isNaN(Date.parse(item.receivedAt))));
  assert.deepEqual(adapter.receive(second), []);
  adapter.receive({ type: 'input_audio_buffer.committed', item_id: 'empty' });
  assert.deepEqual(adapter.receive({ type: second.type, item_id: 'empty', transcript: ' ' }), []);
});

test('audio intervals follow committed items, even when final words arrive late and out of order', () => {
  const adapter = new FinalTranscripts('capture');
  const first = { sessionId: 'capture', startMs: 1000, endMs: 7000 };
  const second = { sessionId: 'capture', startMs: 8000, endMs: 14000 };
  adapter.recordCommit(first);
  adapter.recordCommit(second);
  for (const item_id of ['a', 'b']) adapter.receive({ type: 'input_audio_buffer.committed', item_id });
  const finalType = 'conversation.item.input_audio_transcription.completed';
  assert.deepEqual(adapter.receive({ type: finalType, item_id: 'b', transcript: 'Second speaker' }), []);
  const results = adapter.receive({ type: finalType, item_id: 'a', transcript: 'First speaker' });
  assert.deepEqual(results.map(event => event.audio), [first, second]);
  assert.ok(results.every(event => Date.parse(event.receivedAt) > second.endMs));
  adapter.recordCommit();
  adapter.receive({ type: 'input_audio_buffer.committed', item_id: 'untimed' });
  assert.equal(adapter.receive({ type: finalType, item_id: 'untimed', transcript: 'No timing' })[0]?.audio, undefined);
});

test('optional speaker capture enriches live text, preserves replay, and resets with the session', async t => {
  const store = new InMemoryStore();
  const speakers = new SpeakerIdentity({ env: {}, enabled: true });
  const controls: unknown[] = [];
  t.mock.method(speakers, 'start', (id: string, label: string) => { controls.push(['start', id, label]); });
  t.mock.method(speakers, 'heartbeat', (id: string) => { controls.push(['heartbeat', id]); });
  t.mock.method(speakers, 'stop', (id: string) => { controls.push(['stop', id]); });
  t.mock.method(speakers, 'reset', () => { controls.push(['reset']); });
  const audio = { sessionId: 'capture', startMs: 1000, endMs: 7000 };
  t.mock.method(speakers, 'identify', (interval: unknown) => { assert.deepEqual(interval, audio); return 'Ivan'; });
  const server = createApp(store, async () => 'v=0\r\nanswer', speakers);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const handshake = await post('/transcription/session', { sdp: 'v=0\r\noffer' });
  assert.equal((await handshake.json()).speakerIdentity, true);
  assert.equal(controls.length, 0, 'a handshake alone never opens another microphone');
  for (const action of ['start', 'heartbeat', 'stop']) {
    const response = await post('/speaker/capture', { action, sessionId: 'capture', ...(action === 'start' ? { deviceLabel: 'Trust GXT 232' } : {}) });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(controls, [['start', 'capture', 'Trust GXT 232'], ['heartbeat', 'capture'], ['stop', 'capture']]);
  const live = { id: 'live-capture-1', seq: 1, text: 'The words arrive later.', final: true, source: 'live', receivedAt: '2026-09-26T12:00:00.000Z', audio };
  assert.equal((await post('/transcript', { ...live, audio: { ...audio, endMs: 0 } })).status, 400);
  const result = TranscriptResponseSchema.parse(await (await post('/transcript', live)).json());
  assert.equal(result.new_events[0]?.speaker, 'Ivan');
  assert.deepEqual(result.new_events[0]?.audio, audio);
  t.mock.method(speakers, 'identify', () => 'Emilio');
  const repeated = await post('/transcript', live);
  assert.equal(repeated.status, 200);
  assert.deepEqual(TranscriptResponseSchema.parse(await repeated.json()).new_events, []);
  assert.equal(store.getTranscript()[0]?.speaker, 'Ivan', 'later evidence cannot change an already saved final event');
  await post('/transcript', { events: [{ speaker: 'Marta', text: 'Replay keeps its own name.' }] });
  assert.equal(store.getTranscript()[1]?.speaker, 'Marta');
  await post('/reset', {});
  assert.deepEqual(controls.at(-1), ['reset']);
  assert.equal(store.getTranscript().length, 0);
});

test('OpenAI handshake uses transcription-only model and backend key with Emilio guidance', async () => {
  const mockedFetch: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-server-secret');
    const form = options?.body as FormData;
    assert.equal(form.get('sdp'), 'v=0\r\noffer');
    const session = JSON.parse(String(form.get('session')));
    assert.deepEqual(session, {
      type: 'transcription', audio: { input: {
        transcription: { model: 'gpt-live-transcribe', keywords: ['Emilio'], languages: ['en'] }, turn_detection: null,
      } },
    });
    return new Response('v=0\r\nanswer');
  };
  assert.equal(await createTranscriptionSession('v=0\r\noffer', 'test-server-secret', mockedFetch), 'v=0\r\nanswer');
  await assert.rejects(createTranscriptionSession('v=0', '', mockedFetch), /OPENAI_API_KEY/);
  await assert.rejects(createTranscriptionSession('v=0', 'key', async () => new Response('secret-provider-body', { status: 401 })), /failed \(401\)/);
});

test('live and replay share the existing engine boundary; interim input is rejected', async t => {
  const store = new InMemoryStore();
  const server = createApp(store, async () => 'v=0\r\nanswer');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const live = { id: 'live-test-1', seq: 1, text: 'Emilio, can you review the demo?', final: true, source: 'live', receivedAt: '2026-09-25T12:00:00.000Z' };
  assert.equal((await post('/transcript', { ...live, final: false })).status, 400);
  assert.equal(store.getTranscript().length, 0);
  const response = await post('/transcript', live);
  assert.equal(response.status, 200);
  const body = TranscriptResponseSchema.parse(await response.json());
  assert.equal(body.new_events[0]!.source, 'live');
  assert.equal(body.new_events[0]!.id, live.id);
  assert.equal(body.state.user_requests[0]!.explicit_address, true);
  assert.deepEqual(TranscriptResponseSchema.parse(await (await post('/transcript', live)).json()).new_events, []);
  assert.equal((await post('/transcript', { events: [{ speaker: 'Ari', text: 'Decision: Ship tomorrow.' }] })).status, 200);
  assert.equal(store.getTranscript().length, 2);
  await store.analyze();
  assert.equal(store.getState().decisions.length, 1);
  const session = await post('/transcription/session', { sdp: 'v=0\r\noffer' });
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await session.json(), { sdp: 'v=0\r\nanswer' });
});

test('transcription and semantic identity share configured names and language', async () => {
  const user = userConfig({ SENSELAYER_USER_NAME: 'Ari', SENSELAYER_USER_ALIASES: ' Ar, Ari ', SENSELAYER_LANGUAGE: 'en' });
  assert.equal(user.name, 'Ari');
  const mockedFetch: typeof fetch = async (_url, options) => {
    const session = JSON.parse(String((options?.body as FormData).get('session')));
    assert.deepEqual(session.audio.input.transcription.keywords, ['Ari', 'Ar']);
    assert.deepEqual(session.audio.input.transcription.languages, ['en']);
    return new Response('v=0\r\nanswer');
  };
  await createTranscriptionSession('v=0\r\noffer', 'test-key', mockedFetch, user);
});
