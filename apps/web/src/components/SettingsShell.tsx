import type { ReactNode } from "react";
import { X } from "lucide-react";

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

export function SettingsShell<T extends string>({ title, subtitle, tabs, activeTab, onTabChange, onClose, children, footer }: SettingsShellProps<T>) {
  let previousGroup = "";
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <nav>
          {tabs.map((tab) => {
            const showGroup = Boolean(tab.group && tab.group !== previousGroup);
            if (tab.group) previousGroup = tab.group;
            return (
              <div key={tab.id} className="settings-nav-wrap">
                {showGroup && <div className="settings-nav-group">{tab.group}</div>}
                <button className={activeTab === tab.id ? "active" : ""} onClick={() => onTabChange(tab.id)} title={tab.label}>
                  {tab.icon}<span>{tab.label}</span>
                </button>
              </div>
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
