import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Run against pnpm dev with the deterministic backend (CONTEXT_PROVIDER=mock).
const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:5173';
let browser;
before(async () => {
  browser = await chromium.launch({ channel: process.env.UI_BROWSER ?? 'chrome', headless: true, args: ['--use-fake-device-for-media-stream'] });
  await mkdir(new URL('../dist/qa/', import.meta.url), { recursive: true });
});
after(async () => { await browser?.close(); });
async function ready(page) {
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.missed')?.disabled);
}
async function until(page, fn) { await page.waitForFunction(fn); }

test('Chrome microphone permission, final-only live ingestion, stop cleanup and replay fallback (OpenAI mocked)', async () => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const posts = [];
  page.on('request', request => { if (request.url().endsWith('/api/transcript')) posts.push(request.postDataJSON()); });
  await page.route('**/api/transcription/session', route => route.fulfill({ json: { sdp: 'v=0\r\nmock-answer' } }));
  await page.addInitScript(() => {
    const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.micConstraints = constraints;
      window.micStream = await realGetUserMedia(constraints);
      return window.micStream;
    };
    // Deterministic volume for testing silence/stop commits, with real capture.
    window.testAudioLevel = 0;
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const analyser = createAnalyser.call(this);
      analyser.getFloatTimeDomainData = samples => samples.fill(window.testAudioLevel);
      return analyser;
    };
    // Keep Chrome getUserMedia and AudioContext real; mock only the provider peer.
    window.sentProviderEvents = [];
    window.RTCPeerConnection = class {
      connectionState = 'new';
      addTrack() {}
      createDataChannel() {
        return window.providerChannel = {
          readyState: 'connecting',
          send(text) { window.sentProviderEvents.push(JSON.parse(text)); },
          close() { this.readyState = 'closed'; this.onclose?.(); },
        };
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nmock-offer' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        window.providerChannel.readyState = 'open'; window.providerChannel.onopen();
      }
      close() { this.connectionState = 'closed'; }
    };
  });
  try {
    await page.request.post(`${base}/api/reset`, { data: {} });
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: listening', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.micConstraints), { audio: true });
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'live');
    const emit = event => page.evaluate(event => window.providerChannel.onmessage({ data: JSON.stringify(event) }), event);
    await emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', delta: 'Emilio, can you' });
    assert.equal(posts.length, 0);
    assert.equal(await page.locator('.utterances li').count(), 0);
    await emit({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
    const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: 'Emilio, can you review the demo?' };
    await emit(final);
    await page.locator('.utterances li').waitFor();
    await page.locator('.priority-card').waitFor();
    assert.equal(posts.length, 1);
    assert.deepEqual(Object.keys(posts[0]).sort(), ['id', 'seq', 'text', 'final', 'source', 'receivedAt'].sort());
    assert.equal(posts[0].source, 'live'); assert.equal(posts[0].final, true);
    assert.equal(posts[0].text, final.transcript);
    await emit(final);
    assert.equal(posts.length, 1);
    await page.evaluate(() => { window.testAudioLevel = 0.1; });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.testAudioLevel = 0; });
    await page.waitForFunction(() => window.sentProviderEvents.some(event => event.type === 'input_audio_buffer.commit'));
    await emit({ type: 'input_audio_buffer.committed', item_id: 'item-2' });
    await emit({ ...final, item_id: 'item-2', transcript: 'A second final utterance.' });
    await page.getByText('A second final utterance.', { exact: true }).waitFor();
    // Provider failure immediately releases the actual Chrome capture track.
    await emit({ type: 'error', error: { message: 'test failure' } });
    await page.getByText('Microphone: error', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
    await page.locator('.demo-controls > summary').click();
    await page.getByRole('button', { name: 'Start replay', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Next batch', exact: true }).click();
    await page.locator('.utterances li').waitFor();
    assert.ok(posts.at(-1).events, 'replay still uses its existing request shape');
    // Stop during speech commits and drains the trailing final before closing.
    await until(page, () => !document.querySelector('.missed').disabled);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: listening', { exact: true }).waitFor();
    await page.evaluate(() => { window.testAudioLevel = 0.1; window.sentProviderEvents = []; });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
    await page.waitForFunction(() => window.sentProviderEvents.some(event => event.type === 'input_audio_buffer.commit'));
    await emit({ type: 'input_audio_buffer.committed', item_id: 'trailing' });
    await emit({ ...final, item_id: 'trailing', transcript: 'The trailing final utterance.' });
    await page.getByText('The trailing final utterance.', { exact: true }).waitFor();
    await page.getByText('Microphone: disconnected', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.micStream.getAudioTracks()[0].readyState), 'ended');
  } finally { await context.close(); }
});

test('Chrome microphone denial is visible and leaves replay enabled', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: base });
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
    await page.getByText('Microphone: error', { exact: true }).waitFor();
    assert.match(await page.locator('[role=alert]').innerText(), /permission denied/);
    await page.locator('.demo-controls > summary').click();
    assert.equal(await page.getByRole('button', { name: 'Start replay', exact: true }).isEnabled(), true);
  } finally { await context.close(); }
});

