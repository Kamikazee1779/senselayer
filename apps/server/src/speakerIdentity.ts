import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export type SpeakerAudioInterval = { sessionId: string; startMs: number; endMs: number };
export type SpeakerObservation = { speaker: string; score: number; margin: number; startMs: number; endMs: number };
type SpawnOptions = { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe'; shell: false };
export type SpeakerIdentityOptions = {
  env?: NodeJS.ProcessEnv;
  enabled?: boolean;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  now?: () => number;
  log?: (message: string) => void;
  leaseMs?: number;
};

const directory = fileURLToPath(new URL('../../../tools/speaker-recognition/', import.meta.url));
const UNKNOWN = 'Unknown';
const HISTORY_MS = 60_000;
const MAX_OBSERVATIONS = 120;
const MAX_LINE = 4096;
const normalizeDevice = (name: string) => name.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
function numberSetting(value: string | undefined, fallback: number, min: number, max: number) {
  const number = Number(value);
  return value?.trim() && Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

/** No latest-name fallback: short turns and uncertain boundaries intentionally stay Unknown. */
export function speakerForInterval(audio: Pick<SpeakerAudioInterval, 'startMs' | 'endMs'>, observations: SpeakerObservation[]): string {
  if (!Number.isFinite(audio.startMs) || !Number.isFinite(audio.endMs) || audio.endMs <= audio.startMs) return UNKNOWN;
  const overlapping = observations.filter(item => item.startMs < audio.endMs && item.endMs > audio.startMs);
  const contained = overlapping.filter(item => item.startMs >= audio.startMs && item.endMs <= audio.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  const name = contained[0]?.speaker;
  if (!name || name === UNKNOWN || contained.length < 2 || overlapping.some(item => item.speaker !== name)) return UNKNOWN;
  // Require distinct, overlapping windows. Repeated events cannot manufacture agreement.
  if (new Set(contained.map(item => `${item.startMs}:${item.endMs}`)).size < 2) return UNKNOWN;
  let coveredUntil = contained[0]!.endMs;
  for (const item of contained.slice(1)) {
    if (item.startMs > coveredUntil) return UNKNOWN;
    coveredUntil = Math.max(coveredUntil, item.endMs);
  }
  const covered = coveredUntil - contained[0]!.startMs;
  return covered / (audio.endMs - audio.startMs) >= 0.8 ? name : UNKNOWN;
}

type Capture = {
  sessionId: string;
  child: ChildProcessWithoutNullStreams;
  ready: boolean;
  buffer: string;
  lease: ReturnType<typeof setTimeout> | undefined;
};

/** Optional local recognizer. Capture belongs to a browser mic session, never server startup. */
export class SpeakerIdentity {
  readonly enabled: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly logger: (message: string) => void;
  private readonly spawnProcess: NonNullable<SpeakerIdentityOptions['spawnProcess']>;
  private readonly leaseMs: number;
  private readonly staleMs: number;
  private readonly windowMs: number;
  private readonly minScore: number;
  private readonly minMargin: number;
  private readonly deviceName: string;
  private readonly names: Set<string>;
  private capture: Capture | undefined;
  private sessionId: string | undefined;
  private startedAt = 0;
  private observations: SpeakerObservation[] = [];
  private children = new Set<ChildProcessWithoutNullStreams>();
  private lastLogAt = -Infinity;

  constructor(options: SpeakerIdentityOptions = {}) {
    this.env = options.env ?? process.env;
    this.enabled = options.enabled ?? this.env.SENSELAYER_SPEAKER_ID_ENABLED === '1';
    this.now = options.now ?? Date.now;
    this.logger = options.log ?? (message => console.warn(`[speaker] ${message}`));
    this.spawnProcess = options.spawnProcess ?? ((command, args, settings) => spawn(command, args, settings));
    this.leaseMs = options.leaseMs ?? 5000;
    this.staleMs = numberSetting(this.env.SENSELAYER_SPEAKER_STALE_MS, 5000, 100, 60_000);
    this.windowMs = 1000 * numberSetting(this.env.SENSELAYER_SPEAKER_WINDOW_SEC, 3, 0.25, 30);
    this.minScore = numberSetting(this.env.SENSELAYER_SPEAKER_MIN_SCORE, 0.30, 0, 1);
    this.minMargin = numberSetting(this.env.SENSELAYER_SPEAKER_MIN_MARGIN, 0.08, 0, 2);
    this.deviceName = normalizeDevice(this.env.SENSELAYER_SPEAKER_DEVICE_NAME ?? 'Trust GXT 232');
    this.names = new Set((this.env.SENSELAYER_SPEAKER_NAMES ?? 'emilio,ivan,alexandra,enrico').split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
  }

  start(sessionId: string, browserDeviceLabel: string): void {
    if (!this.enabled) return;
    if (this.capture?.sessionId === sessionId) {
      this.heartbeat(sessionId);
      return;
    }
    this.reset();
    this.sessionId = sessionId;
    this.startedAt = this.now();
    if (!this.deviceName || !normalizeDevice(browserDeviceLabel).includes(this.deviceName)) {
      this.log('Browser microphone does not match the configured local microphone; using Unknown.');
      return;
    }
    try {
      const python = this.env.SENSELAYER_SPEAKER_PYTHON ?? join(directory, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const child = this.spawnProcess(python, ['-u', join(directory, 'speaker_service.py')], {
        cwd: directory, env: { ...process.env, ...this.env }, stdio: 'pipe', shell: false,
      });
      const capture: Capture = { sessionId, child, ready: false, buffer: '', lease: undefined };
      this.capture = capture;
      this.children.add(child);
      child.on('error', () => {
        this.fail(capture, 'Local recognizer unavailable; transcription continues with Unknown.');
      });
      child.stdin.on('error', () => this.fail(capture, 'Local recognizer control pipe failed; using Unknown.'));
      child.stdout.on('error', () => this.fail(capture, 'Local recognizer output failed; using Unknown.'));
      child.stderr.on('error', () => { /* Diagnostics are optional. */ });
      child.stdout.on('data', (chunk: Buffer) => this.read(capture, chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => this.log(chunk.toString('utf8').slice(0, 500).replace(/[\x00-\x1f]/g, ' ').trim()));
      child.once('close', () => {
        this.children.delete(child);
        if (this.capture === capture) {
          clearTimeout(capture.lease);
          this.capture = undefined;
          this.observations = [];
        }
      });
      this.heartbeat(sessionId);
    } catch {
      this.log('Unable to start local recognizer; transcription continues with Unknown.');
    }
  }

  heartbeat(sessionId: string): void {
    const capture = this.capture;
    if (!capture || capture.sessionId !== sessionId) return;
    clearTimeout(capture.lease);
    capture.lease = setTimeout(() => this.fail(capture, 'Browser capture lease expired; local microphone stopped.'), this.leaseMs);
    capture.lease.unref();
  }

  stop(sessionId: string): void {
    const capture = this.capture;
    if (!capture || capture.sessionId !== sessionId) return;
    this.capture = undefined;
    clearTimeout(capture.lease);
    try { capture.child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`); } catch { /* Already closed. */ }
    const killTimer = setTimeout(() => {
      try { capture.child.kill('SIGKILL'); } catch { /* Already exited. */ }
    }, 750);
    killTimer.unref();
    capture.child.once('close', () => clearTimeout(killTimer));
    // Keep timestamped evidence for STT finals that arrive after the mic is stopped.
  }

  reset(): void {
    if (this.capture) this.stop(this.capture.sessionId);
    this.sessionId = undefined;
    this.observations = [];
  }

  dispose(): void {
    this.reset();
    for (const child of this.children) {
      try { child.kill('SIGKILL'); } catch { /* Process already gone. */ }
    }
    this.children.clear();
  }

  identify(audio?: SpeakerAudioInterval): string {
    if (!this.enabled) return 'Microphone';
    if (!audio || audio.sessionId !== this.sessionId || audio.endMs > this.now() + 1000) {
      this.log('Transcript -> Unknown | missing or invalid capture interval/session', false);
      return UNKNOWN;
    }
    this.prune();
    const speaker = speakerForInterval(audio, this.observations);
    this.log(`Transcript ${(audio.startMs - this.startedAt) / 1000}-${(audio.endMs - this.startedAt) / 1000}s -> ${speaker}${speaker === UNKNOWN ? ' | insufficient or conflicting audio windows' : ''}`, false);
    return speaker;
  }

  private read(capture: Capture, chunk: string): void {
    if (this.capture !== capture) return;
    capture.buffer += chunk;
    // Bound partial lines as well as complete lines. Malformed output disables only recognition.
    if (capture.buffer.length > MAX_LINE * 8) {
      this.fail(capture, 'Oversized recognizer output; using Unknown.');
      return;
    }
    for (;;) {
      const end = capture.buffer.indexOf('\n');
      if (end < 0) {
        if (capture.buffer.length > MAX_LINE) this.fail(capture, 'Oversized recognizer output; using Unknown.');
        return;
      }
      const line = capture.buffer.slice(0, end);
      capture.buffer = capture.buffer.slice(end + 1);
      if (line.length > MAX_LINE) {
        this.fail(capture, 'Oversized recognizer output; using Unknown.');
        return;
      }
      try {
        const value = JSON.parse(line) as Record<string, unknown> | null;
        if (!value || typeof value !== 'object') continue;
        if (value.type === 'ready') {
          if (typeof value.deviceName !== 'string' || !normalizeDevice(value.deviceName).includes(this.deviceName)) {
            this.fail(capture, 'Local microphone does not match the browser microphone; using Unknown.');
            return;
          }
          capture.ready = true;
          this.log(`Ready | microphone=${JSON.stringify(value.deviceName)}`, false);
        } else if (value.type === 'speaker_identity' && capture.ready) {
          this.record(value);
        }
      } catch { this.log('Ignored malformed recognizer output.'); }
    }
  }

  private record(value: Record<string, unknown>): void {
    const { speaker, score, margin, startMs, endMs } = value;
    if (typeof speaker !== 'string' || speaker.length > 80 || typeof score !== 'number' || !Number.isFinite(score)
      || typeof margin !== 'number' || !Number.isFinite(margin) || typeof startMs !== 'number' || !Number.isFinite(startMs)
      || typeof endMs !== 'number' || !Number.isFinite(endMs) || startMs < this.startedAt || endMs <= startMs
      || Math.abs(endMs - startMs - this.windowMs) > 500 || endMs > this.now() + 1000 || this.now() - endMs > this.staleMs) return;
    const known = this.names.has(speaker.trim().toLowerCase()) && score >= this.minScore && score <= 1 && margin >= this.minMargin && margin <= 2;
    const observation = { speaker: known ? speaker : UNKNOWN, score, margin, startMs, endMs };
    const duplicate = this.observations.find(item => item.startMs === startMs && item.endMs === endMs);
    if (duplicate) {
      if (duplicate.speaker !== observation.speaker) duplicate.speaker = UNKNOWN;
      return;
    }
    this.observations.push(observation);
    this.prune();
    const reason = known ? 'match' : score < this.minScore ? 'low similarity'
      : margin < this.minMargin ? 'ambiguous match' : 'rejected by recognizer or invalid scores';
    this.log(`Audio ${(startMs - this.startedAt) / 1000}-${(endMs - this.startedAt) / 1000}s -> ${observation.speaker} | score=${score.toFixed(3)} margin=${margin.toFixed(3)} | ${reason}`, false);
  }

  private prune(): void {
    this.observations = this.observations.filter(item => this.now() - item.endMs <= HISTORY_MS).slice(-MAX_OBSERVATIONS);
  }

  private fail(capture: Capture, message: string): void {
    if (this.capture !== capture) return;
    this.observations = [];
    this.log(message);
    this.stop(capture.sessionId);
  }

  private log(message: string, throttle = true): void {
    if (!message || (throttle && this.now() - this.lastLogAt < 5000)) return;
    if (throttle) this.lastLogAt = this.now();
    try { this.logger(message); } catch { /* Logging cannot make an optional subsystem fatal. */ }
  }
}
