import { useRef, useState } from "react";
import type { Conversation } from "@/lib/chat-store";
import { maxChatBackupBytes, parseChatBackup } from "@/lib/chat-store";
import { defaultGeneralSettings } from "@/lib/general-settings";
import type { GeneralSettings } from "@/lib/general-settings";
import { errorMessage } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function GeneralSettingsPage({ generalSettings, generalSettingsError, onSaveGeneralSettings, chatData, chatBusy,
  onExportChats, onImportChats, onClearChats, onRegisterLeaveGuard }: SettingsPageProps) {
  const [draft, setDraft] = useState(() => ({ ...generalSettings }));
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; conversations: Conversation[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(generalSettings);
  useSettingsLeaveGuard({ dirty: dirty || Boolean(preview), busy, message: "常规设置有未保存的修改或待导入备份，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });
  const change = (settings: Partial<GeneralSettings>) => { setDraft(current => ({ ...current, ...settings })); setNotice(""); };
  const messageCount = chatData.reduce((sum, conversation) => sum + conversation.messages.length, 0);
  const readBackup = async (file: File) => {
    setBusy(true); setPreview(null); setNotice("");
    try {
      if (file.size > maxChatBackupBytes) throw new Error("聊天备份不能超过 10 MiB。");
      const conversations = parseChatBackup(await file.text());
      if (!conversations.length) throw new Error("备份中没有可导入的会话。");
      setPreview({ name: file.name, conversations });
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <form className="settings-page general-settings-page" onSubmit={event => {
    event.preventDefault();
    if (busy) return;
    try { onSaveGeneralSettings(draft); setNotice("常规设置已保存；外观立即生效，启动行为用于下次打开软件。"); }
    catch (error) { setNotice(errorMessage(error)); }
  }}>
    <p className="chat-settings-summary">只保存在本机，不改变模型连接、对话参数或快捷键。数据管理操作独立生效，不需要保存设置。</p>
    {(notice || generalSettingsError) && <p className="chat-settings-notice" role="status">{notice || generalSettingsError}</p>}
    <section className="settings-card"><h4>外观</h4>
      <label className="chat-settings-field" htmlFor="general-theme"><span>主题</span><select id="general-theme" value={draft.theme} onChange={event => change({ theme: event.target.value as GeneralSettings["theme"] })}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
      <label className="general-toggle" htmlFor="general-animations"><span>界面动画</span><input checked={draft.animations} id="general-animations" onChange={event => change({ animations: event.target.checked })} type="checkbox" /></label>
      <p>保存后应用到主界面、设置和搜索弹窗。系统启用“减少动态效果”时优先尊重系统选择。</p>
    </section>
    <section className="settings-card"><h4>启动行为</h4>
      <label className="chat-settings-field" htmlFor="general-startup"><span>打开软件时</span><select id="general-startup" value={draft.startup} onChange={event => change({ startup: event.target.value as GeneralSettings["startup"] })}><option value="last-conversation">恢复上次打开的会话</option><option value="new-chat">显示空白新对话</option></select></label>
      <label className="chat-settings-field" htmlFor="general-sidebar"><span>启动时侧栏</span><select id="general-sidebar" value={draft.sidebar} onChange={event => change({ sidebar: event.target.value as GeneralSettings["sidebar"] })}><option value="expanded">展开</option><option value="collapsed">收起</option></select></label>
      <p>空白新对话仍默认使用本机 Ollama，不会删除旧记录。仅控制应用打开后的界面，不注册 Windows 开机启动。</p>
    </section>
    <section className="settings-card"><h4>聊天数据</h4><p>本机共有 {chatData.length} 个会话、{messageCount} 条消息。JSON 备份未加密，含聊天和历史来源片段；不含 API Key、设置、技能正文或知识库原文件。请妥善保管。</p>
      <div className="general-data-actions">
        <button disabled={busy || chatBusy || !chatData.length} onClick={() => { try { onExportChats(); setNotice("已发起聊天备份下载，请在下载窗口完成保存。"); } catch (error) { setNotice(errorMessage(error)); } }} type="button">导出聊天备份</button>
        <button disabled={busy || chatBusy || Boolean(preview)} onClick={() => fileRef.current?.click()} type="button">导入聊天备份</button>
        <button className="general-danger" disabled={busy || chatBusy || !chatData.length || Boolean(preview)} onClick={() => {
          if (window.prompt("将清空本机全部聊天记录和未发送草稿，不能直接撤销。请先导出备份。不会删除 API Key、技能或知识库。\n确认请填写：清空对话") !== "清空对话") return;
          try { onClearChats(); setNotice("聊天记录和草稿已清空；如有导出的备份，可通过导入恢复。设置和资料库未修改。"); } catch (error) { setNotice(errorMessage(error)); }
        }} type="button">清空聊天记录</button>
      </div>
      <input accept=".json,application/json" aria-label="选择聊天备份" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readBackup(file); }} ref={fileRef} type="file" />
      {preview && <div className="general-import-preview"><strong>{preview.name}</strong><p>识别到 {preview.conversations.length} 个会话，将作为副本合并，不覆盖现有会话。重复导入会产生副本；备份不会恢复缺失的技能或知识库。</p>
        <div className="general-data-actions"><button disabled={busy || chatBusy} onClick={() => {
          if (!window.confirm(`确认合并导入“${preview.name}”中的 ${preview.conversations.length} 个会话？不会覆盖现有记录。`)) return;
          try { onImportChats(preview.conversations); setPreview(null); setNotice("备份已合并导入，可在侧栏打开；原有会话和草稿保留。"); } catch (error) { setNotice(errorMessage(error)); }
        }} type="button">确认合并导入</button><button onClick={() => setPreview(null)} type="button">取消导入</button></div>
      </div>}
      {chatBusy && <p role="status">正在生成回复，请结束生成后再管理聊天数据。</p>}
    </section>
    <section className="settings-card"><h4>语言与其他选项</h4><p>当前界面语言：简体中文。多语言、开机自启动、托盘和跨设备同步尚未开放。</p></section>
    <footer className="chat-settings-actions"><span>{dirty ? "有未保存的修改" : "当前常规设置未改动"}</span>
      <button disabled={busy} onClick={() => { if (window.confirm("恢复常规设置默认值？不删除聊天记录，不更改对话设置或快捷键。点击保存后才生效。")) { setDraft({ ...defaultGeneralSettings }); setNotice("默认值已恢复到表单，点击保存后生效。"); } }} type="button">恢复默认</button>
      <button className="general-settings-save" disabled={busy || (!dirty && !generalSettingsError)} type="submit">保存常规设置</button>
    </footer>
  </form>;
}
