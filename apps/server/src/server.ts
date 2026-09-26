import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import webpush, { type PushSubscription } from 'web-push';
import { z, ZodError } from 'zod';
import {
  CatchupRequestSchema, CatchupAckRequestSchema,
  AttentionAckRequestSchema, AttentionAckParamsSchema, ResetRequestSchema, LiveTranscriptSchema,
} from '@senselayer/shared';
import { InMemoryStore, SemanticBatchError, RequestLifecycleError } from './state.js';
import { createTranscriptionSession } from './transcription.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(
    VAPID_SUBJECT!,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const PUSH_SUBSCRIPTION_FILE = '.push-subscription.json';

function loadPushSubscription(): PushSubscription | null {
  try {
    return JSON.parse(
      readFileSync(PUSH_SUBSCRIPTION_FILE, 'utf8')
    ) as PushSubscription;
  } catch {
    return null;
  }
}

let pushSubscription: PushSubscription | null = loadPushSubscription();

async function sendAttentionPush(
  result: ReturnType<InMemoryStore['acceptFinalized']>
) {
  if (!pushSubscription || result.attention.length === 0) return;

  const request = result.state.user_requests.find(
    item => result.attention.includes(item.id)
  );

  if (!request) return;

  try {
    const response = await webpush.sendNotification(
      pushSubscription,
      JSON.stringify({
        title: "SenseLayer · You’re needed",
        body: request.text,
        tag: `senselayer-attention-${request.id}`
      })
    );

    console.log('⌚ Attention push sent:', request.id, response.statusCode);
  } catch (error) {
    console.error('Attention push failed:', error);
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  return body.trim() ? JSON.parse(body) : {};
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function createApp(store = new InMemoryStore(), connectTranscription = createTranscriptionSession) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/state') {
        send(response, 200, store.getState());
        return;
      }
      if (request.method === 'GET' && path === '/session') {
        send(response, 200, store.getSession());
        return;
      }
      if (request.method === 'GET' && path === '/push/vapid-public-key') {
        send(response, 200, { publicKey: VAPID_PUBLIC_KEY ?? null });
        return;
      }
      if (request.method !== 'POST') {
        send(response, 404, { error: 'Not found' });
        return;
      }
      const body = await readBody(request);

      if (path === '/push/subscribe') {
        pushSubscription = body as PushSubscription;

        writeFileSync(
          PUSH_SUBSCRIPTION_FILE,
          JSON.stringify(pushSubscription, null, 2)
        );

        console.log('Push subscription saved to disk');
        send(response, 200, { ok: true });
        return;
      }

      if (path === '/transcript') {
        if (typeof body === 'object' && body !== null && 'source' in body) {
          const event = LiveTranscriptSchema.parse(body);
          const result = store.acceptFinalized([{
            ...event, timestamp: event.receivedAt, speaker: 'Microphone',
          }]);

          void sendAttentionPush(result);

          send(response, 200, result);
        } else {
          const result = store.accept(body);

          void sendAttentionPush(result);

          send(response, 200, result);
        }
      } else if (path === '/analysis/retry') {
        CatchupRequestSchema.parse(body);
        send(response, 200, store.retryAnalysis());
      } else if (path === '/transcription/session') {
        const { sdp } = z.object({ sdp: z.string().startsWith('v=0').max(65536) }).strict().parse(body);
        response.setHeader('Cache-Control', 'no-store');
        try {
          send(response, 200, { sdp: await connectTranscription(sdp) });
        } catch (error) {
          // Never return provider response bodies or credentials.
          send(response, 503, { error: error instanceof Error && error.message.startsWith('Live transcription requires')
            ? error.message : 'OpenAI transcription connection failed. Check backend credentials, network and model access. Replay is still available.' });
        }
      } else if (path === '/catchup') {
        CatchupRequestSchema.parse(body);
        send(response, 200, store.catchup());
      } else if (path === '/catchup/ack') {
        const { catchup_id } = CatchupAckRequestSchema.parse(body);
        const result = store.acknowledgeCatchup(catchup_id);
        send(response, result ? 200 : 404, result ?? { error: 'Catch-up not found' });
      } else if (/^\/attention\/[^/]+\/ack$/.test(path)) {
        AttentionAckRequestSchema.parse(body);
        const { id } = AttentionAckParamsSchema.parse({ id: path.split('/')[2] });
        const result = store.acknowledgeAttention(id);
        send(response, result ? 200 : 404, result ?? { error: 'User request not found' });
      } else if (/^\/attention\/[^/]+\/complete$/.test(path)) {
        AttentionAckRequestSchema.parse(body);
        const { id } = AttentionAckParamsSchema.parse({ id: path.split('/')[2] });
        const result = store.completeRequest(id);
        send(response, result ? 200 : 404, result ?? { error: 'User request not found' });
      } else if (path === '/reset') {
        ResetRequestSchema.parse(body);
        send(response, 200, store.reset());
      } else {
        send(response, 404, { error: 'Not found' });
      }
    } catch (error) {
      if (error instanceof SemanticBatchError) {
        send(response, 503, { error: error.message });
      } else if (error instanceof RequestLifecycleError) {
        send(response, 409, { error: error.message });
      } else if (error instanceof ZodError || error instanceof SyntaxError) {
        send(response, 400, { error: 'Invalid request' });
      } else {
        send(response, 500, { error: 'Internal server error' });
      }
    }
  });
}
