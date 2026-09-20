import { describe, expect, it, vi } from 'vitest';

import { YandexGptClient } from './yandex-gpt.js';

function response(categories: unknown, status = 'ALTERNATIVE_STATUS_FINAL') {
  return new Response(JSON.stringify({
    alternatives: [{ status, message: { text: JSON.stringify(categories) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const empty = { housing: [], yard: [], community: [] };

describe('YandexGptClient', () => {
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
    await expect(client.summarize([{ id: 'm1', senderDisplayName: 'Анна', text: 'Лифт сломан', sentAt: now() }]))
      .resolves.toEqual(empty);
  });
});

function now() {
  return new Date('2026-09-21T04:00:00.000Z');
}
