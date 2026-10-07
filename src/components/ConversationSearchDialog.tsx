import { useLayoutEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/chat-store";
import { Icon } from "./Icon";

export function ConversationSearchDialog({ conversations, onClose, onSelect }: {
  conversations: readonly Conversation[]; onClose: () => void; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const results = conversations.filter(conversation => !needle || conversation.title.toLocaleLowerCase().includes(needle)
    || conversation.messages.some(message => message.content.toLocaleLowerCase().includes(needle))).slice(0, 50);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);
  return <dialog aria-labelledby="conversation-search-title" className="conversation-search-dialog" ref={dialogRef}
    onCancel={event => { event.preventDefault(); onClose(); }} onMouseDown={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
    <header><h2 id="conversation-search-title">搜索会话</h2><button aria-label="关闭搜索" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button></header>
    <label htmlFor="conversation-search-input">按标题或消息内容搜索</label>
    <input autoFocus id="conversation-search-input" onChange={event => setQuery(event.target.value)} placeholder="搜索本机聊天记录…" type="search" value={query} />
    <div aria-label="搜索结果" className="conversation-search-results">
      {results.map(conversation => {
        const preview = (needle ? conversation.messages.find(message => message.content.toLocaleLowerCase().includes(needle)) : conversation.messages[0])?.content ?? "";
        return <button key={conversation.id} onClick={() => onSelect(conversation.id)} type="button"><span><strong>{conversation.title}</strong><time>{conversation.date}</time></span><p>{preview.slice(0, 160)}</p></button>;
      })}
      {!results.length && <p className="search-empty" role="status">{conversations.length ? "没有找到匹配的会话" : "还没有聊天记录"}</p>}
    </div>
    <p className="search-hint">仅在本机搜索，最多显示 50 个结果 · Ctrl + K 或 Esc 关闭</p>
  </dialog>;
}
