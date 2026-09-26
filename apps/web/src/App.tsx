import React, { useEffect, useRef, useState } from 'react';
import { type CatchupResponse, type SessionResponse, type TranscriptEvent, type TranscriptResponse } from '@senselayer/shared';
import { api } from './api.js';
import { replays } from './fixtures.js';
import { catchupItems, outstandingRequests, semanticItems } from './semantic.js';
import { LiveMicrophone, type MicrophoneState } from './live.js';

const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Evidence({ ids, events }: { ids: string[]; events: TranscriptEvent[] }) {
  return <details className="evidence"><summary>View source</summary>
    <div className="source-content">{ids.map(id => {
      const event = events.find(item => item.id === id);
      return event ? <blockquote key={id}><p>{event.text}</p><footer>{event.speaker} · {time(event.timestamp)}</footer></blockquote>
        : <p key={id}>This source is unavailable. The interpretation cannot be checked here.</p>;
    })}</div>
  </details>;
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const revision = useRef(-1);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actions, setActions] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const [catchup, setCatchup] = useState<CatchupResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [activeReplay, setActiveReplay] = useState<number | null>(null);
  const [batch, setBatch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [textSize, setTextSize] = useState('1');
  const [highlightAttention, setHighlightAttention] = useState(true);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const catchupFocus = useRef(false);
  const restoreFocus = useRef(false);
  const requestsHeading = useRef<HTMLHeadingElement>(null);
  const missedButton = useRef<HTMLButtonElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const microphone = useRef<LiveMicrophone | null>(null);
  const [micState, setMicState] = useState<MicrophoneState>('disconnected');
  const [micError, setMicError] = useState('');
  const [micStopping, setMicStopping] = useState(false);
  const busy = (key: string) => actions.has(key);
  const state = session?.state;
  const events = session?.events ?? [];

  function applySession(next: SessionResponse) {
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setSession(next); setConnected(true);
  }
  function applyTranscript(result: TranscriptResponse) {
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
  useEffect(() => () => { microphone.current?.dispose(); microphone.current = null; }, []);
  useEffect(() => {
    if (catchup && catchupFocus.current) { panelHeading.current?.focus(); catchupFocus.current = false; }
    if (!catchup && restoreFocus.current && !actions.has('catchup') && !actions.has('catchup-ack')) {
      missedButton.current?.focus(); restoreFocus.current = false;
    }
  }, [catchup, actions]);
  useEffect(() => {
    if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [events.length]);

  async function stopMicrophone() {
    setMicStopping(true);
    try { await microphone.current?.stop(); microphone.current = null; }
    finally { setMicStopping(false); }
  }
  function startMicrophone() {
    setPlaying(false); setActiveReplay(null); setMicError('');
    const live = new LiveMicrophone((status, message) => { setMicState(status); setMicError(message ?? ''); }, async event => {
      // Finalized text is accepted independently of UI actions and semantic work.
      const result = await api.liveTranscript(event);
      if (microphone.current === live) applyTranscript(result);
    });
    microphone.current = live;
    void live.start();
  }
  async function nextBatch() {
    if (activeReplay === null || locks.current.has('replay')) return;
    const replay = replays[activeReplay]!;
    const input = replay.batches[batch];
    if (!input) return;
    await act('replay', async () => {
      try {
        applyTranscript(await api.transcript(input)); setBatch(batch + 1);
        if (batch + 1 === replay.batches.length) setPlaying(false);
      } catch (cause) { setPlaying(false); throw cause; }
    });
  }
  useEffect(() => {
    if (!playing || busy('replay')) return;
    const timer = setTimeout(() => { void nextBatch(); }, 2400);
    return () => clearTimeout(timer);
  }, [playing, actions, batch, activeReplay]);

  async function openCatchup(moveFocus: boolean) {
    if (locks.current.has('catchup-ack')) return;
    await act('catchup', async () => {
      const result = await api.catchup(); catchupFocus.current = moveFocus; setCatchup(result);
    });
  }
  function closeCatchup() { restoreFocus.current = true; setCatchup(null); }
  async function resetSession() {
    await api.reset(); await refresh(); setCatchup(null); setBatch(0);
    follow.current = true; setFollowing(true);
  }
  const requests = state ? outstandingRequests(state) : [];
  const caughtItems = catchup ? catchupItems(catchup) : [];
  const allOpen = catchup ? semanticItems(catchup.state).filter(item => item.group === 'STILL OPEN') : [];
  const olderOpen = allOpen.filter(item => !caughtItems.some(current => current.key === item.key));
  const sourceEvents = [...new Map([...events, ...(catchup?.changes.flatMap(change => change.evidence) ?? [])].map(event => [event.id, event])).values()];
  const total = activeReplay === null ? 0 : replays[activeReplay]!.batches.length;
  const replayState = activeReplay === null ? 'Ready' : playing ? 'Replay playing' : batch === total ? 'Replay complete' : 'Replay paused';
  const mode = micState === 'listening' ? 'Live microphone' : micState === 'connecting' ? 'Connecting microphone' : replayState;
  const newChanges = catchup ? Math.max(0, (session?.change_seq ?? 0) - catchup.upper_bound) : 0;
  const processing = session?.processing;
  const unreviewed = session ? Math.max(0, session.change_seq - session.acknowledged_seq) : 0;

  return <div className="app" style={{ '--reader-scale': textSize } as React.CSSProperties}>
    <a className="skip-link" href="#conversation">Skip to conversation</a>
    <div className="shell">
      <header className="app-header">
        <a className="brand" href="#conversation" aria-label="SenseLayer conversation"><span className="brand-mark" aria-hidden="true">≋</span>SenseLayer</a>
        <div className="connection"><span className={`status-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
          <span>{connected ? mode : session ? 'Connection interrupted' : 'Connecting to server…'}</span>
          <span className="mic-note" role="status">Microphone: {micState}</span>
        </div>
      </header>
      <main>
        <section className="intro" aria-labelledby="page-title">
          <div><p className="eyebrow">For a student project meeting</p><h1 id="page-title">Pick up what changed.</h1><p className="intro-copy">Recover the decision, its reason, and your next step.</p></div>
          <div className="catchup-action"><button className="primary missed" ref={missedButton} disabled={busy('catchup') || busy('catchup-ack') || !connected} onClick={() => { void openCatchup(true); }}><span aria-hidden="true">↶</span> {busy('catchup') ? 'Opening catch-up…' : 'I MISSED THAT'}</button>
            <p className="change-hint">{unreviewed ? `${unreviewed} ${unreviewed === 1 ? 'change' : 'changes'} since your last review` : 'Catch up when you choose.'}</p>
          </div>
        </section>
        <details className="preferences-disclosure"><summary>Reading and attention settings</summary><div className="preferences">
          <label>Text size<select aria-label="Text size" value={textSize} onChange={event => setTextSize(event.target.value)}><option value="1">Standard</option><option value="1.15">Larger</option><option value="1.3">Largest</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={highlightAttention} onChange={event => setHighlightAttention(event.target.checked)} />Highlight direct attention</label>
          {session && <p className="session-identity">For {session.user.name} · Speech language: {session.user.language}</p>}
        </div></details>
        {error && <div className="message error" role="alert">{error}</div>}
        {!connected && <p className="message">{session ? 'Showing the last received information. Reconnecting automatically.' : 'Waiting for the server.'}</p>}
        <p className="sr-only" role="status">{notice}</p>
        <div className="control-row" aria-label="Microphone controls">
          <button className="secondary" disabled={!connected || micStopping || micState === 'connecting' || micState === 'listening' || busy('reset')} onClick={startMicrophone}>Start microphone</button>
          <button className="secondary" disabled={micStopping || (micState !== 'connecting' && micState !== 'listening')} onClick={() => { void stopMicrophone(); }}>Stop microphone</button>
          {micStopping && <span role="status">Finishing transcription…</span>}
        </div>
        {micError && <p className="message error" role="alert">{micError}</p>}
        {processing && <div className={`processing-status ${processing.status === 'error' ? 'message error' : ''}`}>
          <p role="status">{processing.status === 'processing' ? 'Words are saved. Updating their meaning…' : processing.status === 'error' ? 'Context could not be updated. Saved words are still available below.' : processing.analyzed_at ? `Context includes words received through ${time(processing.analyzed_at)}.` : 'Waiting for the first words.'}</p>
          {processing.status === 'error' && <button className="secondary" disabled={busy('retry') || !connected} onClick={() => { void act('retry', async () => { applySession(await api.retryAnalysis()); }); }}>Retry context</button>}
        </div>}

        {catchup && <section className="catchup-panel" aria-labelledby="catchup-title" onKeyDown={event => { if (event.key === 'Escape') closeCatchup(); }}>
          <header className="dialog-header"><div><p className="eyebrow">Catch up at your pace</p><h2 id="catchup-title" ref={panelHeading} tabIndex={-1}>Here’s what changed.</h2></div><button className="close-button" aria-label="Close catch-up" onClick={closeCatchup}>×</button></header>
          <div className="catchup-content">
            <p className="muted">{catchup.from_time ? `Since the moment you last reviewed, ${time(catchup.from_time)}` : 'Since this session began'} · view saved at {time(catchup.created_at)}. The conversation continues below.</p>
            <div className="snapshot-status" role="status">{newChanges > 0 ? `${newChanges} new ${newChanges === 1 ? 'change has' : 'changes have'} arrived. Refresh when you want to include them.` : processing?.status === 'processing' ? 'More words are being interpreted. They may not be included yet.' : 'This view stays still while you read.'}</div>
            {catchup.processing.status !== 'ready' && <p className="message">{catchup.processing.status === 'error' ? 'Context is incomplete here. Check the saved words or retry context.' : 'Some words were still being interpreted when you opened this view. Refresh for later results.'}</p>}
            <button className="text-button refresh-catchup" disabled={busy('catchup') || busy('catchup-ack') || !connected} onClick={() => { void openCatchup(false); }}>Refresh catch-up</button>
            {!caughtItems.length && <div className="nothing-new"><h3>{catchup.processing.status === 'ready' ? 'No new decisions or requests in this catch-up.' : 'No interpreted changes available yet.'}</h3><p>{catchup.processing.status === 'ready' ? 'You can check the saved words below.' : 'This does not mean nothing happened. The saved words remain available.'}</p></div>}
            {(['WHAT CHANGED', 'NEEDS YOU', 'STILL OPEN'] as const).map(group => {
              const items = caughtItems.filter(item => item.group === group);
              return items.length > 0 && <section className="catchup-group" key={group}><h3>{group === 'STILL OPEN' ? 'STILL OPEN · NEW IN THIS INTERVAL' : group}</h3><ul>{items.map(item => <li key={item.key}>
                {item.previous && <p className="previous">Before: {item.previous}</p>}
                <p>{item.previous ? 'Now: ' : item.resolved ? 'Answered: ' : ''}{item.text}</p>
                {group === 'WHAT CHANGED' && !item.resolved && <p className="rationale"><strong>Why:</strong> {item.rationale?.text ?? 'No explicit reason captured.'}</p>}
                <Evidence ids={item.event_ids} events={sourceEvents} />
                {item.rationale && <details className="evidence rationale-source"><summary>Source for the reason</summary><EvidenceQuotes ids={item.rationale.event_ids} events={sourceEvents} /></details>}
              </li>)}</ul></section>;
            })}
            {olderOpen.length > 0 && <details className="older-questions"><summary>Still open from earlier ({olderOpen.length})</summary><ul>{olderOpen.map(item => <li key={item.key}><p>{item.text}</p><Evidence ids={item.event_ids} events={sourceEvents} /></li>)}</ul></details>}
            {catchup.changes.length > 0 && <details className="all-changes"><summary>All changes in this interval ({catchup.changes.length})</summary><p className="muted">Includes changes later replaced or answered.</p><ol>{catchup.changes.map(change => <li key={change.seq}><p>{change.text}</p><Evidence ids={change.evidence.map(event => event.id)} events={sourceEvents} /></li>)}</ol></details>}
          </div>
          <footer className="dialog-footer">{error && <p className="message error" role="alert">{error}</p>}<p>Mark all changes in this interval as read.<br />New updates stay available.</p><button className="primary" disabled={busy('catchup-ack') || busy('catchup') || !connected} onClick={() => { void act('catchup-ack', async () => {
            const result = await api.catchupAck(catchup.id);
            if (!result.acknowledged_at) throw new Error('Catch-up was not acknowledged. Please try again.');
            await refresh(); closeCatchup(); setNotice('Catch-up marked as read.');
          }); }}>{busy('catchup-ack') ? 'Saving…' : 'I’m caught up'}</button></footer>
        </section>}

        {requests.length > 0 && <section className="requests" aria-labelledby="requests-title"><h2 id="requests-title" ref={requestsHeading} tabIndex={-1}>Needs you</h2><p className="muted">Seen questions remain until answered. Seen tasks remain until completed.</p>
          <ul>{requests.map(request => <li key={request.id} className={`request-row ${highlightAttention && request.explicit_address && !request.acknowledged_at ? 'priority-card' : ''}`}>
            <div className="request-copy"><p className="request-text">{request.text}</p><p className="muted">{time(request.created_at)} · {request.kind === 'task' ? request.acknowledged_at ? 'Seen · task still outstanding' : 'Task' : request.kind === 'question' ? request.acknowledged_at ? 'Seen · awaiting an answer' : 'Question for you' : 'You were called'}</p><Evidence ids={request.event_ids} events={sourceEvents} /></div>
            <div className="request-actions">{!request.acknowledged_at && <button className="secondary" disabled={busy(`request-${request.id}`) || !connected} onClick={() => { void act(`request-${request.id}`, async () => {
              await api.attentionAck(request.id); await refresh(); setNotice('Request marked as seen.'); setTimeout(() => (requestsHeading.current ?? missedButton.current)?.focus(), 0);
            }); }}>Seen</button>}{request.kind === 'task' && <button className="secondary" disabled={busy(`request-${request.id}`) || !connected} onClick={() => { void act(`request-${request.id}`, async () => {
              await api.completeRequest(request.id); await refresh(); setNotice('Task marked as completed.'); setTimeout(() => (requestsHeading.current ?? missedButton.current)?.focus(), 0);
            }); }}>Completed</button>}</div>
          </li>)}</ul>
        </section>}

        <section className="conversation" id="conversation" tabIndex={-1} aria-labelledby="transcript-title">
          <div className="section-heading"><h2 id="transcript-title">Conversation</h2><span className="quiet-label">{activeReplay !== null ? 'REPLAY TRANSCRIPT' : 'SAVED WORDS'}</span></div>
          <div className="transcript" ref={transcript} tabIndex={0} role="region" aria-label="Conversation transcript" onScroll={() => {
            const element = transcript.current!; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60; setFollowing(follow.current);
          }}>
            {!events.length ? <div className="empty-transcript"><h3>Room for the conversation.</h3><p>Start the microphone or a demo replay below.</p></div>
              : <ol className="utterances">{events.map(event => <li key={event.id} id={`event-${event.id}`}><div className="speaker-line"><strong>{event.speaker}</strong><time dateTime={event.timestamp}>{time(event.timestamp)}</time></div><p>{event.text}</p></li>)}</ol>}
          </div>
          <div className="transcript-footer"><span>Saved words · final transcription</span>{!following && <button className="text-button" onClick={() => {
            follow.current = true; setFollowing(true); transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
          }}>Jump to latest ↓</button>}</div>
        </section>
        <details className="demo-controls"><summary>Demo replay <span className="summary-note">No microphone required</span></summary>
          <div className="controls-body"><p>Starting a replay resets this shared demo session. Replay continues while catch-up is open.</p>
            <div className="control-row"><label>Conversation<select value={selected} disabled={busy('replay') || playing} onChange={event => setSelected(Number(event.target.value))}>{replays.map((replay, index) => <option key={replay.name} value={index}>{replay.name}</option>)}</select></label>
              <button className="secondary" disabled={busy('reset') || busy('replay') || !connected || micStopping} onClick={() => { setPlaying(false); void act('reset', async () => { await stopMicrophone(); await resetSession(); setActiveReplay(selected); setPlaying(true); }); }}>Start replay</button>
              {activeReplay !== null && <><button className="secondary" disabled={batch >= total || !connected} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Resume'}</button><button className="text-button" disabled={busy('replay') || playing || batch >= total || !connected} onClick={() => { void nextBatch(); }}>Next batch</button></>}
              <button className="text-button reset" disabled={busy('reset') || busy('replay') || !connected || micStopping} onClick={() => { setPlaying(false); void act('reset', async () => { await stopMicrophone(); await resetSession(); setActiveReplay(null); setNotice('Session reset.'); }); }}>Reset session</button>
            </div>
            {activeReplay !== null && <p role="status">{replays[activeReplay]!.name} · {replayState} · {batch} of {total} batches</p>}
          </div>
        </details>
      </main>
      <footer className="app-footer"><span>Quiet by default. Relevant when needed.</span><details className="debug"><summary>Developer / debug</summary><div className="debug-body"><h2>Session state</h2><pre>{JSON.stringify(session, null, 2)}</pre><h3>Current catch-up snapshot</h3><pre>{JSON.stringify(catchup, null, 2)}</pre></div></details></footer>
    </div>
  </div>;
}

function EvidenceQuotes({ ids, events }: { ids: string[]; events: TranscriptEvent[] }) {
  return <div className="source-content">{ids.map(id => {
    const event = events.find(item => item.id === id);
    return event ? <blockquote key={id}><p>{event.text}</p><footer>{event.speaker} · {time(event.timestamp)}</footer></blockquote> : <p key={id}>Source unavailable.</p>;
  })}</div>;
}
