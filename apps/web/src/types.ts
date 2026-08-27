export type ChannelType = "TEXT" | "VOICE" | "ANNOUNCEMENT" | "FORUM" | "EVENT";
export type GuildRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";
export type SystemRole = "USER" | "DEVELOPER" | "PLATFORM_ADMIN";
export type AccountType = "HUMAN" | "BOT" | "WEBHOOK" | "SYSTEM";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  bio?: string;
  statusMessage?: string;
  email?: string;
  allowFriendRequests?: boolean;
  allowDirectMessages?: boolean;
  systemRole?: SystemRole;
  platformOwner?: boolean;
  accountType?: AccountType;
  createdAt?: string;
}

export interface GuildPermissions {
  canManageChannels: boolean;
  canManageMessages: boolean;
  canManageMembers: boolean;
  canManageServer: boolean;
  canManageRoles: boolean;
  canKickMembers: boolean;
  canMoveMembers: boolean;
  canMuteMembers: boolean;
  canDeafenMembers: boolean;
  canManageNicknames: boolean;
  canBanMembers: boolean;
  canViewAuditLog: boolean;
  canCreateInvites: boolean;
  canManageInvites: boolean;
  canManageWebhooks: boolean;
  canManageBots: boolean;
  canManageEvents: boolean;
  canManageForums: boolean;
  canManageAutoMod: boolean;
  canPinMessages: boolean;
  canScheduleMessages: boolean;
  canMentionEveryone: boolean;
  canShareScreen: boolean;
  canUseVideo: boolean;
}

export interface CustomRole {
  id: string;
  guildId: string;
  name: string;
  color: string;
  icon: string;
  description: string;
  position: number;
  permissions: string[];
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  createdAt?: string;
}

