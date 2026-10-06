import type { ProviderId } from "@/lib/modelport";
import { providerDetails } from "@/lib/modelport";
import { Icon } from "@/components/Icon";

export type ProviderSettingsProps = {
  selectedProvider: ProviderId;
  configuredKeys: Record<"openai" | "deepseek", boolean>;
  keyDraft: string;
  busy: boolean;
  notice: string;
  onSelectProvider: (provider: ProviderId) => void;
  onKeyDraftChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onRemove: () => void;
};

const providerIds: ProviderId[] = ["openai", "deepseek", "ollama"];

export function ProviderSettings({
  selectedProvider,
  configuredKeys,
  keyDraft,
  busy,
  notice,
  onSelectProvider,
  onKeyDraftChange,
  onSave,
  onTest,
  onRemove,
}: ProviderSettingsProps) {
  return (
    <>
        <div className="provider-list">
          {providerIds.map((providerId) => {
            const provider = providerDetails[providerId];
            const state = providerId === "ollama" ? "本地" : configuredKeys[providerId] ? "已保存" : "未配置";
            return <button className={`provider-card${selectedProvider === providerId ? " selected" : ""}`} key={providerId} onClick={() => onSelectProvider(providerId)} type="button">
              <span className="provider-logo" style={{ background: provider.tone }}>{provider.letter}</span>
              <span className="provider-copy"><strong>{provider.name}</strong><small>{provider.description}</small></span>
              <span className={`provider-state${state !== "未配置" ? " local" : ""}`}>{state}</span>
              <Icon name="chevron" size={20} />
            </button>;
          })}
        </div>
        <div className="provider-editor">
          <div className="provider-editor-heading">
            <strong>{providerDetails[selectedProvider].name}</strong>
            <span>{selectedProvider === "ollama" ? "只连接本机服务" : "密钥仅存入系统安全凭据库"}</span>
          </div>
          {selectedProvider !== "ollama" && (
            <label className="key-field">
              <span>API Key</span>
              <input autoComplete="off" onChange={(event) => onKeyDraftChange(event.target.value)} placeholder={configuredKeys[selectedProvider] ? "已保存；输入新密钥可替换" : "粘贴你的 API Key"} type="password" value={keyDraft} />
            </label>
          )}
          <div className="connection-actions">
            {selectedProvider !== "ollama" && <button disabled={busy || !keyDraft.trim()} onClick={onSave} type="button">保存密钥</button>}
            <button disabled={busy} onClick={onTest} type="button">测试连接并获取模型</button>
            {selectedProvider !== "ollama" && configuredKeys[selectedProvider] && <button className="remove-key" disabled={busy} onClick={onRemove} type="button">删除密钥</button>}
          </div>
          {notice && <p className="connection-notice" role="status">{notice}</p>}
        </div>
        <div className="security-note"><Icon name="info" size={20} /><span>仅支持官方云端地址与本机 Ollama。Anthropic 等更多服务将在后续接入。</span></div>
    </>
  );
}

export function ConnectionModal({ onClose, ...providerProps }: ProviderSettingsProps & { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section aria-labelledby="connection-title" aria-modal="true" className="connection-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><span className="eyebrow">MODELPORT</span><h2 id="connection-title">模型连接</h2><p>连接云端 API 或本地模型服务。</p></div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <ProviderSettings {...providerProps} />
      </section>
    </div>
  );
}
