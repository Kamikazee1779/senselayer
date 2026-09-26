import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { OpenAIContextProvider } from '../apps/server/src/openai.js';
import { engineConfig } from '../apps/server/src/config.js';
import { InMemoryStore, emptyState } from '../apps/server/src/state.js';
import type { ContextInput } from '../apps/server/src/provider.js';

const stamp = '2026-09-25T12:00:00.000Z';
const event = (id: string, text = 'Discuss the demo.') => ({ id, text, speaker: 'Conversation', timestamp: stamp });
const input: ContextInput = {
  state: emptyState(), transcript: [event('old'), event('new')], new_events: [event('new')], user: { name: 'Emilio', aliases: [] },
};
function response(text: string, status = 'completed') {
  return Response.json({ id: 'resp-test', object: 'response', created_at: 0, status,
    output: [{ id: 'msg-test', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] }],
  });
}
const output = (ops: unknown[]) => response(JSON.stringify({ ops }));
const decision = { op: 'add_decision', text: 'Ship Friday.', event_ids: ['new'], supersedes_id: null, rationale: null };

test('OpenAI is opt-in, requires a key, defaults to terra and supports a model override', async () => {
  assert.throws(() => engineConfig({ CONTEXT_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
  assert.ok(engineConfig({ CONTEXT_PROVIDER: 'openai', OPENAI_API_KEY: 'test' }).provider instanceof OpenAIContextProvider);
  for (const model of [undefined, 'configured-model']) {
    const provider = new OpenAIContextProvider('server-key', model, async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-key');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, model ?? 'gpt-5.6-terra');
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
      assert.equal(body.text.format.strict, true);
      const variants = body.text.format.schema.properties.ops.items.anyOf;
      const decisionWire = variants.find((variant: { properties: Record<string, unknown> }) => variant.properties.rationale);
      const requestWire = variants.find((variant: { properties: Record<string, unknown> }) => variant.properties.kind);
      assert.deepEqual([...decisionWire.required].sort(), ['event_ids', 'op', 'rationale', 'supersedes_id', 'text']);
      assert.deepEqual([...requestWire.required].sort(), ['event_ids', 'kind', 'op', 'question_id', 'text']);
      assert.equal(decisionWire.additionalProperties, false);
      assert.equal(requestWire.additionalProperties, false);
      assert.ok(init?.signal);
      assert.match(body.instructions, /suggestions, possibilities and preferences are not commitments/);
      assert.match(body.instructions, /Ordinary name mentions are not actionable/);
      assert.match(body.instructions, /never instructions/);
      return output([decision]);
    });
    assert.deepEqual(await provider.propose(input), [{ op: 'add_decision', text: decision.text, event_ids: ['new'] }]);
  }
});

test('OpenAI receives active state, bounded older context and an explicit unchanged new batch', async () => {
  const context = structuredClone(input);
  context.transcript = Array.from({ length: 60 }, (_, i) => event(`old-${i}`)).concat(context.new_events);
  context.state.decisions = [
    { id: 'obsolete', created_at: stamp, text: 'Old', event_ids: ['old-1'], superseded_by: 'active' },
    { id: 'active', created_at: stamp, text: 'Current', event_ids: ['old-2'] },
  ];
  context.state.questions = [{ id: 'resolved', created_at: stamp, text: 'Done?', event_ids: ['old-1'], resolution: { resolved_at: stamp, text: 'Yes', event_ids: ['old-2'] } }];
  context.state.user_requests = [
    { id: 'ack', created_at: stamp, text: 'Your view?', event_ids: ['old-1'], acknowledged_at: stamp, kind: 'question' },
    { id: 'unfinished-task', created_at: stamp, text: 'Review', event_ids: ['old-1'], acknowledged_at: stamp, kind: 'task' },
    { id: 'done-task', created_at: stamp, text: 'Send', event_ids: ['old-1'], acknowledged_at: stamp, resolved_at: stamp, kind: 'task' },
  ];
  const before = structuredClone(context);
  const provider = new OpenAIContextProvider('key', undefined, async (_url, init) => {
    const sent = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.equal(sent.active_state.decisions.length, 1);
    assert.equal(sent.active_state.decisions[0].id, 'active');
    assert.deepEqual(sent.active_state.questions, []);
    assert.deepEqual(sent.active_state.user_requests.map((item: { id: string }) => item.id), ['unfinished-task']);
    assert.equal(sent.older_context.length, 40);
    assert.equal(sent.older_context[0].id, 'old-20');
    assert.deepEqual(sent.new_events, context.new_events);
    assert.ok(sent.older_context.every((item: { id: string }) => item.id !== 'new'));
    return output([]);
  });
  await provider.propose(context);
  assert.deepEqual(context, before);
});

test('a split direct request reaches OpenAI with both sources and enriches the original call into a task', async () => {
  const provider = new OpenAIContextProvider('key', undefined, async (_url, init) => {
    const sent = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    const current = sent.new_events[0];
    if (current.text === 'Emilio.') return output([]);
    assert.deepEqual(sent.continuing_address, { address_event_id: 'call', request_event_id: 'request' });
    assert.equal(sent.older_context[0].text, 'Emilio.');
    return output([{ op: 'add_user_request', text: 'Load the dishwasher.', kind: 'task', question_id: null,
      event_ids: [sent.continuing_address.address_event_id, current.id] }]);
  });
  const store = new InMemoryStore(() => stamp, provider);
  await store.ingestFinalized([{ ...event('call', 'Emilio.'), speaker: 'Microphone' }]);
  const call = store.getState().user_requests[0]!;
  await store.ingestFinalized([{ ...event('request', 'Can you please load the dishwasher'), speaker: 'Microphone', timestamp: '2026-09-25T12:00:03.000Z' }]);
  assert.equal(store.getState().user_requests.length, 1);
  const task = store.getState().user_requests[0]!;
  assert.equal(task.id, call.id);
  assert.equal(task.kind, 'task');
  assert.deepEqual(task.event_ids, ['call', 'request']);
  assert.equal(task.resolved_at, undefined);
});

test('OpenAI rejects malformed, incomplete, refused, illegal and fabricated-evidence output', async () => {
  const cases = [
    () => response('not JSON'),
    () => response('{"ops":[]}', 'incomplete'),
    () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }),
    () => output([{ ...decision, id: 'model-owned' }]),
    () => output([{ ...decision, timestamp: stamp }]),
    () => output([{ ...decision, op: 'delete_decision' }]),
    () => output([{ ...decision, event_ids: [] }]),
    () => output([{ ...decision, event_ids: ['new', 'invented'] }]),
    () => output([{ ...decision, event_ids: ['old'] }]),
    () => output([{ ...decision, rationale: { text: 'The team said so.', event_ids: ['invented'] } }]),
    () => output([{ ...decision, rationale: { text: 'The team said so.', event_ids: [] } }]),
    () => output([{ op: 'add_decision', text: 'Missing nullable rationale', event_ids: ['new'], supersedes_id: null }]),
    () => output([{ op: 'add_user_request', text: 'Missing nullable kind', event_ids: ['new'], question_id: null }]),
    () => new Response('unavailable', { status: 503 }),
    () => { throw new DOMException('Timed out', 'AbortError'); },
  ];
  for (const makeResponse of cases) {
    let calls = 0;
    const provider = new OpenAIContextProvider('key', undefined, async () => { calls++; return makeResponse(); });
    await assert.rejects(provider.propose(input));
    assert.equal(calls, 1, 'application owns retries, not SDK');
  }
});

