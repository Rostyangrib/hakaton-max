import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const residentProfileInputSchema = z.object({
  apartment: z.coerce.number().int().min(1).max(9_999),
  entrance: z.coerce.number().int().min(1).max(999),
  floor: z.coerce.number().int().min(-9).max(999).nullable().optional(),
  carPlate: z.string().trim().max(32).nullable().optional(),
  carDescription: z.string().trim().max(100).nullable().optional(),
  alertsEnabled: z.boolean().default(true),
});

export const residentProfileSchema = residentProfileInputSchema.extend({
  membershipVerifiedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const maxUserSchema = z.object({
  user_id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().nullable().optional(),
});

export const maxUpdateSchema = z
  .object({
    update_type: z.enum([
      'bot_added',
      'bot_removed',
      'bot_started',
      'bot_stopped',
      'message_callback',
      'message_created',
      'message_edited',
      'message_removed',
      'user_added',
      'user_removed',
    ]),
    timestamp: z.number().int().nonnegative(),
  })
  .passthrough();

export type ResidentProfileInput = z.infer<typeof residentProfileInputSchema>;
export type ResidentProfile = z.infer<typeof residentProfileSchema>;
export type MaxUser = z.infer<typeof maxUserSchema>;
export type MaxUpdate = z.infer<typeof maxUpdateSchema>;

export const summaryPeriodSchema = z.enum(['today', 'week', 'month']);

export const summaryItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
  sourceMessageIds: z.array(z.string().min(1)).min(1).max(20),
});

export const summaryCategoriesSchema = z.object({
  housing: z.array(summaryItemSchema).max(10),
  yard: z.array(summaryItemSchema).max(10),
  community: z.array(summaryItemSchema).max(10),
}).strict();

export const summaryResultSchema = summaryCategoriesSchema.extend({
  period: summaryPeriodSchema,
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  filteredCount: z.number().int().nonnegative(),
  savedMinutes: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  mode: z.enum(['yandexgpt', 'fallback']),
  cached: z.boolean(),
}).strict();

export type SummaryPeriod = z.infer<typeof summaryPeriodSchema>;
export type SummaryItem = z.infer<typeof summaryItemSchema>;
export type SummaryCategories = z.infer<typeof summaryCategoriesSchema>;
export type SummaryResult = z.infer<typeof summaryResultSchema>;

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}

const visuallyEquivalentPlateLetters: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
};

export function normalizeCarPlate(value: string): string | null {
  const compact = value.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
  const converted = [...compact].map((letter) => visuallyEquivalentPlateLetters[letter] ?? letter).join('');
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/u.test(converted) ? converted : null;
}
