import { useEffect, useRef, useState } from 'react';
import type { CatchupResponse, SessionResponse, TranscriptResponse } from '@senselayer/shared';
import { api } from './api.js';
import { demoBatches } from './fixtures.js';
import { catchupItems, semanticItems } from './semantic.js';
import { LiveMicrophone, type MicrophoneState } from './live.js';
import { notifications, type Notification } from './notifications.js';
import { NotificationDeck } from './NotificationDeck.js';
import { Summary, time } from './Summary.js';

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const revision = useRef(-1);
  const instance = useRef<string | null>(null);
  const retiredInstances = useRef(new Set<string>());
  const initialized = useRef(false);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'demo' | 'live'>('live');
  const [view, setView] = useState<'transcript' | 'summary'>('transcript');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actions, setActions] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [catchup, setCatchup] = useState<CatchupResponse | null>(null);
  const missedButton = useRef<HTMLButtonElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [batch, setBatch] = useState(0);
  const demoGeneration = useRef(0);
  const demoPending = useRef<Promise<void>>(Promise.resolve());
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const microphone = useRef<LiveMicrophone | null>(null);
  const [micState, setMicState] = useState<MicrophoneState>('disconnected');
  const [micError, setMicError] = useState('');
  const [micDevice, setMicDevice] = useState('');
  const busy = (key: string) => actions.has(key);
  const events = session?.events ?? [];
  const processing = session?.processing;

  function applySession(next: SessionResponse) {
    const nextInstance = next.instance_id ?? 'legacy';
    if (retiredInstances.current.has(nextInstance)) return;
    if (instance.current && instance.current !== nextInstance) {
      // A restarted backend begins again at revision zero. Old responses must
      // not prevent recovery or merge the previous conversation into this one.
      retiredInstances.current.add(instance.current);
      revision.current = -1; initialized.current = false;
      setCatchup(null); setSeen(new Set());
      setDemoPlaying(false); demoGeneration.current++; setBatch(0);
      setMode('live'); setNotice('The server restarted. A new conversation session is active.');
    }
    instance.current = nextInstance;
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    if (!initialized.current) {
      initialized.current = true;
      if (next.events.length && next.events.every(event => event.source !== 'live')) setMode('demo');
    }
    setSession(next); setConnected(true);
  }
  function applyTranscript(result: TranscriptResponse) {
    // Only a full session response may switch backend instances. Polling will
    // recover any words accepted by a new backend while this request ran.
    if ((result.instance_id ?? 'legacy') !== instance.current) return;
    if (result.revision < revision.current) return;
    revision.current = result.revision;
    setSession(previous => previous ? { ...previous, state: result.state, processing: result.processing, revision: result.revision,
      events: [...new Map([...previous.events, ...result.new_events].map(event => [event.id, event])).values()] } : previous);
    setConnected(true);
  }
  async function refresh() { applySession(await api.session()); }
  async function act(key: string, work: () => Promise<void>) {
    if (locks.current.has(key)) return;
    locks.current.add(key); setActions(new Set(locks.current)); setError(''); setNotice('');
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'); }
    finally { locks.current.delete(key); setActions(new Set(locks.current)); }
  }

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await api.session(); if (!disposed) applySession(next); }
      catch { if (!disposed) setConnected(false); }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 1000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  useEffect(() => () => { microphone.current?.dispose(); demoGeneration.current++; }, []);
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [events.length, view]);
  useEffect(() => {
    if (!demoPlaying || !connected) return;
    const generation = demoGeneration.current;
    const timer = setTimeout(() => {
      const input = demoBatches[batch];
      if (!input) { setDemoPlaying(false); return; }
      demoPending.current = (async () => {
        try {
          // Match demo requests to the configured participant, not a hardcoded name.
          const result = await api.transcript({ events: input.events.map(event => ({
            ...event, speaker: event.speaker === 'Emilio' ? session!.user.name : event.speaker,
            text: event.text.replace(/\bEmilio\b/g, () => session!.user.name),
          })) });
          if (generation !== demoGeneration.current) return;
          applyTranscript(result); setBatch(batch + 1);
          if (batch + 1 === demoBatches.length) setDemoPlaying(false);
        } catch (cause) {
          if (generation !== demoGeneration.current) return;
          setDemoPlaying(false); setError(cause instanceof Error ? cause.message : 'Demo interrupted. Start Demo to try again.');
        }
      })();
    }, batch === 0 ? 0 : 1000);
    return () => clearTimeout(timer);
  }, [demoPlaying, batch, connected]);

  async function stopMicrophone() {
    await microphone.current?.stop(); microphone.current = null;
  }
  function startMicrophone() {
    setMicError(''); microphone.current?.dispose();
    setMicDevice('');
    const live = new LiveMicrophone((status, message) => { setMicState(status); setMicError(message ?? ''); }, async event => {
      const result = await api.liveTranscript(event);
      if (microphone.current === live) applyTranscript(result);
    }, setMicDevice);
    microphone.current = live;
    void live.start();
  }
  async function newSession(nextMode: 'demo' | 'live') {
    setDemoPlaying(false); demoGeneration.current++;
    // Drain already submitted words before reset, so an old demo cannot refill it.
    await demoPending.current;
    await stopMicrophone();
    await api.reset(); await refresh();
    setMode(nextMode); setView('transcript'); setBatch(0); setSeen(new Set());
    setCatchup(null); setMicError(''); setMicState('disconnected'); follow.current = true; setFollowing(true);
  }
  function chooseDemo() {
    void act('session', async () => { await newSession('demo'); setDemoPlaying(true); });
  }
  function chooseLive() {
    if (mode === 'live') return;
    void act('session', async () => { await newSession('live'); });
  }
  function toggleMicrophone() {
    if (locks.current.has('session')) return;
    void act('session', async () => {
      if (micState === 'listening' || micState === 'connecting') await stopMicrophone();
      else { if (mode === 'demo') await newSession('live'); startMicrophone(); }
    });
  }
  async function openCatchup() {
    await act('catchup', async () => { setCatchup(await api.catchup()); });
  }
  function closeCatchup() {
    setCatchup(null);
    requestAnimationFrame(() => missedButton.current?.focus());
  }
  function markSeen(card: Notification) {
    void act('notification', async () => {
      if (card.request) await api.attentionAck(card.id);
      setSeen(previous => new Set(previous).add(card.id));
      if (cards.length === 1) requestAnimationFrame(() => missedButton.current?.focus());
      if (card.request) await refresh();
      setNotice(card.request?.kind === 'task' ? 'Notification dismissed. The task is still open in Summary.' : 'Notification dismissed.');
    });
  }
  function complete(id: string) {
    void act('notification', async () => {
      await api.completeRequest(id); await refresh(); setNotice('Task completed.');
      requestAnimationFrame(() => {
        if (view === 'summary') summaryHeading.current?.focus();
        else if (cards.length === 1) missedButton.current?.focus();
      });
    });
  }
  const cards = session ? notifications(session.state, events, seen) : [];
  const changes = session ? Math.max(0, session.change_seq - session.acknowledged_seq) : 0;
  const micActive = micState === 'listening' || micState === 'connecting';
  const status = !connected ? session ? 'Connection interrupted · reconnecting' : 'Connecting…'
    : busy('session') ? 'Preparing session…'
    : mode === 'demo' ? demoPlaying ? 'Demo playing · sample conversation' : 'Demo · sample conversation'
    : micState === 'listening' ? 'Microphone on' : micState === 'connecting' ? 'Connecting microphone…' : micState === 'error' ? 'Microphone unavailable' : 'Microphone off';

  return <div className="app">
    <a className="skip-link" href="#conversation">Skip to conversation</a>
    <header className="app-header">
      <span className="brand"><span aria-hidden="true">≋</span> SenseLayer</span>
      <div className="mode-switch" aria-label="Conversation mode">
        <button aria-pressed={mode === 'demo'} disabled={!connected || busy('session') || demoPlaying} onClick={chooseDemo} title="Start a new sample conversation">Demo</button>
        <button aria-pressed={mode === 'live'} disabled={!connected || busy('session')} onClick={chooseLive}>Live</button>
      </div>
      <button className="icon-button reset" aria-label="Reset session" title="Clear conversation and stop microphone" disabled={!connected || busy('session')} onClick={() => {
        void act('session', async () => { await newSession('live'); setNotice('Session reset.'); });
      }}>↻</button>
    </header>
    <div className="session-status" role="status">
      <span className={`status-dot ${micState === 'listening' || demoPlaying ? 'active' : ''}`} aria-hidden="true" />
      <span>{status}</span>
      <span className="microphone-device" title={micDevice}>{mode === 'live' && micDevice ? `${micActive ? '' : 'Last used: '}${micDevice}` : ''}</span>
    </div>
    <p className="processing-status" role="status">{processing?.status === 'processing' ? 'Words saved · updating summary…' : ''}</p>
    <p className="sr-only" role="status">{notice}</p>
    <NotificationDeck cards={cards} events={events} disabled={!connected || busy('notification') || busy('session')} onSeen={markSeen} onComplete={card => complete(card.id)} />
    <div className="messages">
      {error && !catchup && <p className="message error" role="alert">{error}</p>}
      {micError && <p className="message error" role="alert">{micError}</p>}
      {processing?.status === 'error' && <div className="message error"><p role="status">Summary unavailable. Your words are saved.</p><button className="text-button" disabled={!connected || busy('retry')} onClick={() => { void act('retry', async () => { applySession(await api.retryAnalysis()); }); }}>Retry context</button></div>}
    </div>
    <main className="conversation" id="conversation" tabIndex={-1} aria-label="Conversation">
      {view === 'transcript' ? <div className="transcript" ref={transcript} tabIndex={0} role="region" aria-label="Conversation transcript" onScroll={() => {
        const element = transcript.current!;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60; setFollowing(follow.current);
      }}>
        {!events.length ? <div className="empty-conversation"><span className="empty-symbol" aria-hidden="true">≋</span><h1>A little less to keep up with.</h1><p>Turn on the microphone to follow your conversation.<span hidden><br />Or try Demo to see it in action.</span></p></div>
          : <ol className="utterances">{events.map(event => <li key={event.id}><div className="speaker-line"><strong>{event.speaker}</strong><time dateTime={event.timestamp}>{time(event.timestamp)}</time></div><p>{event.text}</p></li>)}</ol>}
      </div> : <div className="summary-view" tabIndex={0} role="region" aria-label="Conversation summary">
        <h1 ref={summaryHeading} tabIndex={-1}>The conversation, simply.</h1>
        {session && <Summary state={session.state} events={events} onComplete={complete} completing={!connected || busy('notification') || busy('session')} />}
      </div>}
      {!following && view === 'transcript' && <button className="jump-latest" onClick={() => {
        follow.current = true; setFollowing(true); transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
      }}>Latest words ↓</button>}
    </main>
    <footer className="bottom-bar">
      <div className="main-actions">
        <button className={`microphone-button ${micActive ? 'listening' : ''}`} aria-label={micActive ? 'Stop microphone' : 'Start microphone'} aria-pressed={micActive}
          disabled={busy('session') || (!connected && !micActive)} onClick={toggleMicrophone}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />{!micActive && <path d="m3 3 18 18" />}</svg>
          <span>{micActive ? 'On' : 'Off'}</span>
        </button>
        <button className="missed" ref={missedButton} disabled={!connected || busy('catchup') || busy('session')} onClick={() => { void openCatchup(); }}>
          <span aria-hidden="true">↶</span> {busy('catchup') ? 'Opening…' : 'I missed that'}{changes > 0 && <span className="change-count" aria-label={`${changes} changes since your last review`}>{changes}</span>}
        </button>
      </div>
      <div className="view-switch" aria-label="Conversation view">
        <button aria-pressed={view === 'transcript'} onClick={() => setView('transcript')}>Transcript</button>
        <button aria-pressed={view === 'summary'} onClick={() => setView('summary')}>Summary</button>
      </div>
    </footer>
    {catchup && <CatchupModal snapshot={catchup} session={session} error={error} refreshing={busy('catchup')} saving={busy('catchup-ack')} connected={connected}
      onClose={closeCatchup} onRefresh={() => { void openCatchup(); }} onAcknowledge={() => { void act('catchup-ack', async () => {
        const result = await api.catchupAck(catchup.id);
        if (!result.acknowledged_at) throw new Error('Could not mark this summary as read. Please try again.');
        await refresh(); closeCatchup(); setNotice('You’re caught up. Newer updates are still available.');
      }); }} />}
  </div>;
}

