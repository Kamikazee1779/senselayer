import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../../server/src/server.ts';

// The UI runs on Vite; API tests use mocks or an isolated deterministic server.
// Never reset the user's session or call their configured external provider.
const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:5173';
let browser, backend, backendUrl;
before(async () => {
  backend = createApp();
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  backendUrl = `http://127.0.0.1:${backend.address().port}`;
  browser = await chromium.launch({ channel: process.env.UI_BROWSER ?? 'chrome', headless: true, args: ['--use-fake-device-for-media-stream'] });
  await mkdir(new URL('../dist/qa/', import.meta.url), { recursive: true });
});
after(async () => { await browser?.close(); if (backend?.listening) { backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); } });
const stamp = '2026-09-26T12:00:00.000Z';
const event = (id, text) => ({ id, timestamp: stamp, speaker: 'Ari', text });
const processing = (status = 'ready', count = 1) => ({ status, received_seq: count, analyzed_seq: status === 'ready' ? count : count - 1, analyzed_at: count > 0 && status === 'ready' ? stamp : null, error: status === 'error' ? 'Provider failed' : null });
function initialSession() {
  return { state: { topic: null, decisions: [], questions: [], user_requests: [] }, events: [], processing: processing('ready', 0), change_seq: 0,
    acknowledged_seq: 0, acknowledged_at: null, revision: 0, user: { name: 'Emilio', language: 'en' } };
}
async function ready(page) {
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('.missed') && !document.querySelector('.missed').disabled);
}
const screenshot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(`../dist/qa/${name}.png`, import.meta.url)), fullPage: true });
const snapshot = (session, changes = []) => ({ id: 'snapshot', created_at: stamp, acknowledged_at: null, from_time: null, from_seq: 0, upper_bound: session.change_seq,
  state: structuredClone(session.state), processing: structuredClone(session.processing), changes });

test('backend restart accepts lower revisions and displays new tasks without a page reload', async () => {
  const page = await browser.newPage();
  const previous = { ...initialSession(), instance_id: 'before-restart', revision: 100,
    events: [event('old', 'An earlier conversation.')] };
  let session = previous;
  await page.route('**/api/session', route => route.fulfill({ json: session }));
  try {
    await ready(page);
    await page.getByText('An earlier conversation.', { exact: true }).waitFor();
    const source = { ...event('dishwasher', 'Emilio. Can you please load the dishwasher'), source: 'live', final: true, seq: 1, receivedAt: stamp };
    session = { ...initialSession(), instance_id: 'after-restart', revision: 2, events: [source],
      state: { ...initialSession().state, user_requests: [{ id: 'task', kind: 'task', text: 'Load the dishwasher.', event_ids: [source.id], created_at: stamp, acknowledged_at: null }] } };
    await page.getByRole('button', { name: 'Completed', exact: true }).waitFor();
    assert.equal(await page.getByText('An earlier conversation.', { exact: true }).count(), 0);
    assert.match(await page.locator('.notification-text').innerText(), /dishwasher/);
    // An old server response arriving late cannot bring the old session back.
    session = previous;
    await page.waitForResponse(response => response.url().endsWith('/api/session'));
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    assert.match(await page.getByRole('region', { name: 'Conversation summary' }).innerText(), /dishwasher/);
    assert.equal(await page.getByText('An earlier conversation.', { exact: true }).count(), 0);
  } finally { await page.close(); }
});

