import { useRef, useState } from "react";
import type { Conversation } from "@/lib/chat-store";
import { maxChatBackupBytes, parseChatBackup } from "@/lib/chat-store";
import { defaultGeneralSettings } from "@/lib/general-settings";
import type { GeneralSettings } from "@/lib/general-settings";
import { errorMessage } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function GeneralSettingsPage({ generalSettings, generalSettingsError, onSaveGeneralSettings, chatData, chatBusy, chatStorageError,
  onExportRawChats, onExportChats, onImportChats, onClearChats, onCleanAttachments, onRegisterLeaveGuard }: SettingsPageProps) {
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
      <p>空白新对话使用“默认模型”中保存的选择；未设置时使用本机 Ollama。不会删除旧记录，也不注册 Windows 开机启动。</p>
    </section>
    <section className="settings-card"><h4>聊天数据</h4><p>本机共有 {chatData.length} 个会话、{messageCount} 条消息。JSON 备份未加密，含聊天和历史来源片段；不含 API Key、设置、技能正文或知识库原文件。附件只保存引用，不含附件原件，跨电脑恢复后需要重新添加附件。请妥善保管。</p>
      {chatStorageError && <div className="general-import-preview" role="alert">
        <strong>原始聊天记录已保护</strong><p>{chatStorageError}</p>
        <p>当前仅展示能够读取的会话，不代表全部记录。请先关闭其他 ModelPort 窗口，下载原始记录并确认文件已保存；原始文件可能不是有效 JSON，也可能是包含多份原始存储内容的恢复包，不能直接作为聊天备份导入。文件未加密，可能含私密内容，请勿公开上传。</p>
        <div className="general-data-actions"><button disabled={busy || chatBusy} onClick={() => {
          try { onExportRawChats(); setNotice("已发起原始记录下载，请确认文件保存成功后再恢复或重置。"); }
          catch { setNotice("原始记录仍无法读取，未进行覆盖。请先检查系统存储权限，或保留本机应用数据后再决定是否重置。"); }
        }} type="button">导出原始记录</button></div>
      </div>}
      <div className="general-data-actions">
        <button disabled={busy || chatBusy || Boolean(chatStorageError) || !chatData.length} onClick={() => { try { onExportChats(); setNotice("已发起聊天备份下载，请在下载窗口完成保存。"); } catch (error) { setNotice(errorMessage(error)); } }} type="button">导出聊天备份</button>
        <button disabled={busy || chatBusy || Boolean(preview)} onClick={() => fileRef.current?.click()} type="button">导入聊天备份</button>
        <button className="general-danger" disabled={busy || chatBusy || (!chatStorageError && !chatData.length) || Boolean(preview)} onClick={() => {
          const phrase = chatStorageError ? "重置对话" : "清空对话";
          const warning = chatStorageError ? "将覆盖受保护的原始记录，清空全部聊天和草稿，不能直接撤销。请先导出原始记录并确认已保存。" : "将清空本机全部聊天记录和未发送草稿，不能直接撤销。请先导出备份。";
          if (window.prompt(`${warning}不会删除 API Key、技能或知识库。\n确认请填写：${phrase}`) !== phrase) return;
          try { onClearChats(); setNotice("聊天记录和草稿已清空；如有导出的备份，可通过导入恢复。设置和资料库未修改。"); } catch (error) { setNotice(errorMessage(error)); }
        }} type="button">{chatStorageError ? "重置聊天记录" : "清空聊天记录"}</button>
        <button disabled={busy || chatBusy || Boolean(chatStorageError) || Boolean(preview)} onClick={async () => {
          if (!window.confirm("请先关闭其他 ModelPort 窗口。仅清理当前窗口的聊天和草稿未引用的本地附件副本；旧 JSON 备份引用的闲置附件也会失效。原文件不会删除。确认已关闭其他窗口并继续？")) return;
          setBusy(true); setNotice("");
          try { setNotice(await onCleanAttachments()); } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
        }} type="button">清理闲置附件</button>
      </div>
      <input accept=".json,application/json" aria-label="选择聊天备份" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readBackup(file); }} ref={fileRef} type="file" />
      {preview && <div className="general-import-preview"><strong>{preview.name}</strong><p>识别到 {preview.conversations.length} 个会话，将作为副本合并，保留当前可读取的会话。重复导入会产生副本；备份不会恢复缺失的技能、知识库或附件原件。</p>
        {chatStorageError && <p>恢复会覆盖受保护的原始记录，无法恢复其中不能读取的部分。请先导出原始记录并确认文件已保存，再继续。</p>}
        <div className="general-data-actions"><button disabled={busy || chatBusy} onClick={() => {
          const warning = chatStorageError ? "此操作会覆盖受保护的原始记录，只保留备份和当前可读取的会话。请确认原始记录已另外保存。" : "不会覆盖现有记录。";
          if (!window.confirm(`确认${chatStorageError ? "恢复" : "合并导入"}“${preview.name}”中的 ${preview.conversations.length} 个会话？${warning}`)) return;
          try { onImportChats(preview.conversations); setPreview(null); setNotice("备份已合并导入，聊天保存已恢复，可在侧栏打开；当前可读取的会话和草稿保留。"); } catch (error) { setNotice(errorMessage(error)); }
        }} type="button">{chatStorageError ? "确认从备份恢复" : "确认合并导入"}</button><button onClick={() => setPreview(null)} type="button">取消导入</button></div>
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
