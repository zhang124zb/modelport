import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { settingsPageComponents } from "./pages";
import type { SettingsPageProps } from "./pages";
import { settingsSections } from "./sections";
import type { SettingsSectionId } from "./sections";
import "./settings.css";

export type SettingsDialogProps = Omit<SettingsPageProps, "section"> & { onClose: () => void };

export function SettingsDialog({ onClose, ...pageProps }: SettingsDialogProps) {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>("account");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const section = settingsSections.find((entry) => entry.id === activeSectionId) ?? settingsSections[0];
  const Page = settingsPageComponents[section.id];

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);

  return (
    <dialog
      aria-labelledby="settings-title"
      className="settings-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
      }}
      ref={dialogRef}
    >
      <aside className="settings-sidebar">
        <h2 id="settings-title">设置</h2>
        <nav aria-label="设置分类" className="settings-nav">
          {settingsSections.map((entry) => (
            <button
              aria-controls="settings-content"
              aria-current={entry.id === section.id ? "page" : undefined}
              className={entry.id === section.id ? "is-active" : ""}
              key={entry.id}
              onClick={() => setActiveSectionId(entry.id)}
              type="button"
            ><Icon name={entry.icon} size={23} /><span>{entry.label}</span></button>
          ))}
        </nav>
      </aside>
      <section aria-labelledby="settings-page-title" className="settings-main" id="settings-content">
        <header className="settings-heading">
          <div><h3 id="settings-page-title">{section.label}</h3><p>{section.description}</p></div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <div className="settings-content" key={section.id}>
          <Page {...pageProps} section={section} />
        </div>
      </section>
    </dialog>
  );
}
