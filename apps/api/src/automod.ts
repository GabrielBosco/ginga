import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { ensureV090Storage } from "./v090Storage.js";

function countMentions(content: string) {
  const matches = content.match(/@[a-zA-Z0-9_.-]+/g) ?? [];
  return new Set(matches.map((value) => value.toLowerCase())).size;
}

export async function enforceAutoMod(input: { guildId: string; channelId: string; userId: string; content: string }) {
  if (!input.content.trim()) return;
  const membership = await prisma.guildMember.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!membership || membership.role === "OWNER" || membership.role === "ADMIN") return;

  const assignments = await prisma.guildMemberCustomRole.findMany({
    where: { guildId: input.guildId, userId: input.userId },
    select: { roleId: true }
  });
  const roleIds = new Set(assignments.map((item) => item.roleId));
  await ensureV090Storage();
  const policies=await prisma.$queryRawUnsafe<Array<{block_external_links:boolean;block_invites:boolean;max_mentions:number;duplicate_limit:number;auto_timeout_minutes:number}>>(`SELECT block_external_links,block_invites,max_mentions,duplicate_limit,auto_timeout_minutes FROM "GingaGuildSecurityPolicy" WHERE guild_id=$1 LIMIT 1`,input.guildId);
  const policy=policies[0];
  if(policy){let reason="";if(policy.block_external_links&&/https?:\/\/[^\s]+/i.test(input.content))reason="links externos bloqueados";if(!reason&&policy.block_invites&&/(discord\.gg|\/invite\/|ginga:\/\/invite)/i.test(input.content))reason="convites bloqueados";const mentions=(input.content.match(/@[A-Za-z0-9_.-]+/g)||[]).length;if(!reason&&mentions>policy.max_mentions)reason="limite de mencoes excedido";if(!reason&&policy.duplicate_limit>=2){const n=await prisma.message.count({where:{channelId:input.channelId,authorId:input.userId,content:input.content,createdAt:{gte:new Date(Date.now()-60000)}}});if(n>=policy.duplicate_limit-1)reason="mensagem repetida em excesso";}if(reason){if(policy.auto_timeout_minutes>0)await prisma.guildMember.updateMany({where:{guildId:input.guildId,userId:input.userId},data:{timeoutUntil:new Date(Date.now()+policy.auto_timeout_minutes*60000),timeoutReason:`AutoMod: ${reason}`}});throw new HttpError(403,`Protecao do servidor bloqueou a mensagem: ${reason}`);}}
  const rules = await prisma.autoModRule.findMany({ where: { guildId: input.guildId, enabled: true } });
  const normalized = input.content.toLocaleLowerCase("pt-BR");

  for (const rule of rules) {
    if (rule.exemptChannelIds.includes(input.channelId) || rule.exemptRoleIds.some((roleId) => roleIds.has(roleId))) continue;
    let triggered = false;
    let reason = "";

    if (rule.type === "KEYWORDS") {
      const term = rule.blockedTerms.find((item) => item.trim() && normalized.includes(item.trim().toLocaleLowerCase("pt-BR")));
      if (term) { triggered = true; reason = `palavra bloqueada: ${term}`; }
    } else if (rule.type === "MENTION_SPAM") {
      const limit = rule.mentionLimit ?? 5;
      const mentions = countMentions(input.content);
      if (mentions > limit) { triggered = true; reason = `excesso de mencoes (${mentions}/${limit})`; }
    } else if (rule.type === "INVITE_SPAM") {
      if (/https?:\/\/\S+\/(?:invite|oauth2)\//i.test(input.content) || /discord\.gg\//i.test(input.content)) {
        triggered = true; reason = "link de convite nao permitido";
      }
    } else if (rule.type === "REPETITION") {
      const limit = Math.max(2, rule.repetitionLimit ?? 3);
      const recent = await prisma.message.count({
        where: {
          channelId: input.channelId,
          authorId: input.userId,
          content: input.content,
          createdAt: { gte: new Date(Date.now() - 60_000) }
        }
      });
      if (recent >= limit - 1) { triggered = true; reason = `mensagem repetida ${limit} vezes em menos de 1 minuto`; }
    }

    if (!triggered) continue;
    await prisma.guildAuditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.userId,
        action: "AUTOMOD_BLOCK",
        targetType: "CHANNEL",
        targetId: input.channelId,
        targetUserId: input.userId,
        metadata: { ruleId: rule.id, ruleName: rule.name, ruleType: rule.type, reason }
      }
    });
    if (rule.blockMessage) throw new HttpError(403, `AutoMod bloqueou a mensagem: ${reason}`);
  }
}
