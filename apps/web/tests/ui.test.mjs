import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Run against pnpm dev. Provider interactions are mocked in browser tests;
// the last test exercises the real deterministic backend and its async queue.
const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:5173';
let browser;
before(async () => {
  browser = await chromium.launch({ channel: process.env.UI_BROWSER ?? 'chrome', headless: true, args: ['--use-fake-device-for-media-stream'] });
  await mkdir(new URL('../dist/qa/', import.meta.url), { recursive: true });
});
after(async () => { await browser?.close(); });
const stamp = '2026-09-26T12:00:00.000Z';
const event = (id, text) => ({ id, timestamp: stamp, speaker: 'Ari', text });
const processing = (status = 'ready', count = 1) => ({ status, received_seq: count, analyzed_seq: status === 'ready' ? count : count - 1, analyzed_at: count > 0 && (count > 1 || status === 'ready') ? stamp : null, error: status === 'error' ? 'Provider failed' : null });
function initialSession() {
  return { state: { topic: null, decisions: [], questions: [], user_requests: [] }, events: [], processing: processing('ready', 0), change_seq: 0,
    acknowledged_seq: 0, acknowledged_at: null, revision: 0, user: { name: 'Emilio', language: 'en' } };
}
async function ready(page) {
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.missed')?.disabled);
}

async function mockMicrophone(page) {
  await page.route('**/api/transcription/session', route => route.fulfill({ json: { sdp: 'v=0\r\nmock-answer' } }));
  await page.addInitScript(() => {
    const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.micStream = await realGetUserMedia(constraints); return window.micStream;
    };
    window.testAudioLevel = 0;
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const analyser = createAnalyser.call(this); analyser.getFloatTimeDomainData = samples => samples.fill(window.testAudioLevel); return analyser;
    };
    window.sentProviderEvents = [];
    window.RTCPeerConnection = class {
      connectionState = 'new'; addTrack() {}
      createDataChannel() { return window.providerChannel = { readyState: 'connecting', send(text) { window.sentProviderEvents.push(JSON.parse(text)); }, close() { this.readyState = 'closed'; this.onclose?.(); } }; }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nmock-offer' }; }
      async setLocalDescription() {}
      async setRemoteDescription() { window.providerChannel.readyState = 'open'; window.providerChannel.onopen(); }
      close() { this.connectionState = 'closed'; }
    };
  });
}

