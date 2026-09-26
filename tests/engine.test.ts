import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  parseDeltaOps, requestStatus, questionStatus, type TranscriptEvent,
} from '../packages/shared/src/index.js';
import { InMemoryStore, emptyState } from '../apps/server/src/state.js';
import { DeterministicProvider, type ContextProvider } from '../apps/server/src/provider.js';
import { isExplicitAddress } from '../apps/server/src/vocative.js';
import { replay } from '../apps/server/src/replay.js';

const user = { name: 'Emilio', aliases: ['Emi', 'E. M.'] };
const now = () => '2026-09-25T12:00:00.000Z';
const say = (store: InMemoryStore, text: string) => store.submit({ events: [{ speaker: 'Ari', text }] });
const event = (id: string, text = 'Hello'): TranscriptEvent => ({ id, timestamp: now(), speaker: 'Ari', text });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

test('explicit vocatives recognize exact configured names and aliases', () => {
  for (const text of [
    'Emilio?', 'Hey Emilio', 'Emilio, you should see this.', 'Emilio, can you help?',
    'Emilio, could you help?', 'Emilio, would you help?', 'Emilio, do you agree?',
    'Emilio, are you ready?', 'Emilio, what do you think?', 'Emilio, please reply.',
    'HEY, EMILIO!', 'emi?', 'E. M., can you help?', 'Emilio—please listen.',
  ]) assert.equal(isExplicitAddress(text, user), true, text);
});

test('ordinary mentions, third-person assignments and near names never interrupt', () => {
  for (const text of [
    'Emilio said the server was broken', 'I spoke with Emilio yesterday',
    'Emilio can handle deployment', 'Emilio will handle deployment', 'Could Emilio handle deployment?',
    'Emilion, can you help?', 'Emilio2?', 'Emillio?', 'Emilio said, "can you help?"',
    'He asked, "Hey Emilio"', 'Emilio could help', 'Hey Emilio said hello',
  ]) assert.equal(isExplicitAddress(text, user), false, text);
});

test('explicit address is immediate even while semantics waits; assignments produce no alert', async () => {
  const entered = gate(); const waiting = gate();
  const provider: ContextProvider = { async propose() { entered.release(); await waiting.promise; return []; } };
  const store = new InMemoryStore(now, provider, user);
  const pending = say(store, 'Hey Emilio');
  await entered.promise;
  const request = store.getState().user_requests[0]!;
  assert.equal(request.explicit_address, true);
  assert.equal(store.lastAnalyzedSeq, 0);
  store.acknowledgeAttention(request.id);
  waiting.release();
  assert.deepEqual((await pending).attention, [request.id]);
  assert.equal(requestStatus(store.getState().user_requests[0]!), 'resolved');
  const slow = new InMemoryStore(now);
  assert.deepEqual((await say(slow, 'Emilio will handle deployment')).attention, []);
  assert.equal(slow.getState().user_requests[0]!.explicit_address, undefined);
  await say(slow, 'Emilio said the server was broken');
  assert.equal(slow.getState().user_requests.length, 1);
});

test('decisions require explicit commitment; duplicates are inert and corrections retain history', async () => {
  const store = new InMemoryStore(now);
  await say(store, 'Maybe we could use staging.');
  assert.deepEqual(store.getState(), emptyState());
  await say(store, 'Decision: Use staging.');
  const original = store.getState().decisions[0]!;
  await say(store, 'Decision: Use staging.');
  assert.equal(store.getState().decisions.length, 1);
  assert.equal(store.catchup().changes.length, 1);
  await say(store, 'Correction: Use staging. => Use production.');
  const decisions = store.getState().decisions;
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0]!.id, original.id);
  assert.equal(decisions[0]!.superseded_by, decisions[1]!.id);
  assert.equal(store.catchup().changes[1]!.supersedes_id, original.id);
});

test('deduplication preserves semantic punctuation and can supersede into an existing decision', async () => {
  const store = new InMemoryStore(now);
  await say(store, 'Decision: Use C++');
  await say(store, 'Decision: Use C#');
  assert.equal(store.getState().decisions.length, 2);
  await say(store, 'Correction: Use C++ => Use C#');
  const decisions = store.getState().decisions;
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0]!.superseded_by, decisions[1]!.id);
});

