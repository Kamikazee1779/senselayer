import React, { useEffect, useRef, useState } from 'react';
import { requestStatus, type CatchupResponse, type ContextState, type TranscriptEvent } from '@senselayer/shared';
import { api } from './api.js';
import { replays } from './fixtures.js';
import { catchupItems, semanticItems } from './semantic.js';
import { LiveMicrophone, type MicrophoneState } from './live.js';

const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Evidence({ ids, events }: { ids: string[]; events: TranscriptEvent[] }) {
  return <details className="evidence"><summary>View source <span aria-hidden="true">↗</span></summary>
    <div className="source-content">{ids.map(id => {
      const event = events.find(item => item.id === id);
      return event ? <blockquote key={id}><p>{event.text}</p><footer>{event.speaker} · {time(event.timestamp)} <code>{id}</code></footer></blockquote>
        : <p key={id}>Source <code>{id}</code> is unavailable in this session. The server does not expose earlier transcript history.</p>;
    })}</div>
  </details>;
}

export function App() {
  const [state, setState] = useState<ContextState | null>(null);
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  const [updated, setUpdated] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [catchup, setCatchup] = useState<CatchupResponse | null>(null);
  const [lastCatchup, setLastCatchup] = useState<CatchupResponse | null>(null);
  const [evidenceEvents, setEvidenceEvents] = useState<TranscriptEvent[]>([]);
  const [selected, setSelected] = useState(0);
  const [activeReplay, setActiveReplay] = useState<number | null>(null);
  const [batch, setBatch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const missedButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const microphone = useRef<LiveMicrophone | null>(null);
  const [micState, setMicState] = useState<MicrophoneState>('disconnected');
  const [micError, setMicError] = useState('');
  const [micStopping, setMicStopping] = useState(false);
  useEffect(() => () => { microphone.current?.dispose(); microphone.current = null; }, []);

  async function stopMicrophone() {
    setMicStopping(true);
    await microphone.current?.stop();
    microphone.current = null;
    setMicStopping(false);
  }

  function startMicrophone() {
    setPlaying(false); setActiveReplay(null); setMicError('');
    const live = new LiveMicrophone((status, message) => {
      setMicState(status); setMicError(message ?? '');
    }, async event => {
      // Reuse the existing UI action lock without dropping speech while an ack
      // or catch-up is in flight. LiveMicrophone serializes finalized utterances.
      while (lock.current && microphone.current === live) await new Promise(resolve => setTimeout(resolve, 25));
      if (microphone.current !== live) return;
      let saved = false;
      await act(async () => {
        const result = await api.liveTranscript(event);
        setEvents(previous => [...previous, ...result.new_events]); setState(result.state);
        saved = true;
      });
      if (!saved) throw new Error('Transcript submission failed');
    });
    microphone.current = live;
    void live.start();
  }

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!lock.current) {
        const version = revision.current;
        try {
          const result = await api.state();
          if (!disposed && version === revision.current) {
            setState(result); setConnected(true); setUpdated(new Date().toISOString());
          }
        } catch { if (!disposed && version === revision.current) setConnected(false); }
      }
      if (!disposed) timer = setTimeout(() => { void poll(); }, 2000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  useEffect(() => { if (catchup && !dialog.current?.open) dialog.current?.showModal(); }, [catchup]);
  useEffect(() => {
    if (!busy && !catchup && restoreFocus.current) { missedButton.current?.focus(); restoreFocus.current = false; }
  }, [busy, catchup]);
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [events]);

  async function act(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; revision.current++; setBusy(true); setError(''); setNotice('');
    const start = performance.now();
    try { await work(); setConnected(true); setUpdated(new Date().toISOString()); }
    catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally { revision.current++; lock.current = false; setBusy(false); setElapsed(Math.round(performance.now() - start)); }
  }

  async function nextBatch() {
    if (activeReplay === null) return;
    const replay = replays[activeReplay]!;
    const input = replay.batches[batch];
    if (!input) return;
    await act(async () => {
      const result = await api.transcript(input);
      setEvents(previous => [...previous, ...result.new_events]); setState(result.state); setBatch(batch + 1);
      if (batch + 1 === replay.batches.length) setPlaying(false);
    });
  }
  useEffect(() => {
    if (!playing || busy || catchup) return;
    const timer = setTimeout(() => { void nextBatch(); }, 1800);
    return () => clearTimeout(timer);
  }, [playing, busy, batch, activeReplay, catchup]);

  function clearSession(next: ContextState) {
    setState(next); setEvents([]); setSeen(new Set()); setCatchup(null); setLastCatchup(null); setEvidenceEvents([]);
    setBatch(0); setPlaying(false); follow.current = true; setFollowing(true);
  }
  function closeCatchup() { restoreFocus.current = true; dialog.current?.close(); setCatchup(null); }
  const requests = state?.user_requests.filter(item => requestStatus(item) === 'active') ?? [];
  const priority = requests[0];
  const unseen = state ? semanticItems(state).filter(item => !seen.has(item.key)) : [];
  const caughtItems = catchup ? catchupItems(catchup) : [];
  const sourceEvents = [...events, ...evidenceEvents];
  const total = activeReplay === null ? 0 : replays[activeReplay]!.batches.length;
  const replayState = activeReplay === null ? 'Replay ready' : playing ? 'Replay playing' : batch === total ? 'Replay complete' : 'Replay paused';

  async function enableNotifications() {
    if (!('Notification' in window)) {
      setNotice('Notifications are not supported in this browser.');
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      setNotice('Notifications enabled.');
    } else {
      setNotice(`Notification permission: ${permission}`);
    }
  }

  async function sendTestNotification() {
    if (Notification.permission !== 'granted') {
      setNotice('Enable notifications first.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;

    await registration.showNotification('SenseLayer · You’re needed', {
      body: 'Someone in the conversation is asking for you.',
      tag: 'senselayer-test'
    });

    setNotice('Test notification sent.');
  }  

return <>
    <a className="skip-link" href="#conversation">Skip to conversation</a>
    <div className="shell">
      <header className="app-header">
        <a className="brand" href="#conversation" aria-label="SenseLayer conversation"><span className="brand-mark" aria-hidden="true">≋</span>SenseLayer</a>
        <div className="connection"><span className={`status-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
          <span>{connected ? replayState : state ? 'Connection interrupted' : 'Connecting to server…'}</span><span className="mic-note" role="status">Microphone: {micState}</span>
        </div>
      </header>
      <main>
        <section className="intro" aria-labelledby="page-title">
          <div><p className="eyebrow">A little support. More conversation.</p><h1 id="page-title">Stay in the conversation.</h1><p className="intro-copy">Follow along here. Catch up whenever you need.</p></div>
          <div className="catchup-action"><button className="primary missed" ref={missedButton} disabled={busy || !connected} onClick={() => {
            setPlaying(false); void act(async () => {
              const result = await api.catchup(); setCatchup(result); setLastCatchup(result);
              setEvidenceEvents(previous => [...new Map([...previous, ...result.changes.flatMap(change => change.evidence)].map(event => [event.id, event])).values()]);
            });
          }}><span aria-hidden="true">↶</span> I MISSED THAT</button>
            <p className="change-hint" role="status">{unseen.length ? `${unseen.length} unseen ${unseen.length === 1 ? 'update' : 'updates'}` : 'Here when you need it.'}</p>
          </div>
        </section>
        {error && <div className="message error" role="alert">{error}</div>}
        <div className="control-row" aria-label="Microphone controls">
          <button className="secondary" disabled={busy || !connected || micStopping || micState === 'connecting' || micState === 'listening'} onClick={startMicrophone}>Start microphone</button>
          <button className="secondary" disabled={micStopping || (micState !== 'connecting' && micState !== 'listening')} onClick={() => { void stopMicrophone(); }}>Stop microphone</button>
          {micStopping && <span role="status">Finishing transcription…</span>}
        </div>
        {micError && <p className="message error" role="alert">{micError}</p>}
        {!connected && <p className="message">{state ? 'Showing the last received state. Reconnecting automatically.' : 'Waiting for the server. Start the development backend to connect.'}</p>}
        <p className="sr-only" role="status">{notice}</p>
        {priority && <section className="priority-card" aria-labelledby="priority-title">
          <div className="priority-heading"><p className="eyebrow" id="priority-title">YOU’RE NEEDED</p>{requests.length > 1 && <span>{requests.length} requests to review</span>}</div>
          <p className="request-text">{priority.text}</p><p className="muted">A request from the conversation.</p>
          <div className="priority-actions"><Evidence ids={priority.event_ids} events={sourceEvents} />
            <button className="secondary" disabled={busy || !connected} onClick={() => { void act(async () => {
              const result = await api.attentionAck(priority.id);
              setState(previous => previous ? { ...previous, user_requests: previous.user_requests.map(item => item.id === result.id ? result : item) } : previous);
              setNotice('Request acknowledged.'); restoreFocus.current = true;
            }); }}>Got it</button></div>
        </section>}
        <section className="conversation" id="conversation" tabIndex={-1} aria-labelledby="transcript-title">
          <div className="section-heading"><h2 id="transcript-title">Conversation</h2><span className="quiet-label">{activeReplay !== null ? 'REPLAY TRANSCRIPT' : 'TRANSCRIPT'}</span></div>
          <div className="transcript" ref={transcript} tabIndex={0} role="region" aria-label="Conversation transcript" onScroll={() => {
            const element = transcript.current!; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60; setFollowing(follow.current);
          }}>
            {!events.length ? <div className="empty-transcript"><span aria-hidden="true" className="empty-mark">“</span><h3>Room for the conversation.</h3><p>Start the microphone or a demo replay below.<br />Replay needs no microphone or audio.</p></div>
              : <ol className="utterances">{events.map(event => <li key={event.id} id={`event-${event.id}`}><div className="speaker-line"><strong>{event.speaker}</strong><time dateTime={event.timestamp}>{time(event.timestamp)}</time></div><p>{event.text}</p></li>)}</ol>}
          </div>
          <div className="transcript-footer"><span>Words received in this session</span>{!following && <button className="text-button" onClick={() => {
            follow.current = true; setFollowing(true); transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
          }}>Jump to latest ↓</button>}</div>
        </section>
        <details className="demo-controls"><summary>Demo replay <span className="summary-note">No microphone required</span></summary>
          <div className="controls-body"><p>Replay fixture text through the backend. Starting a replay resets this shared demo session.</p>
            <div className="control-row"><label>Conversation<select value={selected} disabled={busy || playing} onChange={event => setSelected(Number(event.target.value))}>{replays.map((replay, index) => <option key={replay.name} value={index}>{replay.name}</option>)}</select></label>
              <button className="secondary" disabled={busy || !connected || micStopping} onClick={() => { setPlaying(false); void stopMicrophone().then(() => act(async () => {
                clearSession(await api.reset()); setActiveReplay(selected); setPlaying(true);
              })); }}>Start replay</button>
              {activeReplay !== null && <><button className="secondary" disabled={busy || batch >= total || !connected} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Resume'}</button><button className="text-button" disabled={busy || playing || batch >= total || !connected} onClick={() => { void nextBatch(); }}>Next batch</button></>}
              <button className="text-button reset" disabled={busy || !connected || micStopping} onClick={() => { setPlaying(false); void stopMicrophone().then(() => act(async () => {
                clearSession(await api.reset()); setActiveReplay(null); setNotice('Session reset.');
              })); }}>Reset session</button>
            </div>
            {activeReplay !== null && <p role="status">{replays[activeReplay]!.name} · {replayState} · {batch} of {total} batches</p>}
            <p className="technical-note">All interpretation comes from the backend. The full demo uses the deterministic Engine grammar; the three foundation fixtures also remain available.</p>
          </div>
        </details>
      </main>
      <footer className="app-footer"><span>Quiet by default. Relevant when needed.</span>
        <details className="debug"><summary>Developer / debug</summary><div className="debug-body">
          <h2>Developer state</h2><dl><dt>Mode</dt><dd>{replayState}; microphone {micState}</dd><dt>Last state received</dt><dd>{updated ?? 'Not yet'}</dd><dt>Last action round trip</dt><dd>{elapsed === null ? 'Not yet' : `${elapsed} ms`}</dd><dt>DeltaOps</dt><dd>Raw proposals not exposed by this API</dd><dt>Unseen indicator baseline</dt><dd>{seen.size} semantic items acknowledged in this browser session; catch-up itself uses the backend watermark</dd></dl>
          <h3>ContextState · includes evidence IDs</h3><pre>{JSON.stringify(state, null, 2)}</pre><h3>Received transcript events</h3><pre>{JSON.stringify(events, null, 2)}</pre>
          <h3>Last catch-up · watermark and applied semantic changes</h3><pre>{JSON.stringify(lastCatchup, null, 2)}</pre>
        </div></details>
      </footer>
    </div>
    <dialog ref={dialog} aria-labelledby="catchup-title" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]')]
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} onCancel={event => { event.preventDefault(); if (!busy) closeCatchup(); }}>
      {catchup && <><header className="dialog-header"><div><p className="eyebrow">A moment to catch up</p><h2 id="catchup-title">Here’s what matters.</h2></div><button className="close-button" aria-label="Close catch-up" disabled={busy} onClick={closeCatchup}>×</button></header>
        <div className="catchup-content"><p className="muted">Changes since your last acknowledged catch-up.</p>
          {!caughtItems.length ? <div className="nothing-new"><h3>No new important updates.</h3><p>You can return to the conversation.</p></div> : ['TOPIC', 'DECIDED', 'STILL OPEN', 'RESOLVED', 'ABOUT YOU'].map(group => {
            const items = caughtItems.filter(item => item.group === group);
            return items.length > 0 && <section className="catchup-group" key={group}><h3>{group}</h3><ul>{items.map(item => <li key={item.key}><p>{item.text}</p><Evidence ids={item.event_ids} events={sourceEvents} /></li>)}</ul></section>;
          })}
          {error && <p className="message error" role="alert">{error}</p>}
        </div><footer className="dialog-footer"><p>This marks your catch-up as read.<br />Requests still have their own “Got it”.</p><button className="primary" disabled={busy} onClick={() => { void act(async () => {
          const result = await api.catchupAck(catchup.id);
          if (!result.acknowledged_at) throw new Error('Catch-up was not acknowledged. Please try again.');
          setLastCatchup(result);
          setSeen(previous => new Set([...previous, ...semanticItems(catchup.state).map(item => item.key)]));
          closeCatchup(); setNotice('You’re caught up.');
        }); }}>{busy ? 'Saving…' : 'I’m caught up'}</button></footer></>}
    </dialog>
  </>;
}