test('finalized microphone words and direct attention appear while semantics are pending; catch-up stays usable', async () => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  let session = initialSession();
  let posts = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/transcription/session') return route.fulfill({ json: { sdp: 'v=0\r\nmock-answer' } });
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/transcript') {
      posts++;
      const body = route.request().postDataJSON();
      assert.equal(body.final, true);
      const saved = { ...body, timestamp: body.receivedAt, speaker: 'Microphone' };
      session = { ...session, revision: session.revision + 1, change_seq: 1, events: [...session.events, saved], processing: processing('processing', session.events.length + 1),
        state: { ...session.state, user_requests: [{ id: 'attention-1', kind: 'attention', created_at: stamp, text: body.text, event_ids: [body.id], acknowledged_at: null, explicit_address: true }] } };
      return route.fulfill({ json: { new_events: [saved], state: session.state, attention: ['attention-1'], revision: session.revision, processing: session.processing } });
    }
    if (path === '/api/catchup') return route.fulfill({ json: { id: 'catchup-1', created_at: stamp, state: session.state, acknowledged_at: null, from_time: null, from_seq: 0, upper_bound: 1,
      processing: session.processing, changes: [{ seq: 1, op: 'add_user_request', entity_id: 'attention-1', text: session.events[0].text, evidence: session.events }] } });
    throw new Error(`Unexpected ${path}`);
  });
  await mockMicrophone(page);
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: listening', { exact: true }).waitFor();
    const emit = data => page.evaluate(data => window.providerChannel.onmessage({ data: JSON.stringify(data) }), data);
    await emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', delta: 'Emilio' });
    assert.equal(posts, 0);
    await emit({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
    const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: 'Emilio, can you check this?' };
    await emit(final);
    await page.locator('.utterances li').waitFor();
    await page.locator('.priority-card').waitFor();
    await page.getByText('Words are saved. Updating their meaning…', { exact: true }).waitFor();
    assert.equal(await page.locator('.missed').isEnabled(), true);
    await page.locator('.missed').click();
    await page.locator('.catchup-panel').waitFor();
    assert.equal(await page.getByRole('region', { name: 'Conversation transcript' }).isVisible(), true);
    assert.match(await page.locator('.catchup-panel').innerText(), /Some words were still being interpreted/);
    await emit(final);
    assert.equal(posts, 1);
    // Stopping during speech must commit and save the final trailing utterance.
    await page.evaluate(() => { window.testAudioLevel = 0.1; window.sentProviderEvents = []; });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await page.waitForFunction(() => window.sentProviderEvents.some(event => event.type === 'input_audio_buffer.commit'));
    await emit({ type: 'input_audio_buffer.committed', item_id: 'trailing' });
    await emit({ ...final, item_id: 'trailing', transcript: 'The trailing final utterance.' });
    await page.locator('.utterances').getByText('The trailing final utterance.', { exact: true }).waitFor();
    assert.equal(posts, 2);
    await page.getByText('Microphone: disconnected', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: listening', { exact: true }).waitFor();
    await emit({ type: 'error', error: { message: 'provider failure' } });
    await page.getByText('Microphone: error', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
    await page.locator('.demo-controls > summary').click();
    assert.equal(await page.getByRole('button', { name: 'Start replay', exact: true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('stable recovery, sourced reason, late updates, explicit whole-interval acknowledgement and persistent seen tasks', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const first = event('event-1', 'Use mobile because it is easier to read at a distance.');
  let session = initialSession();
  session.events = [first]; session.processing = processing(); session.revision = 1; session.change_seq = 3;
  session.state.decisions = [
    { id: 'old', created_at: stamp, text: 'Use desktop.', event_ids: [first.id], superseded_by: 'new' },
    { id: 'new', created_at: stamp, text: 'Use mobile.', event_ids: [first.id], rationale: { text: 'It is easier to read at a distance.', event_ids: [first.id] } },
  ];
  session.state.user_requests = [{ id: 'task', kind: 'task', created_at: stamp, text: 'Test mobile before the demo.', event_ids: [first.id], acknowledged_at: null, explicit_address: true }];
  const changes = [
    { seq: 1, op: 'add_decision', entity_id: 'old', text: 'Use desktop.', evidence: [first] },
    { seq: 2, op: 'add_decision', entity_id: 'new', supersedes_id: 'old', text: 'Use mobile.', evidence: [first] },
    { seq: 3, op: 'add_user_request', entity_id: 'task', text: 'Test mobile before the demo.', evidence: [first] },
  ];
  let captured;
  let failAck = true;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/catchup') {
      captured = { id: 'snapshot', created_at: stamp, acknowledged_at: null, from_time: null, from_seq: 0, upper_bound: 3,
        state: structuredClone(session.state), processing: processing(), changes };
      return route.fulfill({ json: captured });
    }
    if (path === '/api/catchup/ack') {
      if (failAck) { failAck = false; return route.fulfill({ status: 503, json: { error: 'Try again' } }); }
      assert.equal(route.request().postDataJSON().catchup_id, 'snapshot');
      session.acknowledged_seq = 3; session.acknowledged_at = stamp; session.revision++;
      return route.fulfill({ json: { ...captured, acknowledged_at: stamp } });
    }
    if (path === '/api/attention/task/ack' || path === '/api/attention/task/complete') {
      session.state.user_requests[0].acknowledged_at = stamp;
      if (path.endsWith('/complete')) session.state.user_requests[0].resolved_at = stamp;
      session.revision++; return route.fulfill({ json: session.state.user_requests[0] });
    }
    throw new Error(`Unexpected ${path}`);
  });
  try {
    await ready(page);
    await page.locator('.missed').focus();
    await page.keyboard.press('Enter');
    await page.locator('.catchup-panel').waitFor();
    await page.waitForFunction(() => document.querySelector('#catchup-title') === document.activeElement);
    assert.match(await page.locator('.catchup-panel').innerText(), /Before: Use desktop\./);
    assert.match(await page.locator('.catchup-panel').innerText(), /Why: It is easier to read/);
    await page.getByText('Source for the reason', { exact: true }).click();
    assert.equal(await page.locator('.rationale-source blockquote').isVisible(), true);
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/decision-recovery.png', import.meta.url)), fullPage: true });
    const late = event('event-2', 'We will present at four.');
    session.events.push(late); session.change_seq = 4; session.revision++;
    session.state.decisions.push({ id: 'late', created_at: stamp, text: 'Present at four.', event_ids: [late.id] });
    await page.getByText('1 new change has arrived. Refresh when you want to include them.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('.catchup-panel').innerText(), /Present at four/);
    await page.getByText('All changes in this interval (3)', { exact: true }).click();
    assert.equal(await page.locator('.all-changes ol li').count(), 3);
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await page.getByRole('alert').first().waitFor();
    assert.equal(await page.locator('.catchup-panel').isVisible(), true);
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await page.locator('.catchup-panel').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.missed') === document.activeElement);
    assert.match(await page.locator('.change-hint').innerText(), /1 change since/);
    await page.getByRole('button', { name: 'Seen', exact: true }).click();
    await page.getByText('Seen · task still outstanding', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Completed', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.locator('.requests').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('Reading and attention settings', { exact: true }).click();
    await page.getByLabel('Text size', { exact: true }).selectOption('1.3');
    await page.locator('.missed').click();
    await page.locator('.catchup-panel').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByText('Microphone: disconnected', { exact: true }).isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('.catchup-panel').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.missed') === document.activeElement);
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/mobile.png', import.meta.url)), fullPage: true });
  } finally { await page.close(); }
});

test('processing failure is explicit; retry preserves words and does not claim that nothing happened', async () => {
  const page = await browser.newPage();
  let session = { ...initialSession(), events: [event('event-1', 'An important instruction.')], processing: processing('error'), revision: 1 };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/analysis/retry') { session = { ...session, revision: 2, processing: processing('processing') }; return route.fulfill({ json: session }); }
    if (path === '/api/catchup') return route.fulfill({ json: { id: 'pending', created_at: stamp, acknowledged_at: null, from_time: null, from_seq: 0, upper_bound: 0, state: session.state, processing: session.processing, changes: [] } });
    throw new Error(`Unexpected ${path}`);
  });
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Retry context', exact: true }).waitFor();
    await page.locator('.missed').click();
    await page.getByText('No interpreted changes available yet.', { exact: true }).waitFor();
    assert.match(await page.locator('.catchup-panel').innerText(), /does not mean nothing happened/);
    await page.getByRole('button', { name: 'Retry context', exact: true }).click();
    await page.getByText('Words are saved. Updating their meaning…', { exact: true }).waitFor();
    assert.equal(await page.locator('.utterances li').count(), 1);
  } finally { await page.close(); }
});

test('microphone denial is visible and leaves replay enabled', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: base });
  await page.route('**/api/session', route => route.fulfill({ json: initialSession() }));
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: error', { exact: true }).waitFor();
    assert.match(await page.locator('[role=alert]').innerText(), /permission denied/);
    await page.locator('.demo-controls > summary').click();
    assert.equal(await page.getByRole('button', { name: 'Start replay', exact: true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('real backend replay continues during recovery and a reload restores saved words', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await ready(page);
    await page.locator('.demo-controls > summary').click();
    await page.getByRole('button', { name: 'Start replay', exact: true }).click();
    await page.locator('.utterances li').first().waitFor();
    await page.locator('.missed').click();
    await page.locator('.catchup-panel').waitFor();
    const before = await page.locator('.utterances li').count();
    await page.waitForFunction(count => document.querySelectorAll('.utterances li').length > count, before);
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.catchup-panel').isVisible(), true);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/recovery.png', import.meta.url)), fullPage: true });
    const count = await page.locator('.utterances li').count();
    await page.reload();
    await page.locator('.utterances li').first().waitFor();
    assert.ok(await page.locator('.utterances li').count() >= count);
  } finally { await page.close(); }
});