async function mockMicrophone(page, speakerIdentity = false) {
  await page.route('**/api/transcription/session', route => route.fulfill({ json: { sdp: 'v=0\r\nmock-answer', ...(speakerIdentity ? { speakerIdentity } : {}) } }));
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

test('optional speaker capture stops before delayed final words and carries their original audio interval', async () => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const controls = [], words = [];
  let session = initialSession();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/speaker/capture') {
      controls.push(route.request().postDataJSON());
      return route.fulfill({ json: { enabled: true } });
    }
    if (path === '/api/transcript') {
      const body = route.request().postDataJSON(); words.push(body);
      const saved = { ...body, timestamp: body.receivedAt, speaker: 'Unknown' };
      session = { ...session, revision: session.revision + 1, events: [...session.events, saved], processing: processing('ready', words.length) };
      return route.fulfill({ json: { new_events: [saved], state: session.state, attention: [], revision: session.revision, processing: session.processing } });
    }
    throw new Error(`Unexpected ${path}`);
  });
  await mockMicrophone(page, true);
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone on', { exact: true }).waitFor();
    await page.evaluate(() => { window.testAudioLevel = 0.1; });
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.testAudioLevel = 0; });
    await page.waitForFunction(() => window.sentProviderEvents.some(event => event.type === 'input_audio_buffer.commit'));
    const emit = data => page.evaluate(data => window.providerChannel.onmessage({ data: JSON.stringify(data) }), data);
    await emit({ type: 'input_audio_buffer.committed', item_id: 'delayed' });
    const stopped = page.waitForResponse(response => response.url().endsWith('/api/speaker/capture') && response.request().postDataJSON().action === 'stop');
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    // Wait for the capture-stop request while STT is still draining the final item.
    await stopped;
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
    assert.equal(words.length, 0);
    await emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'delayed', transcript: 'These words were spoken earlier.' });
    await page.getByText('Microphone off', { exact: true }).waitFor();
    const start = controls.find(command => command.action === 'start');
    assert.ok(start.deviceLabel);
    assert.equal(words[0].audio.sessionId, start.sessionId);
    assert.ok(words[0].audio.endMs > words[0].audio.startMs);
    assert.ok(words[0].audio.endMs < Date.parse(words[0].receivedAt));
    assert.ok(controls.some(command => command.action === 'stop' && command.sessionId === start.sessionId));
  } finally { await context.close(); }
});

test('live final words continue during the modal and stopping saves the trailing utterance', async () => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  let session = initialSession(), posts = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/transcript') {
      posts++;
      const body = route.request().postDataJSON(); assert.equal(body.final, true);
      const saved = { ...body, timestamp: body.receivedAt, speaker: 'Microphone' };
      session = { ...session, revision: session.revision + 1, change_seq: 1, events: [...session.events, saved], processing: processing('processing', posts),
        state: { ...session.state, user_requests: [{ id: 'attention', kind: 'attention', created_at: stamp, text: body.text, event_ids: [body.id], acknowledged_at: null, explicit_address: true }] } };
      return route.fulfill({ json: { new_events: [saved], state: session.state, attention: ['attention'], revision: session.revision, processing: session.processing } });
    }
    if (path === '/api/catchup') return route.fulfill({ json: snapshot(session) });
    throw new Error(`Unexpected ${path}`);
  });
  await mockMicrophone(page);
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone on', { exact: true }).waitFor();
    const emit = data => page.evaluate(data => window.providerChannel.onmessage({ data: JSON.stringify(data) }), data);
    await emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', delta: 'Emilio' });
    assert.equal(posts, 0);
    await emit({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
    const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: 'Emilio, can you check this?' };
    await emit(final);
    await page.locator('.notification-card.attention').waitFor();
    await page.locator('.missed').click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /summary is incomplete/);
    await emit(final); assert.equal(posts, 1);
    await emit({ type: 'input_audio_buffer.committed', item_id: 'item-2' });
    await emit({ ...final, item_id: 'item-2', transcript: 'The conversation continues.' });
    await page.waitForFunction(() => document.querySelectorAll('.utterances li').length === 2);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.testAudioLevel = 0.1; window.sentProviderEvents = []; });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await page.waitForFunction(() => window.sentProviderEvents.some(event => event.type === 'input_audio_buffer.commit'));
    await emit({ type: 'input_audio_buffer.committed', item_id: 'trailing' });
    await emit({ ...final, item_id: 'trailing', transcript: 'The trailing final utterance.' });
    await page.getByText('Microphone off', { exact: true }).waitFor();
    assert.equal(posts, 3);
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
  } finally { await context.close(); }
});