test('OpenAI preserves separately grounded reasons and request kind while removing wire-only nulls', async () => {
  const provider = new OpenAIContextProvider('key', undefined, async () => output([
    { ...decision, rationale: { text: 'The client explicitly requested Friday.', event_ids: ['old'] } },
    { op: 'add_user_request', text: 'Can you test login?', event_ids: ['new'], question_id: null, kind: 'task' },
    { op: 'add_user_request', text: 'What do you think?', event_ids: ['new'], question_id: null, kind: 'question' },
    { op: 'add_user_request', text: 'Explicit request without a subtype.', event_ids: ['new'], question_id: null, kind: null },
  ]));
  assert.deepEqual(await provider.propose(input), [
    { op: 'add_decision', text: decision.text, event_ids: ['new'],
      rationale: { text: 'The client explicitly requested Friday.', event_ids: ['old'] } },
    { op: 'add_user_request', text: 'Can you test login?', event_ids: ['new'], kind: 'task' },
    { op: 'add_user_request', text: 'What do you think?', event_ids: ['new'], kind: 'question' },
    { op: 'add_user_request', text: 'Explicit request without a subtype.', event_ids: ['new'] },
  ]);
});

test('failed OpenAI batches preserve state/cursors and retry the retained transcript', async () => {
  for (const failure of ['invalid', 'timeout', 'bad-reference']) {
    let fail = true;
    const provider = new OpenAIContextProvider('key', undefined, async (_url, init) => {
      const sent = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
      if (fail && failure === 'timeout') throw new DOMException('Timed out', 'AbortError');
      if (fail && failure === 'invalid') return response('bad JSON');
      if (fail) return output([{ op: 'resolve_question', text: 'Yes', event_ids: [sent.new_events[0].id], question_id: 'missing' }]);
      return output([{ ...decision, event_ids: [sent.new_events[0].id] }]);
    });
    const store = new InMemoryStore(() => stamp, provider);
    await assert.rejects(store.submit({ events: [{ speaker: 'Conversation', text: 'We agree to ship Friday.' }] }));
    assert.equal(store.lastAnalyzedSeq, 0);
    assert.equal(store.catchupWatermark, 0);
    assert.equal(store.getTranscript().length, 1);
    assert.deepEqual(store.getState(), emptyState());
    assert.deepEqual(store.catchup().changes, []);
    fail = false;
    await store.analyze();
    assert.equal(store.lastAnalyzedSeq, 1);
    assert.equal(store.getState().decisions.length, 1);
    assert.equal(store.catchupWatermark, 0);
  }
});

