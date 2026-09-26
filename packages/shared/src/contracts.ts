import { z } from 'zod';

export const IdSchema = z.string().min(1);
export const TimestampSchema = z.string().datetime();
const TextSchema = z.string().trim().min(1);
const EvidenceSchema = z.array(IdSchema).min(1);

export const TranscriptEventSchema = z.object({
  id: IdSchema,
  timestamp: TimestampSchema,
  speaker: TextSchema,
  text: TextSchema,
  seq: z.number().int().positive().optional(),
  final: z.literal(true).optional(),
  source: z.literal('live').optional(),
  receivedAt: TimestampSchema.optional(),
}).strict();
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;

// Browser application metadata for finalized microphone text, not model output.
export const LiveTranscriptSchema = z.object({
  id: IdSchema,
  seq: z.number().int().positive(),
  text: TextSchema,
  final: z.literal(true),
  source: z.literal('live'),
  receivedAt: TimestampSchema,
}).strict();
export type LiveTranscript = z.infer<typeof LiveTranscriptSchema>;

export const RationaleSchema = z.object({ text: TextSchema, event_ids: EvidenceSchema }).strict();

export const DecisionSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  text: TextSchema,
  event_ids: EvidenceSchema,
  superseded_by: IdSchema.optional(),
  rationale: RationaleSchema.optional(),
}).strict();
export type Decision = z.infer<typeof DecisionSchema>;

export const QuestionSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  text: TextSchema,
  event_ids: EvidenceSchema,
  resolution: z.object({
    resolved_at: TimestampSchema,
    text: TextSchema,
    event_ids: EvidenceSchema,
  }).strict().nullable(),
}).strict();
export type Question = z.infer<typeof QuestionSchema>;

export const UserRequestSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  text: TextSchema,
  event_ids: EvidenceSchema,
  acknowledged_at: TimestampSchema.nullable(),
  question_id: IdSchema.optional(),
  resolved_at: TimestampSchema.optional(),
  explicit_address: z.literal(true).optional(),
  kind: z.enum(['attention', 'question', 'task']).optional(),
}).strict();
export type UserRequest = z.infer<typeof UserRequestSchema>;

export function requestStatus(request: UserRequest): 'active' | 'acknowledged' | 'resolved' {
  return request.resolved_at ? 'resolved' : request.acknowledged_at ? 'acknowledged' : 'active';
}
export function questionStatus(question: Question): 'open' | 'resolved' {
  return question.resolution ? 'resolved' : 'open';
}

export const ContextStateSchema = z.object({
  topic: z.object({ text: TextSchema, event_ids: EvidenceSchema }).strict().nullable(),
  decisions: z.array(DecisionSchema),
  questions: z.array(QuestionSchema),
  user_requests: z.array(UserRequestSchema),
}).strict();
export type ContextState = z.infer<typeof ContextStateSchema>;

// Model proposals contain semantic content and references only. No new IDs,
// timestamps, acknowledgement flags, or arbitrary state patches are accepted.
export const DeltaOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_topic'), text: TextSchema, event_ids: EvidenceSchema }).strict(),
  z.object({ op: z.literal('add_decision'), text: TextSchema, event_ids: EvidenceSchema, supersedes_id: IdSchema.optional(), rationale: RationaleSchema.optional() }).strict(),
  z.object({ op: z.literal('open_question'), text: TextSchema, event_ids: EvidenceSchema }).strict(),
  z.object({
    op: z.literal('resolve_question'), question_id: IdSchema,
    text: TextSchema, event_ids: EvidenceSchema,
  }).strict(),
  z.object({ op: z.literal('add_user_request'), text: TextSchema, event_ids: EvidenceSchema, question_id: IdSchema.optional(), kind: z.enum(['question', 'task']).optional() }).strict(),
]);
export type DeltaOp = z.infer<typeof DeltaOpSchema>;

