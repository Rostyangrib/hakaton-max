import type { MaxUpdate } from '@quiet-chat/shared';
import { describe, expect, it, vi } from 'vitest';

import { MessagePipeline, type AlertProfile, type MessageRepository, type StoredMessage } from './message-pipeline.js';

function createdUpdate(text: string, chatId = 777): MaxUpdate {
  return {
    update_type: 'message_created',
    timestamp: 1_700_000_000_000,
    message: {
      sender: { user_id: 10, first_name: 'Иван', last_name: 'Петров' },
      recipient: { chat_id: chatId, chat_type: 'chat' },
      timestamp: 1_700_000_000_000,
      body: { mid: 'mid-1', text },
    },
  };
}

function repository(reservation = true) {
  const stored: StoredMessage = {
    id: 'message-uuid',
    homeId: 'home-uuid',
    maxMessageId: 'mid-1',
    chatId: 777,
    chatType: 'chat',
    senderUserId: 10,
    senderDisplayName: 'Иван Петров',
    text: 'Хозяин кв. 54, у вас течёт труба',
    sentAt: new Date('2023-11-14T22:13:20.000Z'),
  };
  return {
    ensureHome: vi.fn(async (_chatId: bigint) => 'home-uuid'),
    getHomeTitle: vi.fn(async (_homeId: string) => null as string | null),
    upsertCreated: vi.fn(async (home, message) => ({ ...stored, ...message, homeId: home })),
    updateEdited: vi.fn(async (home, message) => ({ ...stored, ...message, homeId: home })),
    markDeleted: vi.fn(async () => true),
    findAlertProfiles: vi.fn(async (): Promise<AlertProfile[]> => [{
      id: 'profile-uuid',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      carDescription: 'Белая Toyota Camry',
    }]),
    reserveDelivery: vi.fn(async () => reservation ? { id: 'delivery-uuid' } : null),
    markDeliveryDone: vi.fn(async () => {}),
    markDeliveryFailed: vi.fn(async () => {}),
  } satisfies MessageRepository;
}

