import { useRef, useState } from 'react';
import type { TranscriptEvent } from '@senselayer/shared';
import { Evidence } from './Summary.js';
import type { Notification } from './notifications.js';

export function NotificationDeck({ cards, events, disabled, onSeen, onComplete }: {
  cards: Notification[]; events: TranscriptEvent[]; disabled: boolean;
  onSeen: (card: Notification) => void; onComplete: (card: Notification) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const index = Math.max(0, cards.findIndex(card => card.id === selected));
  const card = cards[index];
  function move(offset: number) {
    const next = cards[index + offset];
    if (next) setSelected(next.id);
  }
  // Pin the initial card as well: newly arriving cards never replace it.
  if (card && selected !== card.id) setSelected(card.id);
  if (!card) return null;
  return <section className="notifications" aria-label="Notifications" onKeyDown={event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }}>
    <div className="notification-heading"><h2>For you <span className="unread-count" aria-live="polite">{cards.length} new</span></h2>
      <div className="notification-navigation">
        <button className="icon-button" aria-label="Previous notification" disabled={index === 0} onClick={() => move(-1)}>‹</button>
        <span className="notification-count" aria-live="polite">{index + 1} / {cards.length}</span>
        <button className="icon-button" aria-label="Next notification" disabled={index === cards.length - 1} onClick={() => move(1)}>›</button>
      </div>
    </div>
    <article className={`notification-card ${card.level}`} aria-label={`${card.level === 'action' ? 'Action now' : card.level === 'attention' ? 'Needs attention' : 'Context update'} notification`}
      onTouchStart={event => {
        if ((event.target as Element).closest('button, summary, a')) return;
        const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null;
      }} onTouchEnd={event => {
        const end = event.changedTouches[0], start = touch.current; touch.current = null;
        if (start && end && Math.abs(end.clientX - start.x) > 60 && Math.abs(end.clientY - start.y) < 40) move(end.clientX < start.x ? 1 : -1);
      }}>
      <div className="notification-body" key={card.id}>
        <p className="notification-label"><span aria-hidden="true">{card.level === 'action' ? '!' : card.level === 'attention' ? '◉' : '✓'}</span> {card.level === 'action' ? 'Action now' : card.level === 'attention' ? 'Needs attention' : 'Context update'}</p>
        <p className="notification-text">{card.text}</p>
        <Evidence ids={card.event_ids} events={events} />
      </div>
      <div className="notification-actions">
        <button className="seen-button" disabled={disabled} onClick={() => onSeen(card)}>Seen</button>
        {card.request?.kind === 'task' && <button className="complete-button" disabled={disabled} onClick={() => onComplete(card)}>Completed</button>}
      </div>
    </article>
  </section>;
}
