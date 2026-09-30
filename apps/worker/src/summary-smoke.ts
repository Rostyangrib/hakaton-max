// Explicit opt-in smoke test: uses real YandexGPT, never sends messages to MAX.
import assert from 'node:assert/strict';
import { YandexGptClient } from './yandex-gpt.js';
import { prepareSummaryMessages } from './summary.js';

const apiKey = process.env.YANDEX_CLOUD_API_KEY;
const folderId = process.env.YANDEX_CLOUD_FOLDER_ID;
if (!apiKey || !folderId) throw new Error('YandexGPT credentials are required for the live smoke test');

const messages = [
  'Сегодня травят тараканов',
  'Необходимо сдать деньги на ремонт',
  'Необходимо сдать 2500 на благоустройство двора',
  'Внимание: сегодня будет проведена санитарная обработка от насекомых',
  'Сегодня перекрывают лестницы',
  'Кто из жильцов может посидеть с ребенком',
  'Всем привет!',
  'Сбор денег на ремонт отменён',
].map((text, i) => ({ id: `smoke-${i}`, text, senderDisplayName: 'Тестовый житель', sentAt: new Date() }));
const client = new YandexGptClient({ apiKey, folderId,
  ...(process.env.YANDEXGPT_MODEL_URI ? { modelUri: process.env.YANDEXGPT_MODEL_URI } : {}),
  apiUrl: process.env.YANDEXGPT_API_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
  timeoutMs: 30000 });
const result = await client.summarize(prepareSummaryMessages(messages));
const covered = new Set(Object.values(result).flat().flatMap((item) => item.sourceMessageIds));
for (const message of messages.filter((item) => item.id !== 'smoke-6')) assert(covered.has(message.id), `Missing ${message.id}`);
assert(!covered.has('smoke-6'), 'Greeting was included');
assert(result.housing.some((item) => /(?:таракан|насеком|санитарн|дезинсекц)/iu.test(item.text)));
assert(result.yard.some((item) => /2500/.test(item.text)));
assert(Object.values(result).flat().some((item) => /отмен/iu.test(item.text)));
console.log(JSON.stringify({ status: 'passed', sourceCount: messages.length, categories: result }, null, 2));
