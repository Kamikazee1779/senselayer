import { userConfig } from './config.js';
import type { UserIdentity } from './vocative.js';

// The unified WebRTC handshake keeps the long-lived key entirely on the server.
// Audio travels directly from the browser to OpenAI; it is never stored here.
export async function createTranscriptionSession(
  sdp: string,
  apiKey = process.env.OPENAI_API_KEY,
  request: typeof fetch = fetch,
  user: UserIdentity = userConfig(),
): Promise<string> {
  if (!apiKey) throw new Error('Live transcription requires OPENAI_API_KEY on the backend. Replay is still available.');
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify({
    type: 'transcription',
    audio: { input: {
      transcription: {
        model: 'gpt-live-transcribe',
        keywords: [...new Set([user.name, ...user.aliases].map(name => name.trim()).filter(Boolean))],
        languages: [user.language ?? 'en'],
      },
      turn_detection: null,
    } },
  }));
  const response = await request('https://api.openai.com/v1/realtime/calls', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
    body: form, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpenAI transcription connection failed (${response.status}). Check backend credentials and model access. Replay is still available.`);
  const answer = await response.text();
  if (!answer.startsWith('v=0')) throw new Error('OpenAI returned an invalid transcription connection. Replay is still available.');
  return answer;
}
