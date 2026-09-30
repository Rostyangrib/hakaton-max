import { describe, expect, it, vi } from 'vitest';

import { YandexGptClient } from './yandex-gpt.js';

function response(categories: unknown, status = 'ALTERNATIVE_STATUS_FINAL') {
  return new Response(JSON.stringify({
    alternatives: [{ status, message: { text: JSON.stringify(categories) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const empty = { housing: [], yard: [], community: [] };

describe('YandexGptClient', () => {
  it('preserves a mapped event omitted by reduce even without fallback keywords', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...empty,
      community: [{ text: 'Завтра придёт председатель', sourceMessageIds: ['1'] }],
    })).mockResolvedValueOnce(response(empty)).mockResolvedValueOnce(response(empty));
    const client = new YandexGptClient({ apiKey: 'test', folderId: 'test', apiUrl: 'https://example.test', timeoutMs: 1000 }, fetchMock);
    const result = await client.summarize(Array.from({ length: 76 }, (_, i) => ({ id: `event-${i}`, senderDisplayName: 'Житель',
      text: i === 0 ? 'Завтра придёт председатель' : 'Привет', sentAt: now() })));
    expect(result.community).toEqual([{ text: 'Завтра придёт председатель', sourceMessageIds: ['event-0'] }]);
  });

  it.each([2, 76, 151])('recovers omitted announcements from %i messages after map/reduce', async (count) => {
    const fetchMock = vi.fn(async () => response(empty));
    const client = new YandexGptClient({ apiKey: 'test', folderId: 'test', apiUrl: 'https://example.test', timeoutMs: 1000 }, fetchMock);
    const messages = Array.from({ length: count }, (_, i) => ({ id: `event-${i}`, senderDisplayName: 'Житель',
      text: i === count - 1 ? 'Сегодня травят тараканов' : `Необходимо сдать ${500 + i} рублей на ремонт`, sentAt: now() }));
    const result = await client.summarize(messages);
    expect(result.housing).toHaveLength(count);
    expect(new Set(result.housing.flatMap((item) => item.sourceMessageIds))).toEqual(new Set(messages.map((item) => item.id)));
  });

  it('uses map-reduce for more than one chunk and requests structured JSON', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response(empty));
    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);
    const messages = Array.from({ length: 76 }, (_, index) => ({
      id: `m${index}`, senderDisplayName: 'Житель', text: `Сообщение ${index}`, sentAt: new Date(),
    }));
    await expect(client.summarize(messages)).resolves.toEqual(empty);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.jsonSchema.schema.required).toEqual(['housing', 'yard', 'community']);
    expect(request?.headers).toMatchObject({ Authorization: 'Api-Key test-key', 'x-folder-id': 'test-folder' });
  });

  it('rejects hallucinated source ids', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response({
      housing: [{ text: 'Выдуманный факт', sourceMessageIds: ['unknown'] }], yard: [], community: [],
    }));
    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);
    await expect(client.summarize([{ id: 'm1', senderDisplayName: 'Анна', text: 'Лифт сломан', sentAt: now() }]))
      .rejects.toThrow('unknown source');
  });

  it('accepts the legacy result wrapper as well as the current root response', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      result: { alternatives: [{ status: 'ALTERNATIVE_STATUS_FINAL', message: { text: JSON.stringify(empty) } }] },
    }), { status: 200 }));
    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);
    await expect(client.summarize([{ id: 'm1', senderDisplayName: 'Анна', text: 'Привет', sentAt: now() }]))
      .resolves.toEqual(empty);
  });

  it('correctly parses JSON wrapped in markdown code blocks and with truncated status', async () => {
    const markdownWrapped = `\`\`\`json\n${JSON.stringify({
      housing: [{ text: 'Лифт починен', sourceMessageIds: ['m1'] }],
      yard: [],
      community: [],
    })}\n\`\`\``;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      alternatives: [{ status: 'ALTERNATIVE_STATUS_TRUNCATED_FINAL', message: { text: markdownWrapped } }],
    }), { status: 200 }));
    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);
    const result = await client.summarize([{ id: 'm1', senderDisplayName: 'Анна', text: 'Лифт сломан', sentAt: now() }]);
    expect(result.housing).toHaveLength(1);
    expect(result.housing[0]?.text).toBe('Лифт починен');
  });

  it('retries on transient 503 error and succeeds on subsequent try', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response('Service Unavailable', { status: 503 });
      }
      return response({
        housing: [{ text: 'Лифт починен', sourceMessageIds: ['m1'] }],
        yard: [],
        community: [],
      });
    });

    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);

    const result = await client.summarize([{ id: 'm1', senderDisplayName: 'Анна', text: 'Лифт сломан', sentAt: now() }]);
    expect(callCount).toBe(2);
    expect(result.housing).toHaveLength(1);
    expect(result.housing[0]?.text).toBe('Лифт починен');
  });

  it('falls back to programmatic merge when reduce step encounters an error', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount += 1;
      // Chunks 1 and 2 succeed
      if (callCount === 1) {
        return response({
          housing: [{ text: 'Протечка в подвале', sourceMessageIds: ['m0'] }],
          yard: [],
          community: [],
        });
      }
      if (callCount === 2) {
        return response({
          housing: [],
          yard: [{ text: 'Красный вольво на газоне', sourceMessageIds: ['m75'] }],
          community: [],
        });
      }
      // Reduce call fails with 400
      return new Response('Bad Request', { status: 400 });
    });

    const client = new YandexGptClient({
      apiKey: 'test-key', folderId: 'test-folder', apiUrl: 'https://example.test/completion', timeoutMs: 1_000,
    }, fetchMock);

    const messages = Array.from({ length: 76 }, (_, index) => ({
      id: `m${index}`, senderDisplayName: 'Житель', text: `Сообщение ${index}`, sentAt: now(),
    }));

    const result = await client.summarize(messages);
    expect(result.housing).toHaveLength(1);
    expect(result.housing[0]?.text).toBe('Протечка в подвале');
    expect(result.yard).toHaveLength(1);
    expect(result.yard[0]?.text).toBe('Красный вольво на газоне');
  });
});

function now() {
  return new Date('2026-09-21T04:00:00.000Z');
}
