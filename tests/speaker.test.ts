import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { test } from 'node:test';
import { SpeakerIdentity, speakerForInterval, type SpeakerObservation } from '../apps/server/src/speakerIdentity.js';

const device = 'Micrófono (Trust GXT 232 Microphone)';
const sessionId = 'mic-session';
const observation = (speaker: string, startMs: number, endMs: number): SpeakerObservation => ({ speaker, startMs, endMs, score: 0.7, margin: 0.3 });

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  input = '';
  kills: NodeJS.Signals[] = [];
  constructor() {
    super();
    this.stdin.on('data', chunk => { this.input += chunk.toString(); });
  }
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.kills.push(signal);
    this.emit('close', 0);
    return true;
  }
  send(value: object) { this.stdout.write(`${JSON.stringify(value)}\n`); }
}

function setup(overrides: NodeJS.ProcessEnv = {}) {
  let now = 10_000;
  let spawns = 0;
  const child = new FakeChild();
  const logs: string[] = [];
  const identity = new SpeakerIdentity({
    env: { SENSELAYER_SPEAKER_ID_ENABLED: '1', ...overrides }, now: () => now, log: message => logs.push(message),
    spawnProcess: () => { spawns += 1; return child as unknown as ChildProcessWithoutNullStreams; },
  });
  return {
    identity, child, logs, setNow: (time: number) => { now = time; }, spawns: () => spawns,
    start: () => { identity.start(sessionId, device); child.send({ type: 'ready', deviceName: device }); },
    send: (speaker: string, startMs: number, endMs: number, extra = {}) => {
      now = endMs;
      child.send({ type: 'speaker_identity', ...observation(speaker, startMs, endMs), ...extra });
    },
  };
}

test('disabled recognition does not spawn and preserves normal Microphone label', () => {
  const instance = setup({ SENSELAYER_SPEAKER_ID_ENABLED: '0' });
  instance.start();
  assert.equal(instance.spawns(), 0);
  assert.equal(instance.identity.identify(), 'Microphone');
  instance.identity.dispose();
});

test('missing Python, process errors and broken pipes do not escape optional recognition', () => {
  const missing = new SpeakerIdentity({ enabled: true, env: {}, log: () => {}, spawnProcess: () => { throw new Error('ENOENT'); } });
  assert.doesNotThrow(() => missing.start(sessionId, device));
  assert.equal(missing.identify(), 'Unknown');
  missing.dispose();
  const instance = setup();
  instance.start();
  assert.doesNotThrow(() => instance.child.emit('error', new Error('ENOENT')));
  assert.doesNotThrow(() => instance.child.stdin.emit('error', new Error('EPIPE')));
  assert.equal(instance.identity.identify(), 'Unknown');
  instance.identity.dispose();
});

test('late transcript A retains A after B is recognized, including after microphone stop', () => {
  const instance = setup();
  instance.start();
  instance.send('Ivan', 10_000, 13_000);
  instance.send('Ivan', 11_500, 14_500);
  instance.send('Emilio', 16_000, 19_000);
  instance.send('Emilio', 17_500, 20_500);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Ivan');
  assert.equal(instance.identity.identify({ sessionId, startMs: 16_000, endMs: 20_500 }), 'Emilio');
  assert.equal(instance.identity.identify({ sessionId: 'another-session', startMs: 10_000, endMs: 14_500 }), 'Unknown');
  assert.ok(instance.logs.some(line => line.includes('Audio 0-3s -> Ivan | score=0.700 margin=0.300')));
  assert.ok(instance.logs.some(line => line.includes('Audio 1.5-4.5s -> Ivan')), 'window diagnostics are not suppressed by warning throttling');
  assert.ok(instance.logs.some(line => line.includes('Transcript 0-4.5s -> Ivan')), 'delayed attribution is distinct from the current audio match');
  instance.identity.stop(sessionId);
  assert.match(instance.child.input, /"type":"stop"/);
  instance.setNow(30_000);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Ivan', 'STT delivery time does not expire valid audio evidence');
  instance.setNow(80_000);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown', 'history remains bounded');
  instance.identity.dispose();
});

test('short turns, gaps, uncovered audio, Unknown and conflicting boundary windows reject a name', () => {
  const stable = [observation('Ivan', 0, 3000), observation('Ivan', 1500, 4500)];
  assert.equal(speakerForInterval({ startMs: 0, endMs: 4500 }, stable), 'Ivan');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 3000 }, stable), 'Unknown', 'at least two contained windows: short turns remain Unknown');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 10_000 }, stable), 'Unknown', 'old name cannot cover a long silent gap');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 7000 }, [observation('Ivan', 0, 3000), observation('Ivan', 4000, 7000)]), 'Unknown');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 4500 }, [...stable, observation('Unknown', 500, 3500)]), 'Unknown');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 4500 }, [...stable, observation('Emilio', 4000, 7000)]), 'Unknown', 'conflict crossing the boundary vetoes attribution');
  assert.equal(speakerForInterval({ startMs: 0, endMs: 3000 }, [stable[0]!, stable[0]!]), 'Unknown', 'duplicate output cannot manufacture agreement');
});

