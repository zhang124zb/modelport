import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ProviderConfig, ProviderId } from "@/lib/modelport";
import { errorMessage, isDesktop, providerInfo } from "@/lib/modelport";
import { defaultProviderConfigs, endpointPreview, isCustomProvider } from "@/lib/providers";
import { useSettingsLeaveGuard } from "@/features/settings/useSettingsLeaveGuard";
import { Icon } from "@/components/Icon";

export type ProviderSettingsProps = {
  configs: readonly ProviderConfig[];
  selectedProvider: ProviderId;
  configuredKeys: Partial<Record<ProviderId, boolean>>;
  keyDraft: string;
  busy: boolean;
  notice: string;
  onSelectProvider: (provider: ProviderId) => void;
  onKeyDraftChange: (value: string) => void;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
  onRemove: () => Promise<void>;
  onSaveConfig: (config: ProviderConfig) => Promise<ProviderConfig>;
  onAddProvider: () => Promise<void>;
  onDeleteProvider: () => Promise<void>;
};

export function ProviderSettings(props: ProviderSettingsProps & { onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void }) {
  const { configs, selectedProvider, configuredKeys, keyDraft } = props;
  const current = configs.find(config => config.id === selectedProvider);
  const [draft, setDraft] = useState(current);
  const [modelDraft, setModelDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const busy = localBusy || props.busy;
  const canLeave = useSettingsLeaveGuard({ dirty: dirty || Boolean(keyDraft) || Boolean(modelDraft), busy, message: "模型提供方有未保存的修改，确定放弃吗？", onRegisterLeaveGuard: props.onRegisterLeaveGuard, onError: setNotice });
  useEffect(() => { setDraft(current); }, [current]);
  useEffect(() => { setModelDraft(""); setShowKey(false); setNotice(""); }, [selectedProvider]);
  useEffect(() => { listRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" }); }, [selectedProvider]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy || !isDesktop) { if (!isDesktop) setNotice("请在 ModelPort 桌面应用中配置连接。"); return; }
    setLocalBusy(true); setNotice("");
    try { await action(); } catch (error) { setNotice(errorMessage(error)); } finally { setLocalBusy(false); }
  };
  const addModel = () => {
    const id = modelDraft.trim();
    if (!draft) return;
    if (!id || new TextEncoder().encode(id).length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(id)) { setNotice("请输入有效模型 ID（最多 128 字节）。"); return; }
    if (draft.models.includes(id)) { setNotice("该模型已存在。"); return; }
    if (draft.models.length >= 100) { setNotice("最多保存 100 个模型。"); return; }
    setDraft({ ...draft, models: [...draft.models, id] }); setModelDraft(""); setNotice("模型已加入待保存列表，保存配置后可用于聊天。");
  };
  const custom = isCustomProvider(selectedProvider);
  const info = providerInfo(selectedProvider, configs);
  return <div className="providers-settings">
    <aside className="providers-sidebar" aria-label="模型提供商列表">
      <div className="provider-list" ref={listRef}>{configs.map(config => {
        const detail = providerInfo(config.id, configs);
        const state = config.id === "ollama" ? "本地" : configuredKeys[config.id] ? "已保存" : isCustomProvider(config.id) ? "自定义" : "未配置";
        return <button aria-pressed={selectedProvider === config.id} data-provider-id={config.id} className={`provider-card${selectedProvider === config.id ? " selected" : ""}`} disabled={busy} key={config.id} onClick={() => { if (canLeave()) props.onSelectProvider(config.id); }} type="button">
          <span className="provider-logo" style={{ background: detail.tone }}>{detail.letter}</span>
          <span className="provider-copy"><strong>{config.name}</strong><small>{state}</small></span>
        </button>;
      })}</div>
      <button className="provider-add" disabled={busy || !isDesktop} onClick={() => { if (canLeave()) void run(props.onAddProvider); }} type="button"><Icon name="plus" size={17} />添加自定义提供商</button>
    </aside>
    {draft ? <form className="provider-editor" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (dirty) await props.onSaveConfig({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""), chatPath: draft.chatPath.trim() });
      if (keyDraft.trim()) await props.onSave(); else setNotice("连接配置已保存。尚未发送聊天请求。");
    }); }}>
      <header className="provider-editor-heading"><div><h3>{draft.name || "自定义提供商"}</h3><span>{info.description}</span></div>
        {custom && <button aria-label="删除自定义提供商" className="provider-delete" disabled={busy} onClick={() => { if (window.confirm(`删除“${current?.name}”及其密钥？聊天记录保留，使用该连接的默认模型不会自动换成其他服务。`)) void run(props.onDeleteProvider); }} type="button"><Icon name="trash" size={21} /></button>}
      </header>
      {info.guide && <button className="provider-guide" disabled={busy} onClick={() => { void run(() => openUrl(info.guide)); }} type="button"><Icon name="help" size={15} />设置指南</button>}
      {custom && <label className="key-field">名称<input aria-label="提供商名称" disabled={busy} maxLength={60} onChange={event => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label>}
      <label className="key-field">API 模式<select aria-label="API 模式" disabled value={selectedProvider === "anthropic" ? "anthropic" : selectedProvider === "ollama" ? "ollama" : "openai"}>
        <option value="openai">OpenAI API 兼容</option><option value="anthropic">Anthropic Messages API</option><option value="ollama">Ollama 本机 API</option>
      </select></label>
      {selectedProvider !== "ollama" && <label className="key-field">API 密钥
        <div className="provider-key-row"><div className="provider-key-input"><input aria-label="API 密钥" autoComplete="off" disabled={busy} onChange={event => props.onKeyDraftChange(event.target.value)} placeholder={configuredKeys[selectedProvider] ? "已保存；输入新密钥可替换" : custom ? "本地兼容服务可留空" : "粘贴你的 API Key"} type={showKey ? "text" : "password"} value={keyDraft} />
          <button aria-label={showKey ? "隐藏密钥" : "显示密钥"} disabled={busy} onClick={() => setShowKey(value => !value)} type="button">{showKey ? "隐藏" : "显示"}</button>
        </div><button className="provider-check" disabled={busy || dirty || Boolean(keyDraft)} onClick={() => void run(props.onTest)} type="button">检查</button></div>
      </label>}
      <div className="provider-endpoint-fields"><label className="key-field">API 主机<input aria-label="API 主机" disabled={busy || !custom} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" value={draft.baseUrl} /></label>
        <label className="key-field">API 路径<input aria-label="API 路径" disabled={busy || !custom} onChange={event => setDraft({ ...draft, chatPath: event.target.value })} placeholder="/chat/completions" value={draft.chatPath} /></label></div>
      <p className="provider-url-preview">预览：{endpointPreview(draft)}</p>
      {custom && <><label className="provider-network"><input checked={draft.networkCompatibility} disabled={busy} onChange={event => setDraft({ ...draft, networkCompatibility: event.target.checked })} type="checkbox" /><span>改善网络兼容性<small>使用 HTTP/1.1；仅在连接异常时开启，可能降低连接速度。</small></span></label>
        <p className="provider-hint">API 主机包含版本前缀（如 /v1）。远程地址须使用 HTTPS，HTTP 仅支持本机回环地址。已保存密钥时，更改主机前请先删除旧密钥。</p></>}
      {selectedProvider === "qwen" && <p className="provider-hint">内置地址使用北京地域。其他地域或业务空间专属地址，请添加自定义提供商，并使用对应地域的 API Key。</p>}
      <section className="provider-models" aria-label="模型管理"><div className="provider-models-heading"><strong>模型 <small>{draft.models.length}</small></strong><div>
        <button disabled={busy || dirty || Boolean(keyDraft)} onClick={() => void run(props.onTest)} title={dirty || keyDraft ? "请先保存连接配置和密钥" : "只获取模型列表，不发送聊天"} type="button">获取</button>
        <button disabled={busy} onClick={() => { if (window.confirm("重置此提供商的模型列表？保存后生效，不删除聊天记录。")) { setDraft({ ...draft, models: defaultProviderConfigs.find(config => config.id === selectedProvider)?.models ?? [] }); setNotice("模型列表已重置到表单，保存后生效。"); } }} type="button">重置</button>
      </div></div>
        <div className="provider-model-create"><input aria-label="新模型 ID" disabled={busy} onChange={event => setModelDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addModel(); } }} placeholder="输入服务商提供的模型 ID" value={modelDraft} /><button disabled={busy || !modelDraft.trim()} onClick={addModel} type="button">＋ 新建</button></div>
        <ul className="provider-model-list">{draft.models.map(id => <li key={id}><span>{id}</span><button aria-label={`移除模型 ${id}`} disabled={busy} onClick={() => setDraft({ ...draft, models: draft.models.filter(value => value !== id) })} type="button"><Icon name="close" size={15} /></button></li>)}</ul>
        {!draft.models.length && <p className="provider-model-empty">没有可用模型。保存密钥后点击“获取”，或手动新建模型。</p>}
      </section>
      {(notice || props.notice) && <p className="connection-notice" role="status">{notice || props.notice}</p>}
      <footer className="connection-actions"><button className="provider-save" disabled={busy || (!dirty && !keyDraft.trim()) || !isDesktop} type="submit">{busy ? "处理中…" : "保存配置与密钥"}</button>
        {selectedProvider !== "ollama" && configuredKeys[selectedProvider] && <button className="remove-key" disabled={busy} onClick={() => { if (window.confirm("删除该提供商的已保存密钥？模型和聊天记录保留。")) void run(props.onRemove); }} type="button">删除密钥</button>}
      </footer>
      <p className="provider-hint">密钥仅存入系统安全凭据库，不写入配置文件或聊天备份。模型列表不代表当前账户一定有调用权限。</p>
    </form> : <p role="status">该提供商已删除，请选择其他连接或重新添加。</p>}
  </div>;
}

export function ConnectionModal({ onClose, ...providerProps }: ProviderSettingsProps & { onClose: () => void }) {
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const register = useCallback((guard: (() => boolean) | null) => { leaveGuard.current = guard; }, []);
  const close = () => { if (leaveGuard.current?.() !== false) onClose(); };
  return <div className="modal-backdrop" onMouseDown={close} role="presentation">
    <section aria-labelledby="connection-title" aria-modal="true" className="connection-modal" onMouseDown={event => event.stopPropagation()} role="dialog">
      <header><div><span className="eyebrow">MODELPORT</span><h2 id="connection-title">模型连接</h2><p>连接云端 API、本地模型或自定义服务。</p></div><button aria-label="关闭设置" className="icon-button" onClick={close} type="button"><Icon name="close" /></button></header>
      <ProviderSettings {...providerProps} onRegisterLeaveGuard={register} />
    </section>
  </div>;
}
