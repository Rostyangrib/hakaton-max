import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const vehicleItemSchema = z.object({
  id: z.string().optional(),
  plate: z.string().trim().max(32).nullable().optional(),
  plateNormalized: z.string().trim().max(16).nullable().optional(),
  description: z.string().trim().max(100).nullable().optional(),
});

export const propertyItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().max(100).optional(),
  chatId: z.coerce.number().int().optional(),
  apartment: z.coerce.number().int().min(1).max(9_999),
  entrance: z.coerce.number().int().min(1).max(999),
  floor: z.coerce.number().int().min(-9).max(999).nullable().optional(),
});

export const residentProfileInputSchema = z.object({
  apartment: z.coerce.number().int().min(1).max(9_999),
  entrance: z.coerce.number().int().min(1).max(999),
  floor: z.coerce.number().int().min(-9).max(999).nullable().optional(),
  carPlate: z.string().trim().max(32).nullable().optional(),
  carDescription: z.string().trim().max(100).nullable().optional(),
  properties: z.array(propertyItemSchema).optional(),
  vehicles: z.array(vehicleItemSchema).optional(),
  alertsEnabled: z.boolean().default(true),
});

export const residentProfileSchema = residentProfileInputSchema.extend({
  properties: z.array(propertyItemSchema).default([]),
  vehicles: z.array(vehicleItemSchema).default([]),
  membershipVerifiedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type VehicleItem = z.infer<typeof vehicleItemSchema>;
export type PropertyItem = z.infer<typeof propertyItemSchema>;

const userIdField = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/).transform(Number),
]);

export const maxUserSchema = z
  .object({
    user_id: userIdField.optional(),
    id: userIdField.optional(),
    first_name: z
      .string()
      .nullish()
      .transform((val) => (val && val.trim() ? val.trim() : 'Жилец')),
    last_name: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    language_code: z.string().nullable().optional(),
    photo_url: z.string().nullable().optional(),
  })
  .passthrough()
  .refine((data) => data.user_id !== undefined || data.id !== undefined, {
    message: 'Either user_id or id must be provided',
  })
  .transform((data) => ({
    user_id: (data.user_id ?? data.id)!,
    first_name: data.first_name,
    last_name: data.last_name ?? undefined,
    username: data.username ?? undefined,
  }));

export const maxUpdateSchema = z
  .object({
    update_type: z.string().min(1),
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
  housing: z.array(summaryItemSchema).max(10).default([]),
  yard: z.array(summaryItemSchema).max(10).default([]),
  community: z.array(summaryItemSchema).max(10).default([]),
});

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
  apartmentFilter: z.number().int().positive().optional(),
  residentApartments: z.array(z.number().int().positive()).optional(),
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
  const compact = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-_/|]+/g, '')
    .replace(/(?:RUS|РУС)$/u, '');
  const converted = [...compact].map((letter) => visuallyEquivalentPlateLetters[letter] ?? letter).join('');
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}(?:\d{2,3})?$/u.test(converted) ? converted : null;
}

export function matchPlates(plateA: string, plateB: string): boolean {
  const normA = normalizeCarPlate(plateA);
  const normB = normalizeCarPlate(plateB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const baseA = normA.slice(0, 6);
  const baseB = normB.slice(0, 6);
  if (baseA !== baseB) return false;
  const regA = normA.slice(6);
  const regB = normB.slice(6);
  if (!regA || !regB) return true;
  return regA === regB;
}
