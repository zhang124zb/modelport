import { useState } from "react";
import { defaultModelSettings } from "@/lib/model-defaults";
import type { ModelReference } from "@/lib/model-defaults";
import { errorMessage, modelOption, providerInfo } from "@/lib/modelport";
import { isCustomProvider } from "@/lib/providers";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function DefaultsSettingsPage({ currentModel, modelChoices, providerProps, modelDefaults, modelDefaultsError, onSaveModelDefaults, onRegisterLeaveGuard }: SettingsPageProps) {
  const [draft, setDraft] = useState<ModelReference | null>(() => modelDefaults.chatModel);
  const [notice, setNotice] = useState("");
  const dirty = draft?.provider !== modelDefaults.chatModel?.provider || draft?.id !== modelDefaults.chatModel?.id;
  useSettingsLeaveGuard({ dirty, busy: false, message: "默认模型有未保存的修改，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });
  const choices = modelChoices.filter(model => model.id);
  if (draft && !choices.some(model => model.provider === draft.provider && model.id === draft.id)) choices.push(modelOption(draft.provider, draft.id));
  const unavailable = Boolean(draft && !modelChoices.some(model => model.provider === draft.provider && model.id === draft.id));
  const needsKey = draft && draft.provider !== "ollama" && !isCustomProvider(draft.provider) && !providerProps.configuredKeys[draft.provider];
  return <form className="settings-page defaults-settings-page" onSubmit={event => {
    event.preventDefault();
    try { onSaveModelDefaults({ chatModel: draft }); setNotice("默认模型已保存，用于空白窗口、新对话及后续启动；已有对话和正在生成的请求不改变。"); }
    catch (error) { setNotice(errorMessage(error)); }
  }}>
    <p className="chat-settings-summary">选择新对话使用的模型，支持本机 Ollama、各家云端服务及自定义提供商。保存选择不会发送聊天或修改 API Key。</p>
    {(notice || modelDefaultsError) && <p className="chat-settings-notice" role="status">{notice || modelDefaultsError}</p>}
    <section className="settings-card"><h4>新对话默认模型</h4>
      <label className="chat-settings-field" htmlFor="default-chat-model"><span>模型</span>
        <select id="default-chat-model" onChange={event => {
          const selected = choices.find(model => `${model.provider}:${model.id}` === event.target.value);
          setDraft(selected ? { provider: selected.provider, id: selected.id } : null); setNotice("");
        }} value={draft ? `${draft.provider}:${draft.id}` : "auto"}>
          <option value="auto">自动选择本机 Ollama 的首个可用模型</option>
          {[...new Set([...providerProps.configs.map(config => config.id), ...choices.map(model => model.provider)])].map(provider => <optgroup key={provider} label={providerInfo(provider, providerProps.configs).name}>{choices.filter(model => model.provider === provider).map(model => <option key={model.id} value={`${provider}:${model.id}`}>{model.name}</option>)}</optgroup>)}
        </select>
      </label>
      <p>列表沿用已知模型。需要更多模型时，请先在“模型提供方”中配置连接并点击“测试连接”，再回到这里选择。</p>
      {needsKey && <p role="status">{providerInfo(draft.provider, providerProps.configs).name} 尚未配置 API Key；可以保存选择，发送前仍需在“模型提供方”配置凭据。</p>}
      {unavailable && <p role="status">该选择未出现在当前模型列表中，仍按原选择保留。请测试连接并确认模型可用；不会自动改用另一家服务。</p>}
      <p>不设置时兼容原来的本机自动选择策略。默认模型仅影响空白新对话，不改写已有聊天的模型、技能或知识库。</p>
    </section>
    <section className="settings-card"><h4>当前对话模型</h4><p className="settings-model-name">{currentModel.name}</p><p>会话模型可在主界面单独切换，不会更改这里保存的默认值。</p></section>
    <footer className="chat-settings-actions"><span>{dirty ? "有未保存的修改" : "当前默认模型未改动"}</span>
      <button onClick={() => { if (window.confirm("恢复自动选择本机模型？不会更改已有聊天。点击保存后才生效。")) { setDraft(defaultModelSettings.chatModel); setNotice("自动选择已恢复到表单，点击保存后生效。"); } }} type="button">恢复自动选择</button>
      <button className="defaults-settings-save" disabled={!dirty && !modelDefaultsError} type="submit">保存默认模型</button>
    </footer>
  </form>;
}
