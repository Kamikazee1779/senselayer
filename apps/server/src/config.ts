import { AnthropicProvider } from './anthropic.js';
import { DeterministicProvider, type ContextProvider } from './provider.js';
import type { UserIdentity } from './vocative.js';

export function engineConfig(env: NodeJS.ProcessEnv = process.env): { provider: ContextProvider; user: UserIdentity } {
  const mode = env.CONTEXT_PROVIDER ?? 'mock';
  if (mode !== 'mock' && mode !== 'claude') throw new Error('CONTEXT_PROVIDER must be mock or claude');
  const name = env.SENSELAYER_USER_NAME?.trim() || 'Emilio';
  return {
    provider: mode === 'claude'
      ? new AnthropicProvider(env.ANTHROPIC_API_KEY ?? '', env.ANTHROPIC_MODEL ?? '')
      : new DeterministicProvider(),
    user: { name, aliases: (env.SENSELAYER_USER_ALIASES ?? '').split(',').map(alias => alias.trim()).filter(Boolean) },
  };
}
