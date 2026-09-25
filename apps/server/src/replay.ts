import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { TranscriptRequestSchema } from '@senselayer/shared';
import { InMemoryStore } from './state.js';

const ReplaySchema = z.object({
  batches: z.array(TranscriptRequestSchema).min(1),
}).strict();

export async function replay(store: InMemoryStore, input: unknown) {
  const fixture = ReplaySchema.parse(input);
  for (const batch of fixture.batches) {
    // Same application stamping and finalized TranscriptEvent boundary as HTTP.
    await store.ingestFinalized(store.finalize(batch));
  }
  return store.catchup();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = JSON.parse(await readFile(process.argv[2] ?? 'fixtures/engine-replay.json', 'utf8')) as unknown;
  const store = new InMemoryStore(() => '2026-09-25T12:00:00.000Z');
  const result = await replay(store, fixture);
  console.log(JSON.stringify({ lastAnalyzedSeq: store.lastAnalyzedSeq, catchup: result }, null, 2));
}
