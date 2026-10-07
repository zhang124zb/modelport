import { useState } from "react";
import { defaultChatSettings } from "@/lib/chat-settings";
import type { ChatSettings } from "@/lib/chat-settings";
import { errorMessage } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function ChatSettingsPage({ chatSettings, chatSettingsError, onSaveChatSettings, onRegisterLeaveGuard }: SettingsPageProps) {
  const [draft, setDraft] = useState(() => ({ ...chatSettings }));
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(chatSettings);
  const change = (patch: Partial<ChatSettings>) => { setDraft(current => ({ ...current, ...patch })); setNotice(""); };
  useSettingsLeaveGuard({ dirty, busy: false, message: "对话设置有未保存的修改，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });

  return (
    <form className="settings-page chat-settings-page" onSubmit={event => {
      event.preventDefault();
      try { onSaveChatSettings(draft); setNotice("对话设置已保存，输入和展示立即生效；上下文与提示词用于下一次发送。"); }
      catch (error) { setNotice(errorMessage(error)); }
    }}>
      <p className="chat-settings-summary">适用于所有对话，只保存在本机。不会删除历史记录或更改模型连接。</p>
      {(notice || chatSettingsError) && <p className="chat-settings-notice" role="status">{notice || chatSettingsError}</p>}
      <section className="settings-card">
        <h4>输入方式</h4>
        <label className="chat-settings-field" htmlFor="chat-send-shortcut"><span>发送快捷键</span>
          <select id="chat-send-shortcut" value={draft.sendShortcut} onChange={event => change({ sendShortcut: event.target.value === "ctrl-enter" ? "ctrl-enter" : "enter" })}>
            <option value="enter">Enter 发送，Shift + Enter 换行</option>
            <option value="ctrl-enter">Ctrl + Enter 发送，Enter 换行</option>
          </select>
        </label>
        <p>中文输入法选词时不会触发发送。发送按钮始终可用。</p>
      </section>
      <section className="settings-card">
        <h4>上下文与指令</h4>
        <label className="chat-settings-field" htmlFor="chat-context-turns"><span>携带历史 <output>{draft.contextTurns} 轮</output></span>
          <input aria-describedby="chat-context-note" id="chat-context-turns" max={40} min={0} onChange={event => change({ contextTurns: Number(event.target.value) })} step={1} type="range" value={draft.contextTurns} />
        </label>
        <p id="chat-context-note">一轮是一个问题和一条完整回复；只携带最近的完整问答。0 轮表示仅发送当前问题。停止或失败的回复不参与上下文，此项不是模型的 Token 容量。</p>
        <label className="chat-settings-field chat-prompt-field" htmlFor="chat-system-prompt"><span>全局提示词 <small>{draft.systemPrompt.length} / 4000</small></span>
          <textarea aria-describedby="chat-prompt-note" id="chat-system-prompt" maxLength={4000} onChange={event => change({ systemPrompt: event.target.value })} placeholder="例如：默认使用中文回答，先给结论，再简要说明。留空则不添加指令。" rows={5} value={draft.systemPrompt} />
        </label>
        <p id="chat-prompt-note">作为每次请求的基础指令，与选用的技能共同生效。云端模型会收到这些文字；不要填写 API Key 或其他秘密。更换指令后建议新建对话，避免旧回复影响结果。</p>
      </section>
      <section className="settings-card">
        <h4>回复展示</h4>
        <label className="chat-settings-field" htmlFor="chat-reply-format"><span>回复格式</span>
          <select id="chat-reply-format" onChange={event => change({ renderMarkdown: event.target.value === "markdown" })} value={draft.renderMarkdown ? "markdown" : "plain"}>
            <option value="markdown">Markdown 排版</option><option value="plain">纯文本</option>
          </select>
        </label>
        <label className="chat-settings-field" htmlFor="chat-font-size"><span>消息字号 <output>{draft.fontSize} px</output></span>
          <input id="chat-font-size" max={24} min={12} onChange={event => change({ fontSize: Number(event.target.value) })} step={1} type="range" value={draft.fontSize} />
        </label>
        <p>保存后更新当前与历史消息的显示；不会修改消息原文。</p>
      </section>
      <footer className="chat-settings-actions">
        <span>{dirty ? "有未保存的修改" : "当前设置未改动"}</span>
        <button onClick={() => { if (window.confirm("恢复对话设置默认值？只重置本页选项，不删除聊天记录。点击保存后才生效。")) { setDraft({ ...defaultChatSettings }); setNotice("默认值已恢复到表单，点击保存后生效。"); } }} type="button">恢复默认</button>
        <button className="chat-settings-save" disabled={!dirty && !chatSettingsError} type="submit">保存设置</button>
      </footer>
    </form>
  );
}
