import { AnthropicProvider } from './anthropic.js';
import { OpenAIContextProvider } from './openai.js';
import { DeterministicProvider, type ContextProvider } from './provider.js';
import type { UserIdentity } from './vocative.js';

export function engineConfig(env: NodeJS.ProcessEnv = process.env): { provider: ContextProvider; user: UserIdentity } {
  const mode = env.CONTEXT_PROVIDER ?? 'mock';
  if (mode !== 'mock' && mode !== 'claude' && mode !== 'openai') throw new Error('CONTEXT_PROVIDER must be mock, claude or openai');
  const name = env.SENSELAYER_USER_NAME?.trim() || 'Emilio';
  return {
    provider: mode === 'claude'
      ? new AnthropicProvider(env.ANTHROPIC_API_KEY ?? '', env.ANTHROPIC_MODEL ?? '')
      : mode === 'openai'
        ? new OpenAIContextProvider(env.OPENAI_API_KEY ?? '', env.OPENAI_CONTEXT_MODEL ?? 'gpt-5.6-terra')
        : new DeterministicProvider(),
    user: { name, aliases: (env.SENSELAYER_USER_ALIASES ?? '').split(',').map(alias => alias.trim()).filter(Boolean) },
  };
}
