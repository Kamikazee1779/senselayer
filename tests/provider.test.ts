import assert from 'node:assert/strict';
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
    { name: 'Alex', aliases: ['Al', 'Lex'] });
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