export interface ChannelCategory {
  id: string;
  guildId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Channel {
  id: string;
  guildId: string;
  categoryId: string | null;
  name: string;
  type: ChannelType;
  topic?: string;
  slowModeSeconds?: number;
  position: number;
  syncPermissionsWithCategory: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ChannelPermission {
  id?: string;
  channelId: string;
  role: "MODERATOR" | "MEMBER";
  canView: boolean;
  canSendMessages: boolean;
  canConnect: boolean;
}

export interface CategoryPermission {
  id?: string;
  categoryId: string;
  role: "MODERATOR" | "MEMBER";
  canView: boolean;
  canSendMessages: boolean;
  canConnect: boolean;
}

export interface GuildRolePermission extends GuildPermissions {
  id?: string;
  guildId?: string;
  role: "MODERATOR" | "MEMBER";
}

export interface CustomRolePermissionOverride {
  id?: string;
  roleId: string;
  canView: boolean | null;
  canSendMessages: boolean | null;
  canConnect: boolean | null;
}

export interface ManagedChannel extends Channel { permissions: ChannelPermission[]; customRolePermissions: CustomRolePermissionOverride[]; }
export interface ManagedCategory extends ChannelCategory { permissions: CategoryPermission[]; customRolePermissions: CustomRolePermissionOverride[]; }
export interface GuildStructure { categories: ManagedCategory[]; channels: ManagedChannel[]; rolePermissions: GuildRolePermission[]; customRoles: CustomRole[]; }

export interface Guild {
  id: string;
  name: string;
  iconColor: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  description?: string;
  welcomeMessage?: string;
  rules?: string;
  welcomeChannelId?: string | null;
  memberJoinMessagesEnabled?: boolean;
  memberLeaveMessagesEnabled?: boolean;
  memberSystemMessageChannelId?: string | null;
  afkEnabled?: boolean;
  afkChannelId?: string | null;
  afkTimeoutMinutes?: number;
  communityEnabled?: boolean;
  communityTags?: string[];
  communityCategory?: string;
  musicEnabled?: boolean;
  musicAllowMembers?: boolean;
  musicDefaultVolume?: number;
  musicDefaultVoiceChannelId?: string | null;
  ownerId: string;
  role: GuildRole;
  permissions: GuildPermissions;
  memberCount: number;
  categories: ChannelCategory[];
  channels: Channel[];
}

export type MusicProvider = "YOUTUBE" | "SOUNDCLOUD";
export type MusicPlaybackStatus = "IDLE" | "PLAYING" | "PAUSED";
export type MusicRepeatMode = "OFF" | "TRACK" | "QUEUE";

export interface MusicTrack {
  id: string;
  provider: MusicProvider;
  providerId: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  requestedBy: string;
  requestedByName: string;
  addedAt: string;
}

export interface MusicState {
  guildId: string;
  channelId: string | null;
  status: MusicPlaybackStatus;
  queue: MusicTrack[];
  history: MusicTrack[];
  current: MusicTrack | null;
  volume: number;
  repeat: MusicRepeatMode;
  shuffle: boolean;
  positionSeconds: number;
  serverNow: number;
  revision: number;
}

export interface MusicSettings {
  enabled: boolean;
  allowMembers: boolean;
  defaultVolume: number;
  defaultVoiceChannelId: string | null;
  youtubeSearchEnabled: boolean;
  soundcloudSearchEnabled: boolean;
  maxQueue: number;
  maxPlaylistItems: number;
}

export interface MusicPayload {
  settings: MusicSettings;
  state: MusicState;
}

export interface MusicSearchResult {
  provider: MusicProvider;
  providerId: string;
  title: string;
  author: string;
  thumbnailUrl: string | null;
  url: string;
}

export interface GuildBan {
  id: string; guildId: string; userId: string; bannedById: string; reason: string; expiresAt: string | null; createdAt: string; user: User; bannedBy: User;
}
export interface GuildAuditLog { id: string; guildId: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null; targetUserId: string | null; metadata: Record<string, unknown> | null; ipHash: string | null; createdAt: string; actor: User | null; targetUser?: User | null; }

export interface Attachment { id: string; originalName: string; mimeType: string; size: number; url: string; createdAt: string; }
export interface MessageReaction { emoji: string; userId: string; user?: Pick<User, "id" | "displayName">; }
export interface ChatMessage {
  id: string; channelId: string; authorId: string; content: string; createdAt: string; editedAt?: string | null; author: User; attachments: Attachment[];
  replyToId?: string | null; replyTo?: (Pick<ChatMessage, "id" | "content" | "authorId"> & { author: Pick<User, "id" | "displayName" | "username"> }) | null;
  reactions?: MessageReaction[]; isPinned?: boolean; pinnedAt?: string | null;
}
export interface DirectMessage { id: string; conversationId: string; authorId: string; content: string; replyToId?: string | null; createdAt: string; editedAt?: string | null; author: User; attachments: Attachment[]; }

export interface GuildMember { role: GuildRole; joinedAt: string; timeoutUntil?: string | null; timeoutReason?: string; nickname?: string; serverMuted?: boolean; serverDeafened?: boolean; user: User; customRoles?: CustomRole[]; }
export interface LiveKitCredentials { url: string; token: string; roomName: string; mediaPermissions?: { canShareScreen: boolean; canUseVideo: boolean }; serverVoiceState?: { muted: boolean; deafened: boolean }; }
export interface VoicePresenceUser { id: string; username: string; displayName: string; avatarColor: string; systemRole?: SystemRole; accountType?: AccountType; micMuted?: boolean; deafened?: boolean; serverMuted?: boolean; serverDeafened?: boolean; streaming?: boolean; }
export interface VoicePresencePayload { guildId: string; channels: Record<string, VoicePresenceUser[]>; revision?: number; }

export interface FriendEntry { id: string; user: User; since?: string; createdAt?: string; }
export interface FriendsPayload { friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[]; }
export interface FriendshipInfo { id: string; status: "PENDING" | "ACCEPTED"; direction: "OUTGOING" | "INCOMING"; }
export interface UserSearchResult extends User { friendship: FriendshipInfo | null; }
export interface DirectConversation { id: string; otherUser: User; lastMessage: DirectMessage | null; updatedAt: string; }
export interface NetworkInfo { appOrigins: string[]; livekitUrl: string; insecureAppOrigins?: string[]; secureTransport?: boolean; livekitSecure?: boolean; registrationOpen?: boolean; emailVerificationRequired?: boolean; legacyWebhookTokensEnabled?: boolean; version?: string; }
export interface UserProfilePayload { profile: User & { createdAt: string }; friendship: FriendshipInfo | null; sharedGuilds: Array<{ id: string; name: string; iconColor: string }>; guildMembership: null | { role: GuildRole; joinedAt: string }; block: null | { blockedByViewer: boolean; blockedViewer: boolean }; }
export interface InviteSummary { code: string; expiresAt: string | null; maxUses: number | null; uses: number; createdAt: string; createdBy: User; }

export interface PlatformAnnouncement { id: string; title: string; body: string; severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL" | string; published: boolean; createdAt: string; updatedAt: string; createdBy?: User; }
export interface DeveloperApplication { id: string; clientId: string; ownerId: string; name: string; description: string; iconColor: string; publicBot: boolean; messageContentIntent?: boolean; runtime?: "PYTHON"; sdk?: string; botUserId: string | null; tokenPrefix: string | null; installCount?: number; botUser?: User | null; commands?: ApplicationCommand[]; createdAt: string; updatedAt: string; }
export interface ApplicationCommand { id: string; applicationId: string; name: string; description: string; createdAt?: string; updatedAt?: string; }
export interface WebhookItem { id: string; guildId: string; channelId: string; userId: string; name: string; tokenPrefix: string; enabled: boolean; createdAt: string; channel?: Pick<Channel, "id" | "name" | "type">; }

export interface ForumTag { id: string; name: string; color: string; }
export interface ForumPost { id: string; title: string; content: string; status: "OPEN" | "CLOSED"; pinned: boolean; createdAt: string; updatedAt: string; lastActivityAt?: string; author: User; tags: ForumTag[]; _count?: { comments: number }; commentCount?: number; }
export interface GuildEvent { id: string; guildId: string; channelId?: string | null; title: string; description: string; location: string; startsAt: string; endsAt?: string | null; capacity?: number | null; createdAt: string; creator: User; rsvps?: Array<{ status: "INTERESTED" | "GOING" | "NOT_GOING"; user: User }>; _count?: { rsvps: number }; }

export interface GuildTemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: "basic" | "company" | "community" | "support" | "developer" | "study" | "gaming";
  accent: string;
  categoryCount: number;
  channelCount: number;
  roleCount: number;
}

export interface CommunityGuild { id: string; name: string; iconColor: string; iconUrl?: string | null; bannerUrl?: string | null; description: string; rules?: string; communityTags: string[]; communityCategory: string; memberCount: number; onlineCount: number; joined: boolean; }