test('notifications stay in place across processing changes on desktop and mobile; seen tasks stay open', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, hasTouch: true });
  const source = event('event-1', 'Emilio, can you test the login now?');
  const session = initialSession();
  session.events = [source]; session.processing = processing(); session.revision = 1;
  session.state.user_requests = [{ id: 'task', kind: 'task', text: source.text, event_ids: [source.id], created_at: stamp, acknowledged_at: null, explicit_address: true }];
  session.state.decisions = [{ id: 'decision', text: 'Use the mobile version.', event_ids: [source.id], created_at: stamp }];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (/^\/api\/attention\/[^/]+\/(ack|complete)$/.test(path)) {
      const request = session.state.user_requests.find(item => item.id === path.split('/')[3]);
      request.acknowledged_at = stamp;
      if (path.endsWith('/complete')) request.resolved_at = stamp;
      session.revision++; return route.fulfill({ json: request });
    }
    throw new Error(`Unexpected ${path}`);
  });
  try {
    await ready(page);
    await page.locator('.notification-card.action').waitFor();
    await page.getByRole('button', { name: 'Seen', exact: true }).click();
    await page.locator('.notification-card.context').waitFor();
    assert.equal(session.state.user_requests[0].resolved_at, undefined);
    assert.equal(await page.locator('.notification-count').innerText(), '1 / 1');
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    await page.getByText('Seen · Task open', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Conversation summary' }).getByRole('button', { name: 'Completed', exact: true }).click();
    await page.getByRole('region', { name: 'Conversation summary' }).locator('.summary-text').filter({ hasText: source.text }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.summary-view h1') === document.activeElement);
    assert.ok(session.state.user_requests[0].resolved_at);
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      const before = await page.locator('.notification-card').boundingBox();
      session.processing = processing('processing'); session.revision++;
      await page.getByText('Words saved · updating summary…', { exact: true }).waitFor();
      const during = await page.locator('.notification-card').boundingBox();
      assert.equal(during.y, before.y, 'analysis must not push the notification down');
      session.processing = processing(); session.revision++;
      await page.waitForFunction(() => !document.querySelector('.processing-status').textContent);
      assert.equal((await page.locator('.notification-card').boundingBox()).y, before.y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const microphone = await page.locator('.microphone-button').boundingBox();
      assert.ok(microphone.y + microphone.height <= viewport.height);
      assert.ok((await page.locator('.transcript').boundingBox()).height > 80);
    }
    // A new, higher-priority card must not replace the one being read.
    session.state.user_requests.push({ id: 'another', kind: 'task', text: 'Emilio, can you review the slides now?', event_ids: [source.id], created_at: stamp, acknowledged_at: null, explicit_address: true });
    session.revision++;
    await page.getByText('2 / 2', { exact: true }).waitFor();
    assert.match(await page.locator('.notification-text').innerText(), /mobile version/);
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'mobile');
    await page.getByRole('button', { name: 'Previous notification' }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.match(await page.locator('.notification-text').innerText(), /review the slides/);
    await page.setViewportSize({ width: 1366, height: 900 });
    await screenshot(page, 'desktop');
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    await page.locator('.notification-card.context').waitFor();
    await page.getByRole('button', { name: 'Seen', exact: true }).click();
    await page.locator('.notifications').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.missed') === document.activeElement);
    assert.equal(session.state.decisions.length, 1, 'dismissal does not delete the decision');
  } finally { await page.close(); }
});