describe('message pipeline', () => {
  it('stores a group message and sends a matching alert only to a user', async () => {
    const repo = repository();
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    expect(await pipeline.handle(createdUpdate('Хозяин кв. 54, у вас течёт труба'))).toBe(true);
    expect(repo.upsertCreated).toHaveBeenCalledOnce();
    expect(repo.reserveDelivery).toHaveBeenCalledWith(expect.objectContaining({ antifloodMinutes: 15 }));
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('квартира 54'));
    expect(repo.markDeliveryDone).toHaveBeenCalledOnce();
  });

  it('delivers alert to resident even when the sender is the resident themselves (e.g. testing apartment mentions)', async () => {
    const repo = repository();
    repo.findAlertProfiles = vi.fn(async () => [{
      id: 'profile-uuid',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: null,
      carDescription: null,
    }]);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    const updateFromSameUser: MaxUpdate = {
      update_type: 'message_created',
      timestamp: 1_700_000_000_000,
      message: {
        sender: { user_id: 42, first_name: 'Ростислав' },
        recipient: { chat_id: 777, chat_type: 'chat' },
        timestamp: 1_700_000_000_000,
        body: { mid: 'mid-self', text: 'Квартира 54, у вас, кажется, тамбурная дверь приоткрыта, проверьте, пожалуйста.' },
      },
    };

    expect(await pipeline.handle(updateFromSameUser)).toBe(true);
    expect(repo.findAlertProfiles).toHaveBeenCalledWith('home-uuid', 42n);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('квартира 54'));
  });

  it('does not ingest messages from another chat', async () => {
    const repo = repository();
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);
    expect(await pipeline.handle(createdUpdate('кв. 54', 999))).toBe(false);
    expect(repo.upsertCreated).not.toHaveBeenCalled();
    expect(privateApi.sendMessageToUser).not.toHaveBeenCalled();
  });

  it('suppresses delivery when repository rejects it as duplicate or flood', async () => {
    const repo = repository(false);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    await new MessagePipeline(repo, privateApi, 777, 15).handle(createdUpdate('кв. 54'));
    expect(privateApi.sendMessageToUser).not.toHaveBeenCalled();
  });

  it('sends at most one personal alert per profile for one message', async () => {
    const repo = repository();
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    await new MessagePipeline(repo, privateApi, 777, 15).handle(
      createdUpdate('В квартире 54 третьего подъезда проблема. А123ВС77 мешает проезду.'),
    );
    expect(privateApi.sendMessageToUser).toHaveBeenCalledOnce();
  });

  it('updates edited messages and marks removed messages', async () => {
    const repo = repository(false);
    const pipeline = new MessagePipeline(repo, { sendMessageToUser: vi.fn(async () => ({})) }, 777, 15);
    const edited = { ...createdUpdate('кв. 54'), update_type: 'message_edited' as const };
    await pipeline.handle(edited);
    expect(repo.updateEdited).toHaveBeenCalledOnce();

    await pipeline.handle({ update_type: 'message_removed', timestamp: 1_700_000_100_000, chat_id: 777, message_id: 'mid-1' });
    expect(repo.markDeleted).toHaveBeenCalledWith('home-uuid', 'mid-1', expect.any(Date));
  });

  it('marks a failed personal delivery and lets the event retry', async () => {
    const repo = repository();
    const privateApi = { sendMessageToUser: vi.fn(async () => { throw new Error('MAX unavailable'); }) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);
    await expect(pipeline.handle(createdUpdate('кв. 54'))).rejects.toThrow('MAX unavailable');
    expect(repo.markDeliveryFailed).toHaveBeenCalledWith('delivery-uuid', 'MAX unavailable');
  });

  it('accepts sender with id instead of user_id and username fallback', async () => {
    const repo = repository();
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);
    const updateWithId: MaxUpdate = {
      update_type: 'message_created',
      timestamp: 1_700_000_000_000,
      message: {
        sender: { id: 215608884, username: 'testuser' },
        recipient: { chat_id: 777, chat_type: 'chat' },
        timestamp: 1_700_000_000_000,
        body: { mid: 'mid-2', text: 'кв. 54' },
      },
    };
    expect(await pipeline.handle(updateWithId)).toBe(true);
    expect(repo.upsertCreated).toHaveBeenCalledWith(
      'home-uuid',
      expect.objectContaining({ senderUserId: 215608884, senderDisplayName: 'testuser' }),
      expect.any(String),
      expect.any(String),
    );
  });

  it('delivers alert to resident for their secondary apartment', async () => {
    const repo = repository();
    repo.findAlertProfiles = vi.fn(async () => [{
      id: 'profile-multi',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      carDescription: 'Белая Toyota Camry',
      properties: [
        { apartment: 54, entrance: 3 },
        { apartment: 102, entrance: 5 },
      ],
    }]);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    expect(await pipeline.handle(createdUpdate('Квартира 102, закройте окно, дождь заливает'))).toBe(true);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('квартира 102'));
  });

  it('delivers alert to resident for their secondary vehicle', async () => {
    const repo = repository();
    repo.findAlertProfiles = vi.fn(async () => [{
      id: 'profile-multi-car',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      carDescription: 'Белая Toyota Camry',
      vehicles: [
        { plateNormalized: 'А123ВС77', description: 'Белая Toyota Camry' },
        { plateNormalized: 'В456ОР77', description: 'Черный Haval' },
      ],
    }]);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    expect(await pipeline.handle(createdUpdate('Черный Haval перекрыл выезд со двора'))).toBe(true);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('Черный Haval'));
  });

  it('delivers alert when plate in chat has no region or different case/spaces', async () => {
    const repo = repository();
    repo.findAlertProfiles = vi.fn(async () => [{
      id: 'profile-plate',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      carDescription: null,
    }]);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    expect(await pipeline.handle(createdUpdate('Чья а 123 вс во дворе?'))).toBe(true);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('А123ВС'));
  });

  it('delivers alert when plate has rus suffix and when car brand has Russian case ending', async () => {
    const repo = repository();
    repo.findAlertProfiles = vi.fn(async () => [{
      id: 'profile-multi-cars',
      maxUserId: 42n,
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      carDescription: 'Mazda CX-5',
      vehicles: [
        { plateNormalized: 'А123ВС77', description: 'Mazda CX-5' },
      ],
    }]);
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const pipeline = new MessagePipeline(repo, privateApi, 777, 15);

    // Suffix rus in plate
    expect(await pipeline.handle(createdUpdate('Чья а123вс77rus во дворе?'))).toBe(true);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('А123ВС77'));

    privateApi.sendMessageToUser.mockClear();

    // Russian case ending: Кто-то поцарапал мазду
    expect(await pipeline.handle(createdUpdate('Кто-то поцарапал мазду во дворе'))).toBe(true);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('Mazda CX-5'));
  });

  it('routes messages from multiple distinct group chats to their respective homes when homeChatId is null', async () => {
    const repo = repository();
    repo.ensureHome = vi.fn(async (chatId: bigint) => `home-uuid-${chatId}`);
    repo.getHomeTitle = vi.fn(async (homeId: string) => (homeId === 'home-uuid-1001' ? 'Дом 1' : 'Дом 2'));
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    // homeChatId is null -> multichat mode
    const multichatPipeline = new MessagePipeline(repo, privateApi, null, 0);

    // Message from chat 1001
    expect(await multichatPipeline.handle(createdUpdate('Хозяин кв. 54', 1001))).toBe(true);
    expect(repo.ensureHome).toHaveBeenCalledWith(1001n);
    expect(repo.upsertCreated).toHaveBeenCalledWith('home-uuid-1001', expect.anything(), expect.anything(), expect.anything());
    expect(repo.findAlertProfiles).toHaveBeenCalledWith('home-uuid-1001', 10n);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('🔔 В домовом чате «Дом 1» упомянули: квартира 54.'));

    privateApi.sendMessageToUser.mockClear();

    // Message from chat 2002
    expect(await multichatPipeline.handle(createdUpdate('Хозяин кв. 54', 2002))).toBe(true);
    expect(repo.ensureHome).toHaveBeenCalledWith(2002n);
    expect(repo.upsertCreated).toHaveBeenCalledWith('home-uuid-2002', expect.anything(), expect.anything(), expect.anything());
    expect(repo.findAlertProfiles).toHaveBeenCalledWith('home-uuid-2002', 10n);
    expect(privateApi.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('🔔 В домовом чате «Дом 2» упомянули: квартира 54.'));
  });

  it('suppresses alert delivery and revokes membership when membershipChecker reports resident has left the chat', async () => {
    const revokeMembership = vi.fn(async () => {});
    const repo = {
      ...repository(),
      revokeMembership,
    };
    const privateApi = { sendMessageToUser: vi.fn(async () => ({})) };
    const membershipChecker = { isMember: vi.fn(async () => false) };
    const pipeline = new MessagePipeline(repo, privateApi, null, 15, membershipChecker);

    expect(await pipeline.handle(createdUpdate('Хозяин кв. 54, труба течет', 777))).toBe(true);
    expect(membershipChecker.isMember).toHaveBeenCalledWith(777, 42);
    expect(revokeMembership).toHaveBeenCalledWith('home-uuid', 42n);
    expect(privateApi.sendMessageToUser).not.toHaveBeenCalled();
    expect(repo.reserveDelivery).not.toHaveBeenCalled();
  });
});
