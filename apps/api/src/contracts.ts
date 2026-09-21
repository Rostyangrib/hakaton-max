import type { MaxUpdate, MaxUser, ResidentProfile, ResidentProfileInput } from '@quiet-chat/shared';

export interface ProfileStore {
  upsertUser(user: MaxUser): Promise<void>;
  getProfile(maxUserId: bigint, maxChatId: bigint): Promise<ResidentProfile | null>;
  saveProfile(
    maxUserId: bigint,
    maxChatId: bigint,
    input: ResidentProfileInput,
    verifiedAt: Date,
  ): Promise<ResidentProfile>;
  deleteProfile(maxUserId: bigint, maxChatId: bigint): Promise<boolean>;
  getUser?(maxUserId: bigint): Promise<{ displayName: string | null } | null>;
}

export interface WebhookInbox {
  enqueue(eventKey: string, update: MaxUpdate): Promise<boolean>;
}

export interface MembershipService {
  isMember(maxChatId: number, maxUserId: number): Promise<boolean>;
}

export interface ApiServices {
  profiles: ProfileStore;
  webhookInbox: WebhookInbox;
  membership: MembershipService;
}
