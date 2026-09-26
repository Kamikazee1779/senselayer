import { LiveTranscriptSchema, type AudioInterval, type LiveTranscript } from '@senselayer/shared';

export type MicrophoneState = 'disconnected' | 'connecting' | 'listening' | 'error';

// Order completed text by committed audio items, not completion arrival time.
// Partials never leave this adapter. IDs and receive times are application-owned.
export class FinalTranscripts {
  private order: string[] = [];
  private completed = new Map<string, string>();
  private known = new Set<string>();
  private delivered = new Set<string>();
  private sequence = 0;
  private pendingAudio: (AudioInterval | undefined)[] = [];
  private audioByItem = new Map<string, AudioInterval>();
  constructor(private readonly sessionId: string) {}
  recordCommit(audio?: AudioInterval) { this.pendingAudio.push(audio); }
  receive(event: Record<string, unknown>): LiveTranscript[] {
    if (typeof event.item_id !== 'string') return [];
    const id = event.item_id;
    if (this.delivered.has(id)) return [];
    if (event.type === 'input_audio_buffer.committed' && !this.known.has(id)) {
      this.known.add(id); this.order.push(id);
      const audio = this.pendingAudio.shift();
      if (audio) this.audioByItem.set(id, audio);
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') {
      this.completed.set(id, event.transcript.trim());
    }
    const ready: LiveTranscript[] = [];
    while (this.order.length && this.completed.has(this.order[0]!)) {
      const item = this.order.shift()!;
      this.delivered.add(item);
      const text = this.completed.get(item)!;
      this.completed.delete(item);
      const audio = this.audioByItem.get(item);
      this.audioByItem.delete(item);
      if (text) ready.push(LiveTranscriptSchema.parse({
        id: `live-${this.sessionId}-${++this.sequence}`, seq: this.sequence,
        text, final: true, source: 'live', receivedAt: new Date().toISOString(),
        ...(audio ? { audio } : {}),
      }));
    }
    return ready;
  }
}

export class LiveMicrophone {
  private peer: RTCPeerConnection | undefined;
  private channel: RTCDataChannel | undefined;
  private stream: MediaStream | undefined;
  private audio: AudioContext | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();
  private closed = false;
  private stopping = false;
  private speech = false;
  private lastVoice = 0;
  private chunkStartedMs = 0;
  private captureStoppedMs: number | undefined;
  private pending = 0;
  private completed = new Set<string>();
  private queue = Promise.resolve();
  private sessionId = crypto.randomUUID();
  private finals = new FinalTranscripts(this.sessionId);
  private speakerEnabled = false;
  private speakerCapture = false;
  private speakerTimer: ReturnType<typeof setInterval> | undefined;
  private onPageHide = () => this.dispose();

  constructor(
    private readonly status: (state: MicrophoneState, error?: string) => void,
    private readonly onFinal: (event: LiveTranscript) => Promise<void>,
  ) {}

