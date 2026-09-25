import topic from '../../../fixtures/topic-and-decision.json';
import question from '../../../fixtures/question-resolution.json';
import request from '../../../fixtures/user-request.json';
import engine from '../../../fixtures/engine-replay.json';

// Only transcript input goes to the real API. Never render fixture ops/expected state.
export const replays = [
  { name: 'Group conversation · full demo', batches: engine.batches },
  { name: 'A demo decision', batches: topic.batches.map(batch => ({ events: batch.events })) },
  { name: 'A question answered', batches: question.batches.map(batch => ({ events: batch.events })) },
  { name: 'A request for you', batches: request.batches.map(batch => ({ events: batch.events })) },
];
