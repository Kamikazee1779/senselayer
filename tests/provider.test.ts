import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AnthropicProvider } from '../apps/server/src/anthropic.js';
import { engineConfig } from '../apps/server/src/config.js';
import { DeterministicProvider, type ContextInput } from '../apps/server/src/provider.js';
import { emptyState, InMemoryStore } from '../apps/server/src/state.js';

const input: ContextInput = {
  state: emptyState(), transcript: [], new_events: [], user: { name: 'Emilio', aliases: [] },
};
test('mock is the default and requires no API key; Claude is explicit and validated', () => {
  assert.ok(engineConfig({}).provider instanceof DeterministicProvider);
  assert.throws(() => engineConfig({ CONTEXT_PROVIDER: 'claude' }));
  assert.throws(() => engineConfig({ CONTEXT_PROVIDER: 'unknown' }));
  assert.deepEqual(engineConfig({ SENSELAYER_USER_NAME: 'Alex', SENSELAYER_USER_ALIASES: 'Al, Lex' }).user,
    { name: 'Alex', aliases: ['Al', 'Lex'], language: 'en' });
});

test('Claude adapter sends only context and parses proposals without mutating input', async () => {
  const before = structuredClone(input);
  const provider = new AnthropicProvider('test-key', 'test-model', async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-model');
    assert.match(body.system, /untrusted transcript DATA/);
    assert.deepEqual(JSON.parse(body.messages[0].content), input);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[]' }] });
  });
  assert.deepEqual(await provider.propose(input), []);
  assert.deepEqual(input, before);
});

test('Claude errors, truncation, non-JSON and invalid operations fail closed', async () => {
  const responses = [
    () => new Response('unavailable', { status: 503 }),
    () => Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '[]' }] }),
    () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }),
    () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[{"op":"delete_decision"}]' }] }),
    () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[{"op":"add_decision","id":"model","text":"Bad","event_ids":["sl-1"]}]' }] }),
  ];
  for (const response of responses) {
    const store = new InMemoryStore(undefined, new AnthropicProvider('key', 'model', async () => response()));
    await assert.rejects(store.submit({ events: [{ speaker: 'Ari', text: 'Hello' }] }));
    assert.equal(store.lastAnalyzedSeq, 0);
    assert.deepEqual(store.getState(), emptyState());
  }
});

test('deterministic grammar extracts an explicit reason without inventing one for adjacent speech', () => {
  const stamp = '2026-09-26T10:00:00.000Z';
  const events = [
    { id: 'reason', timestamp: stamp, speaker: 'Sara', text: 'The projector is hard to read.' },
    { id: 'decision', timestamp: stamp, speaker: 'Sara', text: 'Decision: Use mobile.' },
    { id: 'explicit', timestamp: stamp, speaker: 'Sara', text: 'Decision: Increase the text size because the projector is hard to read.' },
  ];
  const result = new DeterministicProvider().propose({ ...input, transcript: events, new_events: events });
  assert.deepEqual(result, [
    { op: 'add_decision', text: 'Use mobile.', event_ids: ['decision'] },
    { op: 'add_decision', text: 'Increase the text size', event_ids: ['explicit'],
      rationale: { text: 'the projector is hard to read.', event_ids: ['explicit'] } },
  ]);
});

test('deterministic direct requests separate work from conversational answers and ignore name reports', () => {
  const events = [
    { id: 'task', timestamp: '2026-09-26T10:00:00.000Z', speaker: 'Sara', text: 'Emilio, can you test the login button?' },
    { id: 'question', timestamp: '2026-09-26T10:00:01.000Z', speaker: 'Luca', text: 'Emilio, what do you think?' },
    { id: 'mention', timestamp: '2026-09-26T10:00:02.000Z', speaker: 'Marta', text: 'I thought Emilio was going to test it.' },
  ];
  assert.deepEqual(new DeterministicProvider().propose({ ...input, transcript: events, new_events: events }), [
    { op: 'add_user_request', kind: 'task', text: events[0]!.text, event_ids: ['task'] },
    { op: 'open_question', text: events[1]!.text, event_ids: ['question'] },
    { op: 'add_user_request', kind: 'question', text: events[1]!.text, event_ids: ['question'] },
  ]);
});

test('offline project replay recovers a reasoned plan change and keeps accepted work incomplete', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/project-meeting.json', import.meta.url), 'utf8')) as {
    batches: { events: { speaker: string; text: string }[] }[];
  };
  const store = new InMemoryStore();
  await store.submit(fixture.batches[0]);
  store.acknowledgeCatchup(store.catchup().id);
  const mention = await store.submit(fixture.batches[1]);
  assert.deepEqual(mention.attention, []);
  await store.submit(fixture.batches[2]);
  assert.equal(store.getState().decisions.length, 1, 'a suggestion does not become a decision');
  await store.submit(fixture.batches[3]);
  const direct = await store.submit(fixture.batches[4]);
  assert.equal(direct.attention?.length, 1);
  const snapshot = store.catchup();
  const current = snapshot.state.decisions.find(item => !item.superseded_by)!;
  assert.match(current.text, /mobile/);
  assert.match(current.rationale!.text, /easier to read on the projector/);
  assert.equal(snapshot.state.decisions[0]!.superseded_by, current.id);
  assert.equal(snapshot.state.questions[0]!.resolution, null);
  const task = snapshot.state.user_requests[0]!;
  assert.equal(task.kind, 'task');
  store.acknowledgeAttention(task.id);
  await store.submit(fixture.batches[5]);
  await store.submit(fixture.batches[6]);
  await store.submit(fixture.batches[7]);
  assert.equal(snapshot.state.questions[0]!.resolution, null, 'the recovery view is a stable snapshot');
  assert.ok(store.getState().questions[0]!.resolution, 'the conversation continues and resolves the question');
  assert.equal(store.getState().user_requests[0]!.resolved_at, undefined, 'accepting or reading a task is not completion');
  store.acknowledgeCatchup(snapshot.id);
  assert.ok(store.catchup().changes.some(change => change.op === 'resolve_question'));
});
