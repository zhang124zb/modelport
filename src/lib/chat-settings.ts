import type { ChatTurn } from "./modelport";
import type { Message } from "./chat-store";

export type ChatSettings = {
  sendShortcut: "enter" | "ctrl-enter";
  contextTurns: number;
  systemPrompt: string;
  renderMarkdown: boolean;
  fontSize: number;
};

export const defaultChatSettings: ChatSettings = {
  sendShortcut: "enter", contextTurns: 20, systemPrompt: "", renderMarkdown: true, fontSize: 15,
};
const storageKey = "modelport.preferences.chat.v1";

export function validateChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("对话设置格式无效。");
  const record = value as Record<string, unknown>;
  const sendShortcut = record.sendShortcut === undefined ? defaultChatSettings.sendShortcut : record.sendShortcut;
  const contextTurns = record.contextTurns === undefined ? defaultChatSettings.contextTurns : record.contextTurns;
  const systemPrompt = record.systemPrompt === undefined ? defaultChatSettings.systemPrompt : record.systemPrompt;
  const renderMarkdown = record.renderMarkdown === undefined ? defaultChatSettings.renderMarkdown : record.renderMarkdown;
  const fontSize = record.fontSize === undefined ? defaultChatSettings.fontSize : record.fontSize;
  if ((sendShortcut !== "enter" && sendShortcut !== "ctrl-enter")
    || typeof contextTurns !== "number" || !Number.isInteger(contextTurns) || contextTurns < 0 || contextTurns > 40
    || typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 12 || fontSize > 24
    || typeof renderMarkdown !== "boolean"
    || typeof systemPrompt !== "string" || systemPrompt.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(systemPrompt)) {
    throw new Error("对话设置超出范围，请检查上下文轮数、字号与提示词（最多 4000 字符）。");
  }
  return { sendShortcut, contextTurns, systemPrompt, renderMarkdown, fontSize };
}

export function loadChatSettings(): { settings: ChatSettings; error: string } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw && raw.length > 32000) throw new Error("对话设置过大。");
    return { settings: raw ? validateChatSettings(JSON.parse(raw)) : { ...defaultChatSettings }, error: "" };
  } catch {
    return { settings: { ...defaultChatSettings }, error: "无法读取对话设置，暂时使用默认值；原数据未覆盖。检查设置后保存可重新建立配置。" };
  }
}

export function saveChatSettings(settings: ChatSettings): ChatSettings {
  const validated = validateChatSettings(settings);
  try { window.localStorage.setItem(storageKey, JSON.stringify(validated)); }
  catch { throw new Error("无法保存对话设置，请检查本机存储空间；本次修改尚未生效。"); }
  return validated;
}

export function shouldSendOnKey(event: Pick<KeyboardEvent, "key" | "keyCode" | "isComposing" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">, shortcut: ChatSettings["sendShortcut"]): boolean {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return false;
  return shortcut === "ctrl-enter" ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
}

export function buildRequestHistory(messages: readonly Pick<Message, "role" | "content" | "status">[], question: string, contextTurns: number): ChatTurn[] {
  const rounds: ChatTurn[][] = [];
  let pending: ChatTurn | undefined;
  for (const message of messages) {
    if (message.status || !message.content.trim()) { pending = undefined; continue; }
    const turn: ChatTurn = { role: message.role, content: message.content };
    if (message.role === "user") pending = turn;
    else if (pending) { rounds.push([pending, turn]); pending = undefined; }
  }
  return [...(contextTurns > 0 ? rounds.slice(-contextTurns).flat() : []), { role: "user", content: question }];
}