// Contextual validation is mandatory before applying any model proposal.
// With no log supplied, retain the foundation's current-batch-only validation.
export function parseDeltaOps(input: unknown, new_events: readonly TranscriptEvent[], transcript: readonly TranscriptEvent[] = new_events): DeltaOp[] {
  const currentIds = new Set(new_events.map(event => event.id));
  const validIds = new Set(transcript.map(event => event.id));
  return z.array(DeltaOpSchema).superRefine((ops, ctx) => {
    ops.forEach((op, index) => {
      if (!op.event_ids.some(id => currentIds.has(id))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'event_ids'], message: 'At least one citation must belong to new_events' });
      }
      op.event_ids.forEach((id, evidenceIndex) => {
        if (!validIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'event_ids', evidenceIndex],
            message: 'Evidence must belong to the transcript log',
          });
        }
      });
      if (op.op === 'add_decision' && op.rationale) {
        op.rationale.event_ids.forEach((id, evidenceIndex) => {
          if (!validIds.has(id)) ctx.addIssue({
            code: z.ZodIssueCode.custom, path: [index, 'rationale', 'event_ids', evidenceIndex],
            message: 'Rationale evidence must belong to the transcript log',
          });
        });
      }
    });
  }).parse(input);
}

export const TranscriptRequestSchema = z.object({
  events: z.array(z.object({ speaker: TextSchema, text: TextSchema }).strict()).min(1),
}).strict();
export const ProcessingSchema = z.object({
  status: z.enum(['ready', 'processing', 'error']),
  received_seq: z.number().int().nonnegative(),
  analyzed_seq: z.number().int().nonnegative(),
  analyzed_at: TimestampSchema.nullable(),
  error: z.string().nullable(),
}).strict();
export type Processing = z.infer<typeof ProcessingSchema>;
export const SessionResponseSchema = z.object({
  state: ContextStateSchema,
  events: z.array(TranscriptEventSchema),
  processing: ProcessingSchema,
  change_seq: z.number().int().nonnegative(),
  acknowledged_seq: z.number().int().nonnegative(),
  acknowledged_at: TimestampSchema.nullable(),
  revision: z.number().int().nonnegative(),
  user: z.object({ name: TextSchema, language: TextSchema }).strict(),
}).strict();
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export const TranscriptResponseSchema = z.object({
  new_events: z.array(TranscriptEventSchema),
  state: ContextStateSchema,
  attention: z.array(IdSchema).optional(),
  processing: ProcessingSchema,
  revision: z.number().int().nonnegative(),
}).strict();
export const StateResponseSchema = ContextStateSchema;
export const CatchupRequestSchema = z.object({}).strict();
export const SemanticChangeSchema = z.object({
  seq: z.number().int().positive(),
  op: z.enum(['set_topic', 'add_decision', 'open_question', 'resolve_question', 'add_user_request']),
  entity_id: IdSchema.nullable(),
  supersedes_id: IdSchema.optional(),
  text: TextSchema,
  evidence: z.array(TranscriptEventSchema).min(1),
}).strict();
export type SemanticChange = z.infer<typeof SemanticChangeSchema>;
export const CatchupResponseSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  state: ContextStateSchema,
  acknowledged_at: TimestampSchema.nullable(),
  from_seq: z.number().int().nonnegative(),
  upper_bound: z.number().int().nonnegative(),
  changes: z.array(SemanticChangeSchema),
  processing: ProcessingSchema,
  from_time: TimestampSchema.nullable(),
}).strict();
export const CatchupAckRequestSchema = z.object({ catchup_id: IdSchema }).strict();
export const CatchupAckResponseSchema = CatchupResponseSchema;
export const AttentionAckParamsSchema = z.object({ id: IdSchema }).strict();
export const AttentionAckRequestSchema = z.object({}).strict();
export const AttentionAckResponseSchema = UserRequestSchema;
export const ResetRequestSchema = z.object({}).strict();
export const ResetResponseSchema = ContextStateSchema;
export const ErrorResponseSchema = z.object({ error: z.string() }).strict();

export type TranscriptRequest = z.infer<typeof TranscriptRequestSchema>;
export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;
export type StateResponse = z.infer<typeof StateResponseSchema>;
export type CatchupRequest = z.infer<typeof CatchupRequestSchema>;
export type CatchupResponse = z.infer<typeof CatchupResponseSchema>;
export type CatchupAckRequest = z.infer<typeof CatchupAckRequestSchema>;
export type CatchupAckResponse = z.infer<typeof CatchupAckResponseSchema>;
export type AttentionAckParams = z.infer<typeof AttentionAckParamsSchema>;
export type AttentionAckRequest = z.infer<typeof AttentionAckRequestSchema>;
export type AttentionAckResponse = z.infer<typeof AttentionAckResponseSchema>;
export type ResetRequest = z.infer<typeof ResetRequestSchema>;
export type ResetResponse = z.infer<typeof ResetResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
