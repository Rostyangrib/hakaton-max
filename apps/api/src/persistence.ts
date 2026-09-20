import { and, eq } from 'drizzle-orm';

import type { createDatabase } from '@quiet-chat/database';
import { homes, residentProfiles, users, webhookEvents } from '@quiet-chat/database';
import { normalizeCarPlate, type MaxUpdate, type MaxUser } from '@quiet-chat/shared';

import type { ProfileStore, WebhookInbox } from './contracts.js';

type Database = ReturnType<typeof createDatabase>['db'];

function displayName(user: MaxUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ');
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function createPersistence(db: Database): ProfileStore & WebhookInbox {
  async function findHomeId(maxChatId: bigint): Promise<string | null> {
    const [home] = await db.select({ id: homes.id }).from(homes).where(eq(homes.maxChatId, maxChatId)).limit(1);
    return home?.id ?? null;
  }

  async function ensureHome(maxChatId: bigint): Promise<string> {
    await db.insert(homes).values({ maxChatId, title: 'Тестовый дом' }).onConflictDoNothing();
    const homeId = await findHomeId(maxChatId);
    if (!homeId) throw new Error('Unable to create home');
    return homeId;
  }

  async function readProfile(maxUserId: bigint, homeId: string) {
    const [profile] = await db
      .select()
      .from(residentProfiles)
      .where(and(eq(residentProfiles.maxUserId, maxUserId), eq(residentProfiles.homeId, homeId)))
      .limit(1);
    if (!profile || !profile.membershipVerifiedAt) return null;
    return {
      apartment: profile.apartment,
      entrance: profile.entrance,
      floor: profile.floor,
      carPlate: profile.carPlateRaw,
      carDescription: profile.carDescription,
      alertsEnabled: profile.alertsEnabled,
      membershipVerifiedAt: profile.membershipVerifiedAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  return {
    async upsertUser(user) {
      const maxUserId = BigInt(user.user_id);
      await db
        .insert(users)
        .values({ maxUserId, displayName: displayName(user) })
        .onConflictDoUpdate({
          target: users.maxUserId,
          set: { displayName: displayName(user), updatedAt: new Date() },
        });
    },
    async getProfile(maxUserId, maxChatId) {
      const homeId = await findHomeId(maxChatId);
      return homeId ? readProfile(maxUserId, homeId) : null;
    },
    async saveProfile(maxUserId, maxChatId, input, verifiedAt) {
      const homeId = await ensureHome(maxChatId);
      const values = {
        homeId,
        maxUserId,
        apartment: input.apartment,
        entrance: input.entrance,
        floor: input.floor ?? null,
        carPlateRaw: cleanNullable(input.carPlate),
        carPlateNormalized: cleanNullable(input.carPlate) ? normalizeCarPlate(input.carPlate!) : null,
        carDescription: cleanNullable(input.carDescription),
        alertsEnabled: input.alertsEnabled,
        membershipVerifiedAt: verifiedAt,
        updatedAt: new Date(),
      };
      await db.insert(residentProfiles).values(values).onConflictDoUpdate({
        target: [residentProfiles.homeId, residentProfiles.maxUserId],
        set: values,
      });
      const profile = await readProfile(maxUserId, homeId);
      if (!profile) throw new Error('Unable to save profile');
      return profile;
    },
    async deleteProfile(maxUserId, maxChatId) {
      const homeId = await findHomeId(maxChatId);
      if (!homeId) return false;
      const deleted = await db
        .delete(residentProfiles)
        .where(and(eq(residentProfiles.maxUserId, maxUserId), eq(residentProfiles.homeId, homeId)))
        .returning({ id: residentProfiles.id });
      return deleted.length > 0;
    },
    async enqueue(eventKey: string, update: MaxUpdate) {
      const inserted = await db
        .insert(webhookEvents)
        .values({ eventKey, eventType: update.update_type, payload: update })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      return inserted.length > 0;
    },
  };
}