test('catch-up is a stable modal with source evidence, bounded acknowledgement and restored keyboard focus', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const first = event('first', 'Use mobile because it is easier to read at a distance.');
  const reason = event('reason', 'The text is easier to read from the back of the room.');
  const session = initialSession(); session.events = [reason, first]; session.revision = 1; session.change_seq = 2;
  session.state.decisions = [
    { id: 'old', created_at: stamp, text: 'Use desktop.', event_ids: [first.id], superseded_by: 'new' },
    { id: 'new', created_at: stamp, text: 'Use mobile.', event_ids: [first.id], rationale: { text: 'It is easier to read at a distance.', event_ids: [first.id, reason.id] } },
  ];
  const changes = [{ seq: 1, op: 'add_decision', entity_id: 'old', text: 'Use desktop.', evidence: [first] }, { seq: 2, op: 'add_decision', entity_id: 'new', text: 'Use mobile.', evidence: [first], supersedes_id: 'old' }];
  let captured, failAck = true;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/catchup') { captured = snapshot(session, changes); return route.fulfill({ json: captured }); }
    if (path === '/api/catchup/ack') {
      if (failAck) { failAck = false; return route.fulfill({ status: 503, json: { error: 'Try again' } }); }
      session.acknowledged_seq = captured.upper_bound; session.revision++;
      return route.fulfill({ json: { ...captured, acknowledged_at: stamp } });
    }
    throw new Error(`Unexpected ${path}`);
  });
  try {
    await ready(page); await page.locator('.missed').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'catchup-title');
    assert.match(await page.getByRole('dialog').innerText(), /Before: Use desktop/);
    assert.match(await page.getByRole('dialog').innerText(), /Why: It is easier/);
    assert.equal(await page.getByRole('dialog').locator('.evidence').count(), 1);
    await page.getByRole('dialog').getByText('Source', { exact: true }).click();
    assert.equal(await page.getByRole('dialog').locator('blockquote').count(), 2, 'shared source appears once and the separate reason source is retained');
    assert.equal(await page.getByRole('dialog').getByText(reason.text, { exact: true }).isVisible(), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    const late = event('late', 'Present at four.'); session.events.push(late); session.change_seq = 3; session.revision++;
    session.state.decisions.push({ id: 'late', created_at: stamp, text: late.text, event_ids: [late.id] });
    await page.getByText('1 new update available.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.getByRole('dialog').innerText(), /Present at four/);
    await screenshot(page, 'catchup-mobile');
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.missed') === document.activeElement);
    assert.equal(await page.locator('.change-count').innerText(), '1');
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    assert.match(await page.getByRole('region', { name: 'Conversation summary' }).innerText(), /Present at four/);
  } finally { await page.close(); }
});

test('processing failure preserves transcript and offers retry without claiming the summary is complete', async () => {
  const page = await browser.newPage();
  const session = { ...initialSession(), events: [event('first', 'An important instruction.')], processing: processing('error'), revision: 1 };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: session });
    if (path === '/api/analysis/retry') { session.processing = processing('processing'); session.revision++; return route.fulfill({ json: session }); }
    if (path === '/api/catchup') return route.fulfill({ json: snapshot(session) });
    throw new Error(`Unexpected ${path}`);
  });
  try {
    await ready(page); await page.locator('.missed').click();
    assert.match(await page.getByRole('dialog').innerText(), /summary is incomplete/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Retry context', exact: true }).click();
    await page.getByText('Words saved · updating summary…', { exact: true }).waitFor();
    assert.equal(await page.locator('.utterances li').count(), 1);
  } finally { await page.close(); }
});

test('microphone denial remains visible and Demo stays available', async () => {
  const context = await browser.newContext(); const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: base });
  await page.route('**/api/session', route => route.fulfill({ json: initialSession() }));
  try {
    await ready(page); await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone unavailable', { exact: true }).waitFor();
    assert.match(await page.getByRole('alert').innerText(), /permission denied/);
    assert.equal(await page.getByRole('button', { name: 'Demo', exact: true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('one demo runs through the real isolated backend, continues during catch-up, and Live starts fresh', async () => {
  const page = await browser.newPage();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const response = await route.fetch({ url: backendUrl + path });
    await route.fulfill({ response });
  });
  try {
    await page.clock.install(); await ready(page);
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await page.clock.runFor(100);
    await page.locator('.utterances li').first().waitFor();
    const count = await page.locator('.utterances li').count();
    await page.locator('.missed').click();
    await page.getByRole('dialog').waitFor();
    await page.clock.fastForward(5200);
    await page.waitForFunction(count => document.querySelectorAll('.utterances li').length > count, count);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.locator('.empty-conversation').waitFor();
    await page.clock.fastForward(15000);
    assert.equal(await page.locator('.utterances li').count(), 0, 'old demo must not refill the Live session');
    assert.equal(await page.getByRole('button', { name: 'Live', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await page.clock.runFor(100);
    await page.locator('.utterances li').first().waitFor();
    await page.reload(); await page.locator('.utterances li').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Demo', exact: true }).getAttribute('aria-pressed'), 'true');
  } finally { await page.close(); }
});
