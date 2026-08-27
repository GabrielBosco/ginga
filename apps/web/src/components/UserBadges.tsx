import { Bot, Code2, ShieldCheck, Webhook } from "lucide-react";
import type { User } from "../types";

export function UserBadges({ user, compact = false }: { user: Pick<User, "systemRole" | "platformOwner" | "accountType">; compact?: boolean }) {
  return (
    <span className={`user-badges ${compact ? "compact" : ""}`}>
      {user.platformOwner ? <span className="user-badge platform-admin"><ShieldCheck size={compact ? 11 : 12} /> GINGA OWNER</span> : user.systemRole === "PLATFORM_ADMIN" && <span className="user-badge platform-admin"><ShieldCheck size={compact ? 11 : 12} /> GINGA ADMIN</span>}
      {user.systemRole === "DEVELOPER" && <span className="user-badge developer"><Code2 size={compact ? 11 : 12} /> DEV</span>}
      {user.accountType === "BOT" && <span className="user-badge bot"><Bot size={compact ? 11 : 12} /> BOT</span>}
      {user.accountType === "WEBHOOK" && <span className="user-badge webhook"><Webhook size={compact ? 11 : 12} /> WEBHOOK</span>}
      {user.accountType === "SYSTEM" && <span className="user-badge system"><ShieldCheck size={compact ? 11 : 12} /> SISTEMA</span>}
    </span>
  );
}