function CatchupModal({ snapshot, session, error, refreshing, saving, connected, onClose, onRefresh, onAcknowledge }: {
  snapshot: CatchupResponse; session: SessionResponse | null; error: string; refreshing: boolean; saving: boolean; connected: boolean;
  onClose: () => void; onRefresh: () => void; onAcknowledge: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = dialog.current!; element.showModal(); heading.current?.focus();
    return () => { element.close(); };
  }, []);
  const newer = Math.max(0, (session?.change_seq ?? 0) - snapshot.upper_bound);
  const current = catchupItems(snapshot);
  // Include older outstanding work, so a seen but incomplete task is not lost.
  const pending = semanticItems(snapshot.state).filter(item => item.group !== 'WHAT CHANGED' && !current.some(change => change.key === item.key));
  const events = [...new Map([...(session?.events ?? []), ...snapshot.changes.flatMap(change => change.evidence)].map(event => [event.id, event])).values()];
  return <dialog className="catchup-modal" ref={dialog} aria-labelledby="catchup-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-shell">
      <header className="modal-header"><div><p className="eyebrow">A moment to catch up</p><h2 id="catchup-title" ref={heading} tabIndex={-1}>Here’s what you missed.</h2></div><button className="icon-button" aria-label="Close catch-up" onClick={onClose}>×</button></header>
      <div className="modal-content">
        <p className="snapshot-note">{snapshot.from_time ? `Since your last review at ${time(snapshot.from_time)}.` : 'Since this session began.'} Saved at {time(snapshot.created_at)}.</p>
        {snapshot.processing.status !== 'ready' && <p className="message">{snapshot.processing.status === 'error' ? 'This summary is incomplete. Your words are saved in Transcript.' : 'Some words are still being interpreted. This summary is incomplete.'}</p>}
        <div className="snapshot-update"><p role="status">{newer > 0 ? `${newer} new ${newer === 1 ? 'update' : 'updates'} available.` : 'This summary stays still while you read.'}</p><button className="text-button" disabled={!connected || refreshing || saving} onClick={onRefresh}>{refreshing ? 'Updating…' : 'Update summary'}</button></div>
        <Summary state={snapshot.state} events={events} items={[...current, ...pending]} />
        {error && <p className="message error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer"><button className="caught-up" disabled={!connected || saving || refreshing} onClick={onAcknowledge}>{saving ? 'Saving…' : 'I’m caught up'}</button></footer>
    </div>
  </dialog>;
}
