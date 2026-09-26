import type { TranscriptEvent } from '@senselayer/shared';

export interface UserIdentity { name: string; aliases: readonly string[]; language?: string }

export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Conservative sentence-leading vocatives only. Names inside reported speech
// or ordinary third-person mentions are not an interruption signal.
export function isExplicitAddress(text: string, user: UserIdentity): boolean {
  const normalized = normalizeText(text);
  return [user.name, ...user.aliases].map(normalizeText).filter(Boolean).some(name => {
    if (normalized === name || normalized === `hey ${name}` || normalized === `hi ${name}`) return true;
    const prefix = normalized.startsWith(`hey ${name} `) ? `hey ${name} `
      : normalized.startsWith(`hi ${name} `) ? `hi ${name} ` : `${name} `;
    if (!normalized.startsWith(prefix)) return false;
    return /^(?:you\b|(?:can|could|would|do|are|will) you\b|what do you\b|please\b)/u.test(normalized.slice(prefix.length));
  });
}

// STT can finalize a standalone summons before the rest of the request. A
// bounded candidate lets the semantic model join that address with the next
// direct request, without treating an ordinary earlier name mention as one.
export function continuingAddress(
  transcript: readonly TranscriptEvent[], newEvents: readonly TranscriptEvent[], user: UserIdentity,
): { address_event_id: string; request_event_id: string } | undefined {
  const current = newEvents[0];
  if (!current) return;
  const index = transcript.findIndex(event => event.id === current.id);
  const previous = transcript[index - 1];
  if (!previous || previous.speaker !== current.speaker) return;
  const elapsed = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 15_000) return;
  const address = normalizeText(previous.text);
  const standalone = [user.name, ...user.aliases].map(normalizeText).filter(Boolean)
    .some(name => address === name || address === `hey ${name}`);
  if (!standalone) return;
  // No work-verb list: loading a dishwasher is as valid as reviewing code.
  if (!/^(?:(?:can|could|would|will|do|are|did|have) you\b|what do you\b|please\b|puoi\b|potresti\b|per favore\b)/u.test(normalizeText(current.text))) return;
  return { address_event_id: previous.id, request_event_id: current.id };
}
