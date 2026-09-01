import { prisma } from "./db.js";

let ready: Promise<void> | null = null;

async function init() {
  const sql = [
`CREATE TABLE IF NOT EXISTS "GingaMessageEditHistory" (id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES "Message"(id) ON DELETE CASCADE,editor_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,previous_content TEXT NOT NULL,edited_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS "GingaMessageEditHistory_message_idx" ON "GingaMessageEditHistory"(message_id,edited_at DESC)`,
`CREATE TABLE IF NOT EXISTS "GingaDraft" (user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,channel_id TEXT NOT NULL REFERENCES "Channel"(id) ON DELETE CASCADE,content TEXT NOT NULL DEFAULT '',updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,channel_id))`,
`CREATE TABLE IF NOT EXISTS "GingaGuildEmoji" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(32) NOT NULL,mime VARCHAR(40) NOT NULL,asset BYTEA NOT NULL,etag VARCHAR(64) NOT NULL,animated BOOLEAN NOT NULL DEFAULT FALSE,created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE UNIQUE INDEX IF NOT EXISTS "GingaGuildEmoji_guild_name_key" ON "GingaGuildEmoji"(guild_id,LOWER(name))`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSticker" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(40) NOT NULL,description VARCHAR(120) NOT NULL DEFAULT '',emoji VARCHAR(16) NOT NULL DEFAULT '',mime VARCHAR(40) NOT NULL,asset BYTEA NOT NULL,etag VARCHAR(64) NOT NULL,animated BOOLEAN NOT NULL DEFAULT FALSE,created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE UNIQUE INDEX IF NOT EXISTS "GingaGuildSticker_guild_name_key" ON "GingaGuildSticker"(guild_id,LOWER(name))`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSoundboardSound" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(40) NOT NULL,emoji VARCHAR(16) NOT NULL DEFAULT '🔊',mime VARCHAR(40) NOT NULL,asset BYTEA NOT NULL,etag VARCHAR(64) NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0,source_duration_ms INTEGER NOT NULL DEFAULT 0,trim_start_ms INTEGER NOT NULL DEFAULT 0,trim_end_ms INTEGER NOT NULL DEFAULT 0,created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`ALTER TABLE "GingaGuildSoundboardSound" ADD COLUMN IF NOT EXISTS source_duration_ms INTEGER NOT NULL DEFAULT 0`,
`ALTER TABLE "GingaGuildSoundboardSound" ADD COLUMN IF NOT EXISTS trim_start_ms INTEGER NOT NULL DEFAULT 0`,
`ALTER TABLE "GingaGuildSoundboardSound" ADD COLUMN IF NOT EXISTS trim_end_ms INTEGER NOT NULL DEFAULT 0`,
`CREATE UNIQUE INDEX IF NOT EXISTS "GingaGuildSoundboardSound_guild_name_key" ON "GingaGuildSoundboardSound"(guild_id,LOWER(name))`,
`CREATE INDEX IF NOT EXISTS "GingaGuildSoundboardSound_guild_created_idx" ON "GingaGuildSoundboardSound"(guild_id,created_at)`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSpace" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(48) NOT NULL,description VARCHAR(160) NOT NULL DEFAULT '',icon VARCHAR(16) NOT NULL DEFAULT '',color VARCHAR(7) NOT NULL DEFAULT '#7c3cff',position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSpaceCategory" (space_id TEXT NOT NULL REFERENCES "GingaGuildSpace"(id) ON DELETE CASCADE,category_id TEXT NOT NULL REFERENCES "ChannelCategory"(id) ON DELETE CASCADE,PRIMARY KEY(space_id,category_id))`,
`CREATE UNIQUE INDEX IF NOT EXISTS "GingaGuildSpaceCategory_category_key" ON "GingaGuildSpaceCategory"(category_id)`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSpaceChannel" (space_id TEXT NOT NULL REFERENCES "GingaGuildSpace"(id) ON DELETE CASCADE,channel_id TEXT NOT NULL REFERENCES "Channel"(id) ON DELETE CASCADE,PRIMARY KEY(space_id,channel_id))`,
`CREATE UNIQUE INDEX IF NOT EXISTS "GingaGuildSpaceChannel_channel_key" ON "GingaGuildSpaceChannel"(channel_id)`,
`CREATE TABLE IF NOT EXISTS "GingaChannelPreference" (user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,channel_id TEXT NOT NULL REFERENCES "Channel"(id) ON DELETE CASCADE,favorite BOOLEAN NOT NULL DEFAULT FALSE,hidden BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,channel_id))`,
`CREATE TABLE IF NOT EXISTS "GingaGuildMemberProfile" (guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,bio VARCHAR(280),pronouns VARCHAR(40),accent_color VARCHAR(7) NOT NULL DEFAULT '#7c3cff',secondary_color VARCHAR(7) NOT NULL DEFAULT '#2c74ff',profile_theme VARCHAR(16) NOT NULL DEFAULT 'AURORA',links JSONB NOT NULL DEFAULT '[]'::jsonb,avatar_asset BYTEA,avatar_mime VARCHAR(40),avatar_etag VARCHAR(64),banner_asset BYTEA,banner_mime VARCHAR(40),banner_etag VARCHAR(64),badge_text VARCHAR(24),updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(guild_id,user_id))`,
`CREATE TABLE IF NOT EXISTS "GingaUserSocialProfile" (user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,birthday DATE,avatar_decoration VARCHAR(24) NOT NULL DEFAULT 'NONE',profile_badge VARCHAR(24),status_expires_at TIMESTAMP(3),reduced_motion BOOLEAN NOT NULL DEFAULT FALSE,compact_profile BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaUserNote" (owner_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,target_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,note VARCHAR(1000) NOT NULL DEFAULT '',updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(owner_user_id,target_user_id))`,
`CREATE TABLE IF NOT EXISTS "GingaOnboardingQuestion" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,title VARCHAR(120) NOT NULL,description VARCHAR(240) NOT NULL DEFAULT '',multiple BOOLEAN NOT NULL DEFAULT FALSE,required BOOLEAN NOT NULL DEFAULT TRUE,enabled BOOLEAN NOT NULL DEFAULT TRUE,position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaOnboardingOption" (id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES "GingaOnboardingQuestion"(id) ON DELETE CASCADE,label VARCHAR(80) NOT NULL,description VARCHAR(160) NOT NULL DEFAULT '',emoji VARCHAR(16) NOT NULL DEFAULT '',role_id TEXT REFERENCES "GuildCustomRole"(id) ON DELETE SET NULL,channel_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaOnboardingProgress" (guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,answers JSONB NOT NULL DEFAULT '{}'::jsonb,completed_at TIMESTAMP(3),updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(guild_id,user_id))`,
`CREATE TABLE IF NOT EXISTS "GingaOnboardingRoleGrant" (guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,role_id TEXT NOT NULL REFERENCES "GuildCustomRole"(id) ON DELETE CASCADE,granted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(guild_id,user_id,role_id))`,
`CREATE TABLE IF NOT EXISTS "GingaGuildSecurityPolicy" (guild_id TEXT PRIMARY KEY REFERENCES "Guild"(id) ON DELETE CASCADE,anti_raid_enabled BOOLEAN NOT NULL DEFAULT FALSE,join_window_seconds INTEGER NOT NULL DEFAULT 30,join_limit INTEGER NOT NULL DEFAULT 8,quarantine_enabled BOOLEAN NOT NULL DEFAULT FALSE,quarantine_minutes INTEGER NOT NULL DEFAULT 10,new_account_hours INTEGER NOT NULL DEFAULT 24,block_external_links BOOLEAN NOT NULL DEFAULT FALSE,block_invites BOOLEAN NOT NULL DEFAULT FALSE,max_mentions INTEGER NOT NULL DEFAULT 8,duplicate_limit INTEGER NOT NULL DEFAULT 5,require_moderation_reason BOOLEAN NOT NULL DEFAULT FALSE,auto_timeout_minutes INTEGER NOT NULL DEFAULT 0,mod_log_channel_id TEXT REFERENCES "Channel"(id) ON DELETE SET NULL,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaDynamicVoiceTemplate" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(48) NOT NULL,name_pattern VARCHAR(48) NOT NULL DEFAULT 'Sala de {user}',category_id TEXT REFERENCES "ChannelCategory"(id) ON DELETE SET NULL,user_limit INTEGER NOT NULL DEFAULT 0,owner_controls BOOLEAN NOT NULL DEFAULT TRUE,auto_delete BOOLEAN NOT NULL DEFAULT TRUE,enabled BOOLEAN NOT NULL DEFAULT TRUE,position INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaDynamicVoiceRoom" (channel_id TEXT PRIMARY KEY REFERENCES "Channel"(id) ON DELETE CASCADE,template_id TEXT NOT NULL REFERENCES "GingaDynamicVoiceTemplate"(id) ON DELETE CASCADE,owner_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,locked BOOLEAN NOT NULL DEFAULT FALSE,user_limit INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,empty_since TIMESTAMP(3))`,
`CREATE TABLE IF NOT EXISTS "GingaClientCrashReport" (id TEXT PRIMARY KEY,user_id TEXT REFERENCES "User"(id) ON DELETE SET NULL,version VARCHAR(32) NOT NULL,platform VARCHAR(64) NOT NULL DEFAULT '',kind VARCHAR(32) NOT NULL DEFAULT 'renderer',message VARCHAR(1000) NOT NULL,stack TEXT NOT NULL DEFAULT '',metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaGuildBadge" (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES "Guild"(id) ON DELETE CASCADE,name VARCHAR(32) NOT NULL,icon VARCHAR(16) NOT NULL DEFAULT '',color VARCHAR(7) NOT NULL DEFAULT '#7c3cff',description VARCHAR(120) NOT NULL DEFAULT '',created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE TABLE IF NOT EXISTS "GingaGuildBadgeAssignment" (badge_id TEXT NOT NULL REFERENCES "GingaGuildBadge"(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,assigned_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(badge_id,user_id))`
  ];
  for (const statement of sql) await prisma.$executeRawUnsafe(statement);
  // 0.4.8: saneia referencias cross-tenant que possam ter sido gravadas por
  // releases antigas antes das validacoes de posse. Todos os comandos sao
  // idempotentes e rodam uma unica vez por processo junto ao bootstrap v0.9.
  const tenantCleanup = [
`DELETE FROM "GingaGuildSpaceCategory" sc USING "GingaGuildSpace" s,"ChannelCategory" c WHERE sc.space_id=s.id AND sc.category_id=c.id AND c."guildId"<>s.guild_id`,
`DELETE FROM "GingaGuildSpaceChannel" sc USING "GingaGuildSpace" s,"Channel" c WHERE sc.space_id=s.id AND sc.channel_id=c.id AND c."guildId"<>s.guild_id`,
`UPDATE "GingaOnboardingOption" o SET role_id=NULL FROM "GingaOnboardingQuestion" q,"GuildCustomRole" r WHERE o.question_id=q.id AND o.role_id=r.id AND r."guildId"<>q.guild_id`,
`UPDATE "GingaOnboardingOption" o SET channel_ids=COALESCE((SELECT ARRAY_AGG(x.cid ORDER BY x.ord) FROM UNNEST(o.channel_ids) WITH ORDINALITY AS x(cid,ord) JOIN "Channel" c ON c.id=x.cid AND c."guildId"=q.guild_id),ARRAY[]::TEXT[]) FROM "GingaOnboardingQuestion" q WHERE o.question_id=q.id`,
`DELETE FROM "GingaOnboardingRoleGrant" a USING "GuildCustomRole" r WHERE a.role_id=r.id AND a.guild_id<>r."guildId"`,
`DELETE FROM "GuildMemberCustomRole" a USING "GuildCustomRole" r WHERE a."roleId"=r.id AND a."guildId"<>r."guildId"`,
`DELETE FROM "GuildMemberCustomRole" a WHERE NOT EXISTS (SELECT 1 FROM "GuildMember" gm WHERE gm."guildId"=a."guildId" AND gm."userId"=a."userId")`,
`UPDATE "GingaGuildSecurityPolicy" p SET mod_log_channel_id=NULL FROM "Channel" c WHERE p.mod_log_channel_id=c.id AND (c."guildId"<>p.guild_id OR c.type::text NOT IN ('TEXT','ANNOUNCEMENT'))`,
`UPDATE "GingaDynamicVoiceTemplate" t SET category_id=NULL FROM "ChannelCategory" c WHERE t.category_id=c.id AND c."guildId"<>t.guild_id`,
`DELETE FROM "GingaGuildBadgeAssignment" a USING "GingaGuildBadge" b WHERE a.badge_id=b.id AND NOT EXISTS (SELECT 1 FROM "GuildMember" gm WHERE gm."guildId"=b.guild_id AND gm."userId"=a.user_id)`
  ];
  for (const statement of tenantCleanup) await prisma.$executeRawUnsafe(statement);

}

export async function ensureV090Storage() {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  await ready;
}

export async function expireCustomStatuses() {
  await ensureV090Storage();
  const rows = await prisma.$queryRawUnsafe<Array<{user_id:string}>>(`SELECT user_id FROM "GingaUserSocialProfile" WHERE status_expires_at IS NOT NULL AND status_expires_at <= NOW()`);
  if (!rows.length) return [];
  const ids = rows.map(r => r.user_id);
  await prisma.$executeRawUnsafe(`UPDATE "GingaUserSocialProfile" SET status_expires_at=NULL,updated_at=NOW() WHERE user_id = ANY($1::text[])`, ids);
  await prisma.$executeRawUnsafe(`UPDATE "GingaGamingProfile" SET custom_status=NULL,updated_at=NOW() WHERE user_id = ANY($1::text[])`, ids).catch(()=>undefined);
  return ids;
}