test('real backend: replay, transcript, evidence, catch-up, separate acknowledgements, resolution and reset', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await ready(page);
    assert.equal(await page.locator('.debug').getAttribute('open'), null);
    await page.locator('.demo-controls > summary').click();
    await page.getByRole('button', { name: 'Start replay', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const step = async count => {
      for (let i = 0; i < count; i++) {
        const response = page.waitForResponse(r => r.url().endsWith('/api/transcript') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Next batch', exact: true }).click();
        assert.equal((await response).status(), 200);
        await until(page, () => !document.querySelector('.missed').disabled);
      }
    };
    await step(5);
    assert.equal(await page.locator('.utterances li').count(), 5);
    await page.getByRole('button', { name: 'I MISSED THAT', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.locator('dialog').innerText(), /DECIDED/);
    assert.match(await page.locator('dialog').innerText(), /Use production/);
    assert.doesNotMatch(await page.locator('dialog').innerText(), /Use staging\./);
    await page.locator('dialog .evidence summary').last().click();
    assert.match(await page.locator('dialog blockquote').last().innerText(), /Correction: Use staging\. => Use production\./);
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await until(page, () => !document.querySelector('dialog').open);
    assert.equal(await page.locator('.missed').evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'I MISSED THAT', exact: true }).click();
    await page.getByText('No new important updates.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await step(2);
    await page.locator('.priority-card').waitFor();
    // A contextual assignment can precede the direct request. Acknowledge it separately.
    if (!(await page.locator('.request-text').innerText()).includes('can you review')) {
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
      await page.getByText('Emilio, can you review the demo?', { exact: true }).first().waitFor();
    }
    await page.locator('.priority-card .evidence summary').click();
    assert.match(await page.locator('.priority-card blockquote').innerText(), /Emilio, can you review the demo\?/);
    await page.locator('.demo-controls > summary').click();
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/conversation.png', import.meta.url)), fullPage: true });
    await page.getByRole('button', { name: 'I MISSED THAT', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('dialog .catchup-group li > p').filter({ hasText: 'Emilio, can you review the demo?' }).count(), 1, 'linked request is not repeated as an open question');
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/catchup.png', import.meta.url)), fullPage: true });
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await until(page, () => !document.querySelector('dialog').open);
    assert.equal(await page.locator('.priority-card').count(), 1, 'catch-up does not acknowledge requests');
    await page.locator('.demo-controls > summary').click();
    await step(3);
    await until(page, () => !document.querySelector('.priority-card'));
    await page.getByRole('button', { name: 'I MISSED THAT', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.locator('dialog').innerText(), /RESOLVED/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reset session', exact: true }).click();
    await page.getByText('Room for the conversation.', { exact: true }).waitFor();
    assert.equal(await page.locator('.utterances li').count(), 0);
  } finally { await page.close(); }
});

test('mock contracts: acknowledgement failures, incoming updates, keyboard focus and responsive layout', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const stamp = '2026-09-25T12:00:00.000Z';
  const event = { id: 'event-1', timestamp: stamp, speaker: 'Ari', text: 'Emilio, can you check the slides?' };
  let state = { topic: null, decisions: [], questions: [], user_requests: [{ id: 'request-1', created_at: stamp, text: event.text, event_ids: [event.id], acknowledged_at: null, explicit_address: true }] };
  let ackFails = true;
  let catchupFails = true;
  let snapshot;
  let acknowledged = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/state') body = state;
    else if (path === '/api/catchup') {
      snapshot = { id: 'catchup-1', created_at: stamp, state: structuredClone(state), acknowledged_at: null, from_seq: 0, upper_bound: 1,
        changes: acknowledged ? [] : [{ seq: 1, op: 'add_user_request', entity_id: 'request-1', text: event.text, evidence: [event] }] };
      body = snapshot;
    } else if (path === '/api/catchup/ack') {
      assert.deepEqual(route.request().postDataJSON(), { catchup_id: 'catchup-1' });
      if (catchupFails) { catchupFails = false; await route.fulfill({ status: 503, json: { error: 'Try again' } }); return; }
      acknowledged = true; body = { ...snapshot, acknowledged_at: stamp };
    } else if (path === '/api/attention/request-1/ack') {
      if (ackFails) { ackFails = false; await route.fulfill({ status: 503, json: { error: 'Try again' } }); return; }
      state.user_requests[0].acknowledged_at = stamp; body = state.user_requests[0];
    } else throw new Error(`Unexpected request: ${path}`);
    await route.fulfill({ json: body });
  });
  try {
    await ready(page);
    await page.locator('.priority-card').waitFor();
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.priority-card').count(), 1, 'failed ack preserves card');
    await page.keyboard.press('Tab');
    await page.locator('.missed').focus();
    assert.equal(await page.locator('.missed').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.locator('dialog summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('dialog blockquote p').innerText(), event.text);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    }
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await page.locator('dialog [role=alert]').waitFor();
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
    state.decisions.push({ id: 'late-decision', created_at: stamp, text: 'Meet tomorrow.', event_ids: [event.id] });
    await page.waitForFunction(() => document.querySelector('.change-hint').textContent.includes('2 unseen'));
    await page.getByRole('button', { name: 'I’m caught up', exact: true }).click();
    await until(page, () => !document.querySelector('dialog').open);
    assert.match(await page.locator('.change-hint').innerText(), /1 unseen update/);
    assert.equal(await page.locator('.priority-card').count(), 1);
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
    await until(page, () => !document.querySelector('.priority-card'));
    assert.equal(await page.locator('.missed').evaluate(el => el === document.activeElement), true);
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/laptop.png', import.meta.url)), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: fileURLToPath(new URL('../dist/qa/mobile.png', import.meta.url)), fullPage: true });
    await page.getByRole('button', { name: 'I MISSED THAT', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.missed').evaluate(el => el === document.activeElement), true);
  } finally { await page.close(); }
});
