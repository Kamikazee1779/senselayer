import { StateResponseSchema, TranscriptResponseSchema, CatchupResponseSchema, CatchupAckResponseSchema, AttentionAckResponseSchema, ResetResponseSchema, type TranscriptRequest, type LiveTranscript } from '@senselayer/shared';

async function request<T>(path: string, schema: { parse(value: unknown): T }, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  if (!response.ok) throw new Error(`Request failed (${response.status}). Please try again.`);
  try { return schema.parse(await response.json()); }
  catch { throw new Error('The server response could not be read. Please try again.'); }
}
export const api = {
  state: () => request('/state', StateResponseSchema),
  transcript: (body: TranscriptRequest) => request('/transcript', TranscriptResponseSchema, body),
  liveTranscript: (body: LiveTranscript) => request('/transcript', TranscriptResponseSchema, body),
  catchup: () => request('/catchup', CatchupResponseSchema, {}),
  catchupAck: (id: string) => request('/catchup/ack', CatchupAckResponseSchema, { catchup_id: id }),
  attentionAck: (id: string) => request(`/attention/${encodeURIComponent(id)}/ack`, AttentionAckResponseSchema, {}),
  reset: () => request('/reset', ResetResponseSchema, {}),
};