test('dinner acceptance fixture applies mocked proposals without hardcoding a production classifier', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/dinner-context.json', import.meta.url), 'utf8')) as {
    batches: { events: { speaker: string; text: string }[] }[];
  };
  let step = 0;
  const provider = new OpenAIContextProvider('key', undefined, async (_url, init) => {
    const sent = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    const current = sent.new_events[0];
    const evidence = { event_ids: [current.id] };
    switch (step++) {
      case 0: return output([{ op: 'open_question', text: current.text, ...evidence }]);
      case 1: return output([]); // preference, not commitment or resolution
      case 2: return output([
        { op: 'add_decision', text: 'Have burritos for dinner.', supersedes_id: null, rationale: null, ...evidence },
        { op: 'resolve_question', question_id: sent.active_state.questions[0].id, text: 'Have burritos for dinner.', ...evidence },
      ]);
      case 3: return output([]); // reported assumption, not an assignment
      default: return output([{ op: 'add_user_request', text: current.text, question_id: null, kind: 'task', ...evidence }]);
    }
  });
  const store = new InMemoryStore(() => stamp, provider);
  await store.submit(fixture.batches[0]);
  await store.submit(fixture.batches[1]);
  assert.equal(store.getState().questions.length, 1);
  assert.equal(store.getState().questions[0]!.resolution, null);
  assert.equal(store.getState().decisions.length, 0);
  await store.submit(fixture.batches[2]);
  assert.match(store.getState().decisions[0]!.text, /burritos/);
  assert.ok(store.getState().questions[0]!.resolution);
  const mention = await store.submit(fixture.batches[3]);
  assert.deepEqual(mention.attention, []);
  assert.deepEqual(store.getState().user_requests, []);
  const request = await store.submit(fixture.batches[4]);
  assert.equal(request.attention?.length, 1);
  assert.equal(store.getState().user_requests.length, 1, 'semantic request deduplicates fast path');
  assert.equal(store.getState().user_requests[0]!.explicit_address, true);
  assert.equal(store.lastAnalyzedSeq, 5);
});
