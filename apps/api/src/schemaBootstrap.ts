import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prisma } from "./db.js";

async function userTableExists() {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'User'
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

function runPrismaPush() {
  return new Promise<void>((resolve, reject) => {
    const cli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
    const child = spawn(process.execPath, [cli, "db", "push", "--skip-generate"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Prisma db push encerrou com codigo ${code ?? "desconhecido"}`)));
  });
}

async function ensureIncrementalColumns() {
  // Upgrades aditivos e idempotentes para instalacoes self-hosted existentes.
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "afkEnabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "afkChannelId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "afkTimeoutMinutes" INTEGER NOT NULL DEFAULT 15`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "communityEnabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "communityTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "communityCategory" VARCHAR(32) NOT NULL DEFAULT 'Geral'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "lockdownEnabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "lockdownReason" VARCHAR(160) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "lockdownUpdatedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "musicEnabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "musicAllowMembers" BOOLEAN NOT NULL DEFAULT true`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "musicDefaultVolume" INTEGER NOT NULL DEFAULT 70`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "musicDefaultVoiceChannelId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE IF EXISTS "DeveloperApplication" ADD COLUMN IF NOT EXISTS "messageContentIntent" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildRolePermission" ADD COLUMN IF NOT EXISTS "canMoveMembers" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildRolePermission" ADD COLUMN IF NOT EXISTS "canMuteMembers" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildRolePermission" ADD COLUMN IF NOT EXISTS "canDeafenMembers" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildRolePermission" ADD COLUMN IF NOT EXISTS "canManageNicknames" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMember" ADD COLUMN IF NOT EXISTS "timeoutUntil" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMember" ADD COLUMN IF NOT EXISTS "timeoutReason" VARCHAR(300) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMember" ADD COLUMN IF NOT EXISTS "nickname" VARCHAR(32) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMember" ADD COLUMN IF NOT EXISTS "serverMuted" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMember" ADD COLUMN IF NOT EXISTS "serverDeafened" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountDisabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountDisabledAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountDisabledReason" VARCHAR(300) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "rules" TEXT NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "welcomeChannelId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "memberJoinMessagesEnabled" BOOLEAN NOT NULL DEFAULT true`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "memberLeaveMessagesEnabled" BOOLEAN NOT NULL DEFAULT true`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "memberSystemMessageChannelId" TEXT`);

  // Cargos personalizados chegaram depois do schema original em varias instalacoes.
  // Criamos/atualizamos as tabelas de forma idempotente para evitar POST /custom-roles = 500
  // em bancos existentes que nunca passaram por um prisma db push completo.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GuildCustomRole" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "guildId" TEXT NOT NULL,
      "name" VARCHAR(48) NOT NULL,
      "color" VARCHAR(7) NOT NULL DEFAULT '#8b93a7',
      "icon" VARCHAR(16) NOT NULL DEFAULT '',
      "description" VARCHAR(160) NOT NULL DEFAULT '',
      "position" INTEGER NOT NULL DEFAULT 0,
      "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "hoist" BOOLEAN NOT NULL DEFAULT false,
      "mentionable" BOOLEAN NOT NULL DEFAULT false,
      "managed" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GuildCustomRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "color" VARCHAR(7) NOT NULL DEFAULT '#8b93a7'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "icon" VARCHAR(16) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "description" VARCHAR(160) NOT NULL DEFAULT ''`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "hoist" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "mentionable" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildCustomRole" ADD COLUMN IF NOT EXISTS "managed" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "GuildCustomRole_guildId_name_key" ON "GuildCustomRole"("guildId", "name")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GuildCustomRole_guildId_position_idx" ON "GuildCustomRole"("guildId", "position")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GuildMemberCustomRole" (
      "guildId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "roleId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GuildMemberCustomRole_pkey" PRIMARY KEY ("guildId", "userId", "roleId"),
      CONSTRAINT "GuildMemberCustomRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "GuildMemberCustomRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "GuildMemberCustomRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GuildCustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "GuildMemberCustomRole" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GuildMemberCustomRole_userId_idx" ON "GuildMemberCustomRole"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "GuildMemberCustomRole_roleId_idx" ON "GuildMemberCustomRole"("roleId")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CategoryCustomRolePermission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "categoryId" TEXT NOT NULL,
      "roleId" TEXT NOT NULL,
      "canView" BOOLEAN,
      "canSendMessages" BOOLEAN,
      "canConnect" BOOLEAN,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CategoryCustomRolePermission_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChannelCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "CategoryCustomRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GuildCustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CategoryCustomRolePermission" ADD COLUMN IF NOT EXISTS "canView" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CategoryCustomRolePermission" ADD COLUMN IF NOT EXISTS "canSendMessages" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CategoryCustomRolePermission" ADD COLUMN IF NOT EXISTS "canConnect" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CategoryCustomRolePermission" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CategoryCustomRolePermission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CategoryCustomRolePermission_categoryId_roleId_key" ON "CategoryCustomRolePermission"("categoryId", "roleId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CategoryCustomRolePermission_roleId_idx" ON "CategoryCustomRolePermission"("roleId")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChannelCustomRolePermission" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "channelId" TEXT NOT NULL,
      "roleId" TEXT NOT NULL,
      "canView" BOOLEAN,
      "canSendMessages" BOOLEAN,
      "canConnect" BOOLEAN,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChannelCustomRolePermission_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ChannelCustomRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GuildCustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChannelCustomRolePermission" ADD COLUMN IF NOT EXISTS "canView" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChannelCustomRolePermission" ADD COLUMN IF NOT EXISTS "canSendMessages" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChannelCustomRolePermission" ADD COLUMN IF NOT EXISTS "canConnect" BOOLEAN`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChannelCustomRolePermission" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ChannelCustomRolePermission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ChannelCustomRolePermission_channelId_roleId_key" ON "ChannelCustomRolePermission"("channelId", "roleId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChannelCustomRolePermission_roleId_idx" ON "ChannelCustomRolePermission"("roleId")`);
}

export async function ensureInitialDatabaseSchema() {
  if (!(await userTableExists())) {
    const cli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
    await access(cli).catch(() => { throw new Error("Prisma CLI nao encontrado para inicializar um banco vazio"); });
    console.log("Banco Ginga vazio detectado; criando schema inicial de forma controlada...");
    await runPrismaPush();
    if (!(await userTableExists())) throw new Error("Schema inicial do Ginga nao foi criado corretamente");
  }
  await ensureIncrementalColumns();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CategoryUserPermission" (
      "id" TEXT NOT NULL PRIMARY KEY, "categoryId" TEXT NOT NULL, "userId" TEXT NOT NULL,
      "canView" BOOLEAN, "canSendMessages" BOOLEAN, "canConnect" BOOLEAN,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CategoryUserPermission_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChannelCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "CategoryUserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CategoryUserPermission_categoryId_userId_key" ON "CategoryUserPermission"("categoryId", "userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CategoryUserPermission_userId_idx" ON "CategoryUserPermission"("userId")`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChannelUserPermission" (
      "id" TEXT NOT NULL PRIMARY KEY, "channelId" TEXT NOT NULL, "userId" TEXT NOT NULL,
      "canView" BOOLEAN, "canSendMessages" BOOLEAN, "canConnect" BOOLEAN,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChannelUserPermission_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ChannelUserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ChannelUserPermission_channelId_userId_key" ON "ChannelUserPermission"("channelId", "userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChannelUserPermission_userId_idx" ON "ChannelUserPermission"("userId")`);
}
