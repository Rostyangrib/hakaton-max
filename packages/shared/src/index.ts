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

export interface ApiEnvelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}
