import { z } from 'zod';
const text = (max = 1200) => z.string().trim().min(1).max(max);
export const createSchema = z
  .object({
    topic: text(2000),
    expertCount: z.number().int().min(2).max(6).default(4),
    maxTurns: z.number().int().min(6).max(20).default(12),
  })
  .strict();
export const personSchema = z.object({
  role: z.enum(['moderator', 'expert']),
  name: text(30),
  occupation: text(60),
  title: text(60),
  stance: text(180),
  focus: text(120),
});
export const rosterSchema = z.object({ participants: z.array(personSchema).min(3).max(7) });
export const intentSchema = z.object({
  apply: z.boolean(),
  kind: z.enum(['raise', 'interrupt', 'supplement', 'rebuttal']),
  replyTo: z.string().nullable(),
  urgency: z.number().int().min(0).max(3),
  publicReason: text(100),
});
export const speechSchema = z.object({
  text: text(2400),
  replyTo: z.string().nullable(),
  addressedTo: z.string().nullable(),
});
export const insightSchema = z.object({
  progress: z.boolean(),
  items: z
    .array(
      z.object({
        id: z.string().max(100).nullable().optional(),
        kind: z.enum(['consensus', 'disagreement']),
        text: text(400),
        evidence: z
          .array(
            z.object({
              messageId: text(100),
              quote: text(500),
              stance: z.enum(['support', 'oppose']),
              view: text(200),
            }),
          )
          .min(1)
          .max(12),
      }),
    )
    .max(12),
  contextSummary: text(3000),
  resolvedDisputes: z
    .array(
      z.object({
        id: text(100),
        evidence: z
          .array(z.object({ messageId: text(100), quote: text(300) }))
          .min(2)
          .max(8),
      }),
    )
    .max(12)
    .default([]),
});
export const summarySchema = z.object({ text: text(6000) });
export const closingSchema = z.object({ highlightMessageIds: z.array(text(100)).max(4) }).strict();
export const reviewSchema = z.object({
  issues: z
    .array(
      z.object({
        kind: z.enum(['scope', 'timeline', 'consensus']),
        quote: text(2400),
        reason: text(220),
        conflictsWith: z.array(text(100)).min(1).max(6),
      }),
    )
    .max(4),
});
export const retentionSchema = z.object({
  answers: z
    .array(z.object({ questionId: text(40), quote: text(2400), sourceMessageId: text(100) }))
    .max(8),
  unresolvedDisagreementIds: z.array(text(100)).max(12),
});
export type InsightOutput = Pick<z.infer<typeof insightSchema>, 'items' | 'contextSummary'>;