  async start() {
    this.status('connecting');
    window.addEventListener('pagehide', this.onPageHide);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        throw new Error('Microphone transcription requires Chrome on localhost or HTTPS.');
      }
      // No deviceId constraint: respect Chrome's selected/default input.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.chunkStartedMs = Date.now();
      this.audio = new AudioContext();
      await this.audio.resume();
      if (this.closed) return;
      const analyser = this.audio.createAnalyser();
      analyser.fftSize = 2048;
      this.audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const peer = this.peer = new RTCPeerConnection();
      stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
        track.onended = () => { if (!this.stopping) this.fail('Microphone access ended.'); };
      });
      peer.onconnectionstatechange = () => {
        if (!this.closed && ['failed', 'disconnected'].includes(peer.connectionState)) this.fail('Live transcription disconnected.');
      };
      const channel = this.channel = peer.createDataChannel('oai-events');
      channel.onmessage = message => {
        try {
          const event = JSON.parse(String(message.data)) as Record<string, unknown>;
          if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
            this.fail('OpenAI could not transcribe the microphone audio.'); return;
          }
          if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.item_id === 'string' && !this.completed.has(event.item_id)) {
            this.completed.add(event.item_id); this.pending = Math.max(0, this.pending - 1);
          }
          for (const transcript of this.finals.receive(event)) {
            this.queue = this.queue.then(async () => { if (!this.closed) await this.onFinal(transcript); })
              .catch(() => this.fail('Final transcript could not be submitted. Check the backend.'));
          }
        } catch { this.fail('Invalid transcription response.'); }
      };
      channel.onerror = () => this.fail('Live transcription connection failed.');
      channel.onclose = () => { if (!this.closed) this.fail('Live transcription connection closed.'); };
      channel.onopen = () => {
        if (this.closed) return;
        clearTimeout(this.timeout);
        this.status('listening');
        // gpt-live-transcribe requires client commits; server VAD is unsupported.
        this.timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const now = performance.now();
          if (rms > 0.015) { this.speech = true; this.lastVoice = now; }
          if (this.speech && now - this.lastVoice > 800) this.commit();
        }, 50);
      };
      this.timeout = setTimeout(() => this.fail('Live transcription connection timed out.'), 20000);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch('/api/transcription/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offer.sdp }), signal: this.abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Could not start live transcription.');
      }
      const answer = await response.json() as { sdp: string; speakerIdentity?: boolean };
      // Independent capture is only valid on the same computer as the browser.
      // Remote/mobile clients keep their ordinary transcript without server-mic names.
      if (!this.closed && !this.stopping && answer.speakerIdentity && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
        this.speakerEnabled = true;
        void this.startSpeaker(stream.getAudioTracks()[0]?.label ?? '');
      }
      if (!this.closed) await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      if (this.closed) return;
      const name = error instanceof Error ? error.name : '';
      this.fail(name === 'NotAllowedError' ? 'Microphone permission denied. Allow microphone access in Chrome and try again.'
        : name === 'NotFoundError' ? 'No microphone is available.'
        : name === 'NotReadableError' ? 'The microphone could not be opened. Check the device or other apps.'
        : error instanceof Error ? error.message : 'Could not start microphone.');
    }
  }

  private commit() {
    if (this.channel?.readyState !== 'open' || !this.speech) return;
    const endMs = Math.max(this.chunkStartedMs + 1, this.captureStoppedMs ?? Date.now());
    // Include the whole committed chunk, including quiet speech. RMS triggers a
    // commit but cannot safely define which words belong to a speaker.
    this.finals.recordCommit(this.speakerEnabled ? {
      sessionId: this.sessionId, startMs: this.chunkStartedMs, endMs,
    } : undefined);
    this.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.chunkStartedMs = endMs;
    this.pending++; this.speech = false;
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.captureStoppedMs = Date.now();
    this.stopSpeaker();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.channel?.readyState === 'open') {
      // Let the final audio packets arrive before committing the trailing turn.
      await new Promise(resolve => setTimeout(resolve, 200));
      this.commit();
      const deadline = performance.now() + 10000;
      while (this.pending && !this.closed && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.pending && !this.closed) { this.fail('Timed out waiting for the last utterance. It may not have been saved.'); return; }
      await this.queue;
    }
    if (!this.closed) { this.dispose(); this.status('disconnected'); }
  }

  private fail(message: string) {
    if (this.closed) return;
    this.dispose(); this.status('error', `${message} Demo remains available.`);
  }

  private async speakerControl(action: 'start' | 'heartbeat' | 'stop', deviceLabel?: string) {
    try {
      await fetch('/api/speaker/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ action, sessionId: this.sessionId, ...(deviceLabel !== undefined ? { deviceLabel } : {}) }),
        signal: AbortSignal.timeout(1500),
      });
    } catch { /* Optional speaker recognition must never interrupt the words. */ }
  }

  private async startSpeaker(deviceLabel: string) {
    this.speakerCapture = true;
    await this.speakerControl('start', deviceLabel);
    // Stop again if a stop request overtook the start while it was in flight.
    if (this.closed || this.stopping) { await this.speakerControl('stop'); return; }
    this.speakerTimer = setInterval(() => { void this.speakerControl('heartbeat'); }, 1000);
  }

  private stopSpeaker() {
    clearInterval(this.speakerTimer);
    if (this.speakerCapture) { this.speakerCapture = false; void this.speakerControl('stop'); }
  }

  dispose() {
    this.closed = true;
    this.abort.abort();
    this.stopSpeaker();
    window.removeEventListener('pagehide', this.onPageHide);
    clearInterval(this.timer); clearTimeout(this.timeout);
    this.stream?.getTracks().forEach(track => track.stop());
    this.channel?.close(); this.peer?.close();
    void this.audio?.close().catch(() => {});
  }
}