test('stale queued inference, low score or margin, unknown names and missing ready never supply known evidence', () => {
  for (const extra of [{ score: 0.29 }, { margin: 0.079 }, { speaker: 'Stranger' }, { speaker: 'Unknown' }]) {
    const instance = setup();
    instance.start();
    instance.send('Ivan', 10_000, 13_000, extra);
    instance.send('Ivan', 11_500, 14_500);
    assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown');
    instance.identity.dispose();
  }
  const instance = setup();
  instance.identity.start(sessionId, device);
  instance.send('Ivan', 10_000, 13_000);
  instance.send('Ivan', 11_500, 14_500);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown');
  instance.child.send({ type: 'ready', deviceName: device });
  instance.setNow(25_000);
  instance.child.send({ type: 'speaker_identity', ...observation('Ivan', 10_000, 13_000) });
  instance.child.send({ type: 'speaker_identity', ...observation('Ivan', 11_500, 14_500) });
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown');
  instance.identity.dispose();
});

test('browser and sidecar must both confirm the configured microphone', () => {
  const instance = setup();
  instance.identity.start(sessionId, 'MacBook Pro Microphone');
  assert.equal(instance.spawns(), 0);
  instance.identity.start(sessionId, device);
  instance.child.send({ type: 'ready', deviceName: 'MacBook Pro Microphone' });
  instance.send('Ivan', 10_000, 13_000);
  instance.send('Ivan', 11_500, 14_500);
  assert.match(instance.child.input, /"type":"stop"/);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown');
  instance.identity.dispose();
});

test('reset clears speaker history and ignores output from the old child', () => {
  const instance = setup();
  instance.start();
  instance.send('Ivan', 10_000, 13_000);
  instance.send('Ivan', 11_500, 14_500);
  instance.identity.reset();
  instance.send('Ivan', 13_000, 16_000);
  assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 16_000 }), 'Unknown');
  instance.identity.dispose();
  assert.deepEqual(instance.child.kills, ['SIGKILL']);
});

test('unexpected recognizer failure discards even previously good evidence', () => {
  for (const fail of [
    (child: FakeChild) => child.emit('close', 1),
    (child: FakeChild) => child.emit('error', new Error('crashed')),
    (child: FakeChild) => child.stdin.emit('error', new Error('broken control pipe')),
    (child: FakeChild) => child.stdout.emit('error', new Error('closed')),
    (child: FakeChild) => child.stdout.write(`${'x'.repeat(5000)}\n`),
    (child: FakeChild) => child.stdout.write('x'.repeat(40_000)),
  ]) {
    const instance = setup();
    instance.start();
    instance.send('Ivan', 10_000, 13_000);
    instance.send('Ivan', 11_500, 14_500);
    instance.setNow(15_000);
    fail(instance.child);
    assert.equal(instance.identity.identify({ sessionId, startMs: 10_000, endMs: 15_000 }), 'Unknown');
    instance.identity.dispose();
  }
});

test('late output, close and errors from a replaced child cannot stop or label the new session', () => {
  const children: FakeChild[] = [];
  let now = 10_000;
  const identity = new SpeakerIdentity({ enabled: true, env: {}, now: () => now, log: () => {}, spawnProcess: () => {
    const child = new FakeChild(); children.push(child); return child as unknown as ChildProcessWithoutNullStreams;
  } });
  identity.start('old-session', device);
  const old = children[0]!;
  now = 20_000;
  identity.start('new-session', device);
  const current = children[1]!;
  old.send({ type: 'ready', deviceName: device });
  old.send({ type: 'speaker_identity', ...observation('Emilio', 20_000, 23_000) });
  old.stdout.emit('error', new Error('old pipe closed'));
  old.emit('error', new Error('old process crashed'));
  old.emit('close', 1);
  identity.stop('old-session');
  current.send({ type: 'ready', deviceName: device });
  now = 24_500;
  current.send({ type: 'speaker_identity', ...observation('Ivan', 20_000, 23_000) });
  current.send({ type: 'speaker_identity', ...observation('Ivan', 21_500, 24_500) });
  assert.equal(current.input, '');
  assert.equal(identity.identify({ sessionId: 'new-session', startMs: 20_000, endMs: 24_500 }), 'Ivan');
  assert.equal(identity.identify({ sessionId: 'old-session', startMs: 20_000, endMs: 24_500 }), 'Unknown');
  identity.dispose();
});

test('capture lease expires if the browser disappears; dispose force-stops children', async () => {
  const child = new FakeChild();
  let now = 10_000;
  const identity = new SpeakerIdentity({ enabled: true, env: {}, leaseMs: 30, now: () => now, log: () => {}, spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams });
  identity.start(sessionId, device);
  child.send({ type: 'ready', deviceName: device });
  now = 14_500;
  child.send({ type: 'speaker_identity', ...observation('Ivan', 10_000, 13_000) });
  child.send({ type: 'speaker_identity', ...observation('Ivan', 11_500, 14_500) });
  identity.heartbeat('wrong-session');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.match(child.input, /"type":"stop"/);
  assert.equal(identity.identify({ sessionId, startMs: 10_000, endMs: 14_500 }), 'Unknown', 'lease expiry invalidates evidence');
  identity.dispose();
  assert.deepEqual(child.kills, ['SIGKILL']);
});

test('a sidecar that ignores graceful stop is force-killed within one second', async () => {
  const instance = setup();
  instance.start();
  instance.identity.stop(sessionId);
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.deepEqual(instance.child.kills, ['SIGKILL']);
  instance.identity.dispose();
});

test('oversized or malformed sidecar output never crashes the application', () => {
  const instance = setup();
  instance.start();
  assert.doesNotThrow(() => instance.child.stdout.write('this is not JSON\nnull\n'));
  assert.doesNotThrow(() => instance.child.stdout.write('x'.repeat(40_000)));
  assert.match(instance.child.input, /"type":"stop"/);
  assert.equal(instance.identity.identify(), 'Unknown');
  instance.identity.dispose();
});
