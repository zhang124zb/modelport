import { useState } from "react";
import { fixedKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import type { ChatSettings } from "@/lib/chat-settings";
import { errorMessage } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function KeyboardShortcutsPage({ chatSettings, chatSettingsError, onSaveChatSettings, onRegisterLeaveGuard }: SettingsPageProps) {
  const [draft, setDraft] = useState(() => ({ sendShortcut: chatSettings.sendShortcut, sendWithoutReplyShortcut: chatSettings.sendWithoutReplyShortcut }));
  const [notice, setNotice] = useState("");
  const dirty = draft.sendShortcut !== chatSettings.sendShortcut || draft.sendWithoutReplyShortcut !== chatSettings.sendWithoutReplyShortcut;
  useSettingsLeaveGuard({ dirty, busy: false, message: "快捷键有未保存的修改，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });
  return (
    <form className="settings-page keyboard-shortcuts-page" onSubmit={event => {
      event.preventDefault();
      if (chatSettingsError) return;
      try { onSaveChatSettings({ ...chatSettings, ...draft }); setNotice("快捷键已保存，立即生效。"); }
      catch (error) { setNotice(errorMessage(error)); }
    }}>
      <p className="chat-settings-summary">发送相关组合可以修改，其余快捷键先固定。Shift + Enter 始终换行，输入法选词时不触发快捷键。</p>
      {(notice || chatSettingsError) && <p className="chat-settings-notice" role="status">{chatSettingsError ? "配置读取异常，请先在“对话设置”检查并保存后再修改快捷键。" : notice}</p>}
      <div className="keyboard-shortcut-list">
        <label className="keyboard-shortcut-row" htmlFor="chat-send-shortcut"><span>发送</span>
          <select id="chat-send-shortcut" value={draft.sendShortcut} onChange={event => {
            const sendShortcut = event.target.value === "ctrl-enter" ? "ctrl-enter" : "enter";
            setDraft(current => ({ sendShortcut, sendWithoutReplyShortcut: current.sendWithoutReplyShortcut === sendShortcut ? "none" : current.sendWithoutReplyShortcut })); setNotice("");
          }}><option value="enter">↵</option><option value="ctrl-enter">Ctrl + ↵</option></select>
        </label>
        <label className="keyboard-shortcut-row" htmlFor="chat-save-only-shortcut"><span>发送但不生成回答</span>
          <select id="chat-save-only-shortcut" value={draft.sendWithoutReplyShortcut} onChange={event => { setDraft(current => ({ ...current, sendWithoutReplyShortcut: event.target.value as ChatSettings["sendWithoutReplyShortcut"] })); setNotice(""); }}>
            <option disabled={draft.sendShortcut === "ctrl-enter"} value="ctrl-enter">Ctrl + ↵</option><option value="alt-enter">Alt + ↵</option><option value="none">未设置</option>
          </select>
        </label>
        {fixedKeyboardShortcuts.map(shortcut => <div className="keyboard-shortcut-row" key={shortcut.action}><span>{shortcut.label}</span><span aria-label={shortcut.keys.join(" + ")} className="keyboard-keycaps">{shortcut.keys.map(key => <kbd key={key}>{key}</kbd>)}</span></div>)}
      </div>
      <p className="chat-settings-summary">两种发送组合不能相同；改为 Ctrl + Enter 发送时，会清除与它冲突的仅保存组合。仅保存的消息不调用模型，后续生成时可随上下文发送；新话题保留旧记录但不携带此前聊天。设置或连接窗口打开时暂停主界面快捷键。</p>
      <footer className="chat-settings-actions">
        <span>{dirty ? "有未保存的修改" : "当前快捷键未改动"}</span>
        <button onClick={() => { if (window.confirm("恢复默认快捷键？不会更改对话设置或聊天记录。点击保存后才生效。")) { setDraft({ sendShortcut: "enter", sendWithoutReplyShortcut: "ctrl-enter" }); setNotice("默认组合已恢复到表单，点击保存后生效。"); } }} type="button">恢复默认</button>
        <button className="keyboard-settings-save" disabled={!dirty || Boolean(chatSettingsError)} type="submit">保存快捷键</button>
      </footer>
    </form>
  );
}
