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
}).strict();
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;

export const DecisionSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  text: TextSchema,
  event_ids: EvidenceSchema,
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
}).strict();
export type UserRequest = z.infer<typeof UserRequestSchema>;

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
  z.object({ op: z.literal('add_decision'), text: TextSchema, event_ids: EvidenceSchema }).strict(),
  z.object({ op: z.literal('open_question'), text: TextSchema, event_ids: EvidenceSchema }).strict(),
  z.object({
    op: z.literal('resolve_question'), question_id: IdSchema,
    text: TextSchema, event_ids: EvidenceSchema,
  }).strict(),
  z.object({ op: z.literal('add_user_request'), text: TextSchema, event_ids: EvidenceSchema }).strict(),
]);
export type DeltaOp = z.infer<typeof DeltaOpSchema>;

// Contextual validation is mandatory before applying any model proposal.
// All cited events must be in this batch (a stricter form of the minimum-one rule).
export function parseDeltaOps(input: unknown, new_events: readonly TranscriptEvent[]): DeltaOp[] {
  const currentIds = new Set(new_events.map(event => event.id));
  return z.array(DeltaOpSchema).superRefine((ops, ctx) => {
    ops.forEach((op, index) => {
      op.event_ids.forEach((id, evidenceIndex) => {
        if (!currentIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'event_ids', evidenceIndex],
            message: 'Evidence must belong to the current new_events batch',
          });
        }
      });
    });
  }).parse(input);
}

export const TranscriptRequestSchema = z.object({
  events: z.array(z.object({ speaker: TextSchema, text: TextSchema }).strict()).min(1),
}).strict();
export const TranscriptResponseSchema = z.object({
  new_events: z.array(TranscriptEventSchema),
  state: ContextStateSchema,
}).strict();
export const StateResponseSchema = ContextStateSchema;
export const CatchupRequestSchema = z.object({}).strict();
export const CatchupResponseSchema = z.object({
  id: IdSchema,
  created_at: TimestampSchema,
  state: ContextStateSchema,
  acknowledged_at: TimestampSchema.nullable(),
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
