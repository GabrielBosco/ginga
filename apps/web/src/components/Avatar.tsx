import type { User } from "../types";
import { useUserAvatar } from "../lib/avatarCache";

interface AvatarProps {
  user?: Pick<User, "displayName" | "avatarColor"> & Partial<Pick<User, "id" | "avatarUrl">>;
  name?: string;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  status?: "online" | "away" | "busy" | "offline";
  imageUrl?: string | null;
}

const statusLabels = { online: "Online", away: "Ausente", busy: "Ocupado", offline: "Offline" } as const;

export function Avatar({ user, name, color, size = "md", status, imageUrl }: AvatarProps) {
  const label = user?.displayName ?? name ?? "?";
  const background = user?.avatarColor ?? color ?? "#22a699";
  const resolvedImageUrl = useUserAvatar(user?.id, imageUrl !== undefined ? imageUrl : user?.avatarUrl);
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  return (
    <span className={`avatar avatar-${size} ${resolvedImageUrl ? "avatar-with-image" : ""}`} style={{ background }} aria-label={status ? `${label} · ${statusLabels[status]}` : label}>
      {resolvedImageUrl ? <img className="avatar-image" src={resolvedImageUrl} alt="" loading="lazy" /> : initials}
      {status && <span className={`avatar-status ${status}`} title={statusLabels[status]} aria-hidden="true" />}
    </span>
  );
}
