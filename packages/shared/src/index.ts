import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