test('questions and related active requests resolve deterministically in multi-event input', async () => {
  const store = new InMemoryStore(now);
  await store.submit({ events: [
    { speaker: 'Ari', text: 'Emilio, what do you think?' },
    { speaker: 'Sam', text: 'Answer: Emilio, what do you think? => Emilio explicitly agreed.' },
  ] });
  const state = store.getState();
  assert.equal(state.questions.length, 1);
  assert.equal(questionStatus(state.questions[0]!), 'resolved');
  assert.equal(state.user_requests.length, 1);
  assert.equal(state.user_requests[0]!.question_id, state.questions[0]!.id);
  assert.equal(requestStatus(state.user_requests[0]!), 'resolved');
  assert.equal(store.lastAnalyzedSeq, 2);
});

test('repeated topic, open question, assignment and vocative do not duplicate context', async () => {
  const store = new InMemoryStore(now);
  for (let i = 0; i < 2; i++) {
    await say(store, 'Topic: Release');
    await say(store, 'Question: Who presents?');
    await say(store, 'Emilio will handle deployment');
    await say(store, 'Hey Emilio');
  }
  assert.equal(store.getState().questions.length, 1);
  assert.equal(store.getState().user_requests.length, 2);
  assert.equal(store.catchup().changes.length, 4);
});

test('evidence requires real log IDs and at least one new event; quotes are not model input fields', () => {
  const old = event('old'); const current = event('new');
  const op = { op: 'add_decision', text: 'Use staging', event_ids: ['old', 'new'] };
  assert.equal(parseDeltaOps([op], [current], [old, current]).length, 1);
  assert.throws(() => parseDeltaOps([{ ...op, event_ids: ['old'] }], [current], [old, current]));
  assert.throws(() => parseDeltaOps([{ ...op, event_ids: ['missing', 'new'] }], [current], [old, current]));
  assert.throws(() => parseDeltaOps([{ ...op, quote: 'Invented evidence' }], [current], [old, current]));
  assert.throws(() => parseDeltaOps([{ ...op, explicit_address: true }], [current], [old, current]));
});

test('invalid semantic batches retain cursor and transcript for retry with atomic state', async () => {
  let valid = false;
  const batches: string[][] = [];
  const provider: ContextProvider = { propose(input) {
    batches.push(input.new_events.map(item => item.id));
    return [
      { op: 'set_topic', text: 'Release', event_ids: [input.new_events[0]!.id] },
      { op: 'add_decision', text: 'Use staging', event_ids: [valid ? input.new_events[0]!.id : 'invented'] },
    ];
  } };
  const store = new InMemoryStore(now, provider);
  await assert.rejects(say(store, 'Decision: Use staging'));
  assert.equal(store.lastAnalyzedSeq, 0);
  assert.equal(store.getTranscript().length, 1);
  assert.deepEqual(store.getState(), emptyState());
  assert.equal(store.catchup().changes.length, 0);
  valid = true;
  await store.analyze();
  assert.equal(store.lastAnalyzedSeq, 1);
  assert.deepEqual(batches[0], batches[1]);
  assert.equal(store.getState().decisions.length, 1);
  await store.analyze();
  assert.equal(batches.length, 2);
});

test('provider calls serialize and each sees only the unanalyzed suffix', async () => {
  const entered = gate(); const waiting = gate();
  let active = 0; let maximum = 0;
  const batches: string[][] = [];
  const provider: ContextProvider = { async propose(input) {
    active++; maximum = Math.max(maximum, active);
    batches.push(input.new_events.map(item => item.text));
    if (batches.length === 1) { entered.release(); await waiting.promise; }
    active--;
    return new DeterministicProvider().propose(input);
  } };
  const store = new InMemoryStore(now, provider);
  const first = say(store, 'Decision: A');
  await entered.promise;
  const second = say(store, 'Decision: B');
  assert.throws(() => store.ingest({ events: [{ speaker: 'Sam', text: 'C' }] }));
  assert.equal(batches.length, 1);
  waiting.release();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
  assert.deepEqual(batches, [['Decision: A'], ['Decision: B']]);
  assert.equal(store.lastAnalyzedSeq, 2);
});

