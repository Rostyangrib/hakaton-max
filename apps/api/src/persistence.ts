import { and, eq } from 'drizzle-orm';

import type { createDatabase } from '@quiet-chat/database';
import { homes, residentProfiles, users, webhookEvents } from '@quiet-chat/database';
import { normalizeCarPlate, type MaxUpdate, type MaxUser } from '@quiet-chat/shared';

import type { ProfileStore, WebhookInbox } from './contracts.js';

type Database = ReturnType<typeof createDatabase>['db'];

function displayName(user: MaxUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Жилец';
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
    if (!profile) return null;

    const properties = profile.properties && profile.properties.length > 0
      ? profile.properties
      : [{
          apartment: profile.apartment,
          entrance: profile.entrance,
          floor: profile.floor,
        }];

    const vehicles = profile.vehicles && profile.vehicles.length > 0
      ? profile.vehicles
      : (profile.carPlateRaw || profile.carDescription
        ? [{
            plate: profile.carPlateRaw,
            plateNormalized: profile.carPlateNormalized,
            description: profile.carDescription,
          }]
        : []);

    return {
      apartment: profile.apartment,
      entrance: profile.entrance,
      floor: profile.floor,
      carPlate: profile.carPlateRaw,
      carDescription: profile.carDescription,
      properties,
      vehicles,
      alertsEnabled: profile.alertsEnabled,
      membershipVerifiedAt: profile.membershipVerifiedAt ? profile.membershipVerifiedAt.toISOString() : null,
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

      const properties = input.properties && input.properties.length > 0
        ? input.properties.map((p) => ({
            id: p.id,
            title: p.title,
            chatId: p.chatId,
            apartment: p.apartment,
            entrance: p.entrance,
            floor: p.floor ?? null,
          }))
        : [{
            apartment: input.apartment,
            entrance: input.entrance,
            floor: input.floor ?? null,
          }];

      const primaryApartment = properties[0]?.apartment ?? input.apartment;
      const primaryEntrance = properties[0]?.entrance ?? input.entrance;
      const primaryFloor = properties[0]?.floor ?? input.floor ?? null;

      const vehicles = input.vehicles && input.vehicles.length > 0
        ? input.vehicles.map((v) => ({
            id: v.id,
            plate: cleanNullable(v.plate),
            plateNormalized: cleanNullable(v.plate) ? normalizeCarPlate(v.plate!) : null,
            description: cleanNullable(v.description),
          }))
        : (cleanNullable(input.carPlate) || cleanNullable(input.carDescription)
          ? [{
              plate: cleanNullable(input.carPlate),
              plateNormalized: cleanNullable(input.carPlate) ? normalizeCarPlate(input.carPlate!) : null,
              description: cleanNullable(input.carDescription),
            }]
          : []);

      const primaryCarPlate = vehicles.find((v) => v.plate)?.plate ?? cleanNullable(input.carPlate);
      const primaryCarPlateNormalized = vehicles.find((v) => v.plateNormalized)?.plateNormalized ?? (primaryCarPlate ? normalizeCarPlate(primaryCarPlate) : null);
      const primaryCarDescription = vehicles.find((v) => v.description)?.description ?? cleanNullable(input.carDescription);

      const values = {
        homeId,
        maxUserId,
        apartment: primaryApartment,
        entrance: primaryEntrance,
        floor: primaryFloor,
        carPlateRaw: primaryCarPlate,
        carPlateNormalized: primaryCarPlateNormalized,
        carDescription: primaryCarDescription,
        properties,
        vehicles,
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
    async getUser(maxUserId) {
      const [user] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.maxUserId, maxUserId))
        .limit(1);
      return user ?? null;
    },
    async getHome(maxChatId) {
      const [home] = await db
        .select({ title: homes.title, chatUrl: homes.chatUrl })
        .from(homes)
        .where(eq(homes.maxChatId, maxChatId))
        .limit(1);
      return home ?? null;
    },
    async getActiveHomes() {
      return db
        .select({ maxChatId: homes.maxChatId, title: homes.title, chatUrl: homes.chatUrl })
        .from(homes)
        .where(eq(homes.isActive, true));
    },
    async verifyMembership(maxUserId, maxChatId) {
      const homeId = await findHomeId(maxChatId);
      if (!homeId) return;
      await db
        .update(residentProfiles)
        .set({ membershipVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(residentProfiles.maxUserId, maxUserId), eq(residentProfiles.homeId, homeId)));
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
