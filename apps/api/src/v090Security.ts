import { prisma } from "./db.js";
import { HttpError } from "./errors.js";
import { ensureV090Storage } from "./v090Storage.js";

export async function checkGuildJoinSecurity(guildId:string,userId:string){
  await ensureV090Storage();
  const rows=await prisma.$queryRawUnsafe<Array<{anti_raid_enabled:boolean;join_window_seconds:number;join_limit:number;quarantine_enabled:boolean;quarantine_minutes:number;new_account_hours:number}>>(`SELECT anti_raid_enabled,join_window_seconds,join_limit,quarantine_enabled,quarantine_minutes,new_account_hours FROM "GingaGuildSecurityPolicy" WHERE guild_id=$1 LIMIT 1`,guildId);
  const p=rows[0]; if(!p)return {timeoutUntil:null as Date|null,timeoutReason:""};
  if(p.anti_raid_enabled){const since=new Date(Date.now()-Math.max(10,p.join_window_seconds)*1000);const recent=await prisma.guildMember.count({where:{guildId,joinedAt:{gte:since}}});if(recent>=Math.max(2,p.join_limit))throw new HttpError(423,"Anti-raid ativado: novas entradas foram pausadas automaticamente.");}
  if(!p.quarantine_enabled)return {timeoutUntil:null,timeoutReason:""};
  const u=await prisma.user.findUnique({where:{id:userId},select:{createdAt:true}});if(!u)return {timeoutUntil:null,timeoutReason:""};
  if(Date.now()-u.createdAt.getTime()>=p.new_account_hours*3600000)return {timeoutUntil:null,timeoutReason:""};
  return {timeoutUntil:new Date(Date.now()+Math.max(1,p.quarantine_minutes)*60000),timeoutReason:"Quarentena automatica para conta nova"};
}

export async function moderationSecurityPolicy(guildId:string){await ensureV090Storage();const r=await prisma.$queryRawUnsafe<Array<{require_moderation_reason:boolean;mod_log_channel_id:string|null}>>(`SELECT require_moderation_reason,mod_log_channel_id FROM "GingaGuildSecurityPolicy" WHERE guild_id=$1 LIMIT 1`,guildId);return {requireReason:Boolean(r[0]?.require_moderation_reason),modLogChannelId:r[0]?.mod_log_channel_id??null};}
export async function requireModerationReasonIfConfigured(guildId:string,reason:string|null|undefined){const p=await moderationSecurityPolicy(guildId);if(p.requireReason&&!String(reason??"").trim())throw new HttpError(400,"Este servidor exige um motivo para a acao de moderacao.");return p;}
