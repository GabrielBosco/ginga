import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

interface SettingsShellProps<T extends string> {
  title: string;
  subtitle?: string;
  tabs: Array<{ id: T; label: string; icon: ReactNode; group?: string }>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

type NormalizedTab<T extends string> = {
  id: T;
  label: string;
  icon: ReactNode;
  group?: string;
  resolvedGroup: string;
};

function readCollapsedGroups(storageKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function SettingsShell<T extends string>({ title, subtitle, tabs, activeTab, onTabChange, onClose, children, footer }: SettingsShellProps<T>) {
  const storageKey = useMemo(() => `ginga:settings-groups:${title.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/gi, "-")}`, [title]);
  const normalizedTabs = useMemo(() => {
    let currentGroup = "CONFIGURACOES";
    return tabs.map<NormalizedTab<T>>((tab) => {
      if (tab.group) currentGroup = tab.group;
      return { ...tab, resolvedGroup: currentGroup };
    });
  }, [tabs]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroups(storageKey));
  const [compactNavigation, setCompactNavigation] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches);

  useEffect(() => {
    setCollapsedGroups(readCollapsedGroups(storageKey));
  }, [storageKey]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const sync = () => setCompactNavigation(media.matches);
    sync();
    if (media.addEventListener) media.addEventListener("change", sync);
    else media.addListener?.(sync);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", sync);
      else media.removeListener?.(sync);
    };
  }, []);

  const activeGroup = normalizedTabs.find((item) => item.id === activeTab)?.resolvedGroup ?? "";

  useEffect(() => {
    if (!activeGroup) return;
    setCollapsedGroups((previous) => {
      if (!previous.has(activeGroup)) return previous;
      const next = new Set(previous);
      next.delete(activeGroup);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* best effort */ }
      return next;
    });
  }, [activeGroup, storageKey]);

  function toggleGroup(group: string) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(next))); } catch { /* best effort */ }
      return next;
    });
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <nav>
          {normalizedTabs.map((tab, index) => {
            const previousGroup = index > 0 ? normalizedTabs[index - 1]?.resolvedGroup : null;
            const showGroup = tab.resolvedGroup !== previousGroup;
            const collapsed = !compactNavigation && collapsedGroups.has(tab.resolvedGroup);
            return (
              <Fragment key={tab.id}>
                {showGroup && !compactNavigation && (
                  <button
                    type="button"
                    className={`settings-nav-group-toggle ${collapsed ? "is-collapsed" : ""}`}
                    onClick={() => toggleGroup(tab.resolvedGroup)}
                    aria-expanded={!collapsed}
                    title={collapsed ? `Expandir ${tab.resolvedGroup}` : `Recolher ${tab.resolvedGroup}`}
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span>{tab.resolvedGroup}</span>
                  </button>
                )}
                {!collapsed && (
                  <div className="settings-nav-wrap" data-settings-group={tab.resolvedGroup}>
                    <button className={activeTab === tab.id ? "active" : ""} onClick={() => onTabChange(tab.id)} title={tab.label}>
                      {tab.icon}<span>{tab.label}</span>
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </nav>
        {footer && <div className="settings-sidebar-footer">{footer}</div>}
      </aside>
      <section className="settings-page">
        <button className="settings-close" onClick={onClose} aria-label="Fechar configuracoes"><X size={20} /></button>
        <div className="settings-page-inner">{children}</div>
      </section>
    </div>
  );
}
