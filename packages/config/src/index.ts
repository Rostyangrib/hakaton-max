import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).default('postgresql://quietchat:quietchat@localhost:5432/quietchat'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5_000),
  HOME_TIMEZONE: z.string().min(1).default('Asia/Irkutsk'),
  MAX_BOT_TOKEN: optionalString,
  MAX_BOT_USERNAME: optionalString,
  MAX_WEBHOOK_SECRET: optionalString,
  MAX_HOME_CHAT_ID: optionalString,
  MAX_HOME_CHAT_URL: optionalString,
  MAX_MINI_APP_URL: optionalString,
  MAX_API_BASE_URL: z.url().default('https://platform-api2.max.ru'),
  SESSION_SECRET: optionalString,
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(3_600),
  MAX_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(600),
  ALERT_ANTIFLOOD_MINUTES: z.coerce.number().int().min(0).max(1_440).default(0),
  YANDEX_CLOUD_FOLDER_ID: optionalString,
  YANDEX_CLOUD_API_KEY: optionalString,
  YANDEXGPT_MODEL_URI: optionalString,
  YANDEXGPT_API_URL: z.url().default('https://llm.api.cloud.yandex.net/foundationModels/v1/completion'),
  YANDEXGPT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
  SUMMARY_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = { ...environment };
  if (!env.YANDEX_CLOUD_FOLDER_ID && env.YANDEX_FOLDER_ID) {
    env.YANDEX_CLOUD_FOLDER_ID = env.YANDEX_FOLDER_ID;
  }
  if (!env.YANDEX_CLOUD_API_KEY) {
    env.YANDEX_CLOUD_API_KEY = env.YANDEX_API_KEY || env.YC_API_KEY;
  }
  if (!env.YANDEXGPT_MODEL_URI && env.YANDEX_MODEL_URI) {
    env.YANDEXGPT_MODEL_URI = env.YANDEX_MODEL_URI;
  }
  return environmentSchema.parse(env);
}
