import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import {
  CatchupRequestSchema, CatchupAckRequestSchema,
  AttentionAckRequestSchema, AttentionAckParamsSchema, ResetRequestSchema,
} from '@senselayer/shared';
import { InMemoryStore, SemanticBatchError } from './state.js';

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

export function createApp(store = new InMemoryStore()) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/state') {
        send(response, 200, store.getState());
        return;
      }
      if (request.method !== 'POST') {
        send(response, 404, { error: 'Not found' });
        return;
      }
      const body = await readBody(request);
      if (path === '/transcript') {
        send(response, 200, await store.submit(body));
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
      } else if (path === '/reset') {
        ResetRequestSchema.parse(body);
        send(response, 200, store.reset());
      } else {
        send(response, 404, { error: 'Not found' });
      }
    } catch (error) {
      if (error instanceof SemanticBatchError) {
        send(response, 503, { error: error.message });
      } else if (error instanceof ZodError || error instanceof SyntaxError) {
        send(response, 400, { error: 'Invalid request' });
      } else {
        send(response, 500, { error: 'Internal server error' });
      }
    }
  });
}