test('catch-up captures an immutable upper bound and only acknowledgement advances the watermark', async () => {
  const store = new InMemoryStore(now);
  await say(store, 'Decision: A');
  const first = store.catchup();
  assert.equal(store.catchupWatermark, 0);
  await say(store, 'Decision: B');
  assert.equal(first.changes.length, 1);
  assert.equal(store.catchup().changes.length, 2);
  store.acknowledgeCatchup(first.id);
  assert.equal(store.catchupWatermark, first.upper_bound);
  const second = store.catchup();
  assert.deepEqual(second.changes.map(change => change.text), ['B']);
  assert.equal(second.changes[0]!.evidence[0]!.text, 'Decision: B');
  store.acknowledgeCatchup(second.id);
  store.acknowledgeCatchup(first.id);
  assert.equal(store.catchupWatermark, second.upper_bound);
  assert.equal(store.catchup().changes.length, 0);
  assert.equal(store.acknowledgeCatchup('invented'), undefined);
});

test('pending semantic results remain unseen after an earlier catch-up is acknowledged', async () => {
  const entered = gate(); const waiting = gate();
  const store = new InMemoryStore(now, { async propose(input) {
    entered.release(); await waiting.promise;
    return new DeterministicProvider().propose(input);
  } });
  const pending = say(store, 'Decision: A');
  await entered.promise;
  const panel = store.catchup();
  assert.equal(panel.upper_bound, 0);
  waiting.release(); await pending;
  store.acknowledgeCatchup(panel.id);
  assert.equal(store.catchup().changes.length, 1);
});

test('finalized replay is idempotent, conflicting IDs and partial events are rejected', async () => {
  let calls = 0;
  const store = new InMemoryStore(now, { propose() { calls++; return []; } });
  const finalized = store.finalize({ events: [{ speaker: 'Ari', text: 'Hello' }] });
  await store.ingestFinalized(finalized);
  await store.ingestFinalized(finalized);
  assert.equal(calls, 1);
  assert.equal(store.getTranscript().length, 1);
  await assert.rejects(store.ingestFinalized([{ ...finalized[0]!, text: 'Changed' }]));
  for (const flag of [{ final: false }, { is_final: false }, { partial: true }]) {
    await assert.rejects(store.submit({ events: [{ speaker: 'Ari', text: 'Partial', ...flag }] }));
    // Deliberately bypass static typing to verify the runtime input boundary.
    await assert.rejects(store.ingestFinalized([{ ...event('partial'), ...flag } as TranscriptEvent]));
  }
  assert.equal(calls, 1);
});

test('reset cancels stale provider commits and clears both cursors, log and acknowledgements', async () => {
  const entered = gate(); const waiting = gate(); let calls = 0;
  const store = new InMemoryStore(now, { async propose(input) {
    if (++calls === 1) { entered.release(); await waiting.promise; }
    return new DeterministicProvider().propose(input);
  } });
  const pending = say(store, 'Emilio, can you review?');
  const rejected = assert.rejects(pending);
  await entered.promise;
  const requestId = store.getState().user_requests[0]!.id;
  const panel = store.catchup();
  store.acknowledgeCatchup(panel.id);
  store.reset();
  assert.equal(store.lastAnalyzedSeq, 0);
  assert.equal(store.catchupWatermark, 0);
  assert.deepEqual(store.getTranscript(), []);
  assert.deepEqual(store.getState(), emptyState());
  assert.equal(store.acknowledgeAttention(requestId), undefined);
  assert.equal(store.acknowledgeCatchup(panel.id), undefined);
  await say(store, 'Decision: New session');
  waiting.release(); await rejected;
  assert.equal(store.getState().decisions[0]!.text, 'New session');
  assert.equal(store.getState().questions.length, 0);
  assert.equal(store.lastAnalyzedSeq, 1);
});

test('replay and HTTP-adapter ingestion produce identical engine state without fixture operations', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/engine-replay.json', import.meta.url), 'utf8')) as {
    batches: { events: { speaker: string; text: string }[] }[];
  };
  const replayStore = new InMemoryStore(now);
  const httpStore = new InMemoryStore(now);
  const caught = await replay(replayStore, fixture);
  for (const batch of fixture.batches) await httpStore.submit(batch);
  assert.deepEqual(replayStore.getState(), httpStore.getState());
  assert.deepEqual(replayStore.getTranscript(), httpStore.getTranscript());
  assert.equal(replayStore.lastAnalyzedSeq, 10);
  assert.equal(caught.state.decisions.length, 2);
  assert.ok(caught.state.decisions[0]!.superseded_by);
  assert.ok(caught.state.questions.every(question => questionStatus(question) === 'resolved'));
  assert.equal(caught.state.user_requests.filter(request => request.kind === 'task' && !request.resolved_at).length, 2);
});
