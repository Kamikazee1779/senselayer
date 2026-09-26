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
