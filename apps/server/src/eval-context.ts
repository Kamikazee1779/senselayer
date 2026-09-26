// Opt-in real-provider checks. No HTTP server, microphone or existing session is used.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { requestStatus } from '@senselayer/shared';
import { engineConfig } from './config.js';
import { InMemoryStore } from './state.js';

const envFile = new URL('../../../.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);
if (!['openai', 'claude'].includes(process.env.CONTEXT_PROVIDER ?? '')) {
  throw new Error('Select CONTEXT_PROVIDER=openai or claude with credentials for this opt-in evaluation.');
}
const counts = z.object({ openQuestions: z.number().int(), requests: z.number().int(), tasks: z.number().int() }).strict();
const cases = z.array(z.object({ name: z.string(), utterances: z.array(z.string()).min(1), expected: counts,
  noQuestionHistory: z.boolean().optional() }).strict())
  .parse(JSON.parse(readFileSync(new URL('../../../fixtures/context-regressions.json', import.meta.url), 'utf8')))
  .filter(item => !process.argv[2] || item.name === process.argv[2]);
if (!cases.length) throw new Error('No matching evaluation case.');
const { provider, user } = engineConfig();
console.log(`Evaluating ${cases.length} cases with ${process.env.CONTEXT_PROVIDER}; real provider requests will be made.`);
let failures = 0;
for (const item of cases) {
  const store = new InMemoryStore(undefined, provider, user);
  try {
    for (const text of item.utterances) await store.submit({ events: [{ speaker: 'Conversation', text: text.replace(/\bEmilio\b/g, () => user.name) }] });
    const state = store.getState();
    const requests = state.user_requests.filter(request => requestStatus(request) !== 'resolved');
    const actual = { openQuestions: state.questions.filter(question => !question.resolution).length,
      requests: requests.length, tasks: requests.filter(request => request.kind === 'task').length };
    assert.deepEqual(actual, item.expected);
    if (item.noQuestionHistory) {
      assert.deepEqual(state.questions, [], 'Small talk must never open a question, even temporarily');
      assert.deepEqual(state.user_requests, [], 'Small talk must never create a personal request, even temporarily');
      assert.deepEqual(state.decisions, [], 'These greetings contain no decisions');
    }
    assert.equal(store.getTranscript().length, item.utterances.length);
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${item.name}: ${error instanceof Error ? error.message : 'Evaluation failed'}`);
    console.error(JSON.stringify(store.getState()));
  }
}
console.log(`${cases.length - failures}/${cases.length} context cases passed.`);
if (failures) process.exitCode = 1;
