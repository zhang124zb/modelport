import type { ChatSettings } from "./chat-settings";

type KeyEvent = Pick<KeyboardEvent, "key" | "keyCode" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "repeat">;
export const fixedKeyboardShortcuts = [
  { action: "new-chat", label: "创建新的对话", keys: ["Ctrl", "N"] },
  { action: "new-topic", label: "新话题", keys: ["Ctrl", "Shift", "N"] },
  { action: "next-chat", label: "跳转到下一个会话", keys: ["Ctrl", "Tab"] },
  { action: "previous-chat", label: "跳转到上一个会话", keys: ["Ctrl", "Shift", "Tab"] },
  { action: "chat-number", label: "跳转到第N个会话", keys: ["Ctrl", "1-9"] },
  { action: "toggle-search", label: "显示/隐藏搜索弹窗", keys: ["Ctrl", "K"] },
] as const;

export function getAppShortcut(event: KeyEvent): "new-chat" | "new-topic" | "next-chat" | "previous-chat" | "toggle-search" | number | undefined {
  if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "n") return event.shiftKey ? "new-topic" : "new-chat";
  if (key === "tab") return event.shiftKey ? "previous-chat" : "next-chat";
  if (!event.shiftKey && key === "k") return "toggle-search";
  if (!event.shiftKey && /^[1-9]$/.test(key)) return Number(key) - 1;
}

export function matchesSaveOnlyShortcut(event: KeyEvent, shortcut: ChatSettings["sendWithoutReplyShortcut"]): boolean {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.repeat || event.shiftKey) return false;
  return shortcut === "ctrl-enter" ? (event.ctrlKey || event.metaKey) && !event.altKey
    : shortcut === "alt-enter" ? event.altKey && !event.ctrlKey && !event.metaKey : false;
}

export function adjacentConversationId(conversations: readonly { id: string }[], activeId: string | null, direction: 1 | -1): string | undefined {
  if (!conversations.length) return;
  const index = conversations.findIndex(conversation => conversation.id === activeId);
  return conversations[index < 0 ? direction === 1 ? 0 : conversations.length - 1
    : (index + direction + conversations.length) % conversations.length].id;
}
