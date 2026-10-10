import type { ChatTurn } from "./modelport";
import type { Message } from "./chat-store";
import type { Attachment } from "./attachments";

export type ChatSettings = {
  sendShortcut: "enter" | "ctrl-enter";
  sendWithoutReplyShortcut: "ctrl-enter" | "alt-enter" | "none";
  contextTurns: number;
  systemPrompt: string;
  renderMarkdown: boolean;
  fontSize: number;
};

export const defaultDialogueSettings = { contextTurns: 20, systemPrompt: "", renderMarkdown: true, fontSize: 15 };
export const defaultChatSettings: ChatSettings = { sendShortcut: "enter", sendWithoutReplyShortcut: "ctrl-enter", ...defaultDialogueSettings };
const storageKey = "modelport.preferences.chat.v1";

export function validateChatSettings(value: unknown): ChatSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("对话设置格式无效。");
  const record = value as Record<string, unknown>;
  const sendShortcut = record.sendShortcut === undefined ? defaultChatSettings.sendShortcut : record.sendShortcut;
  const sendWithoutReplyShortcut = record.sendWithoutReplyShortcut === undefined
    ? (sendShortcut === "ctrl-enter" ? "none" : "ctrl-enter") : record.sendWithoutReplyShortcut;
  const contextTurns = record.contextTurns === undefined ? defaultChatSettings.contextTurns : record.contextTurns;
  const systemPrompt = record.systemPrompt === undefined ? defaultChatSettings.systemPrompt : record.systemPrompt;
  const renderMarkdown = record.renderMarkdown === undefined ? defaultChatSettings.renderMarkdown : record.renderMarkdown;
  const fontSize = record.fontSize === undefined ? defaultChatSettings.fontSize : record.fontSize;
  if ((sendShortcut !== "enter" && sendShortcut !== "ctrl-enter")
    || !["ctrl-enter", "alt-enter", "none"].includes(sendWithoutReplyShortcut as string)
    || sendShortcut === sendWithoutReplyShortcut) throw new Error("快捷键设置无效或发送组合重复，请检查两种发送方式。");
  if (typeof contextTurns !== "number" || !Number.isInteger(contextTurns) || contextTurns < 0 || contextTurns > 40
    || typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 12 || fontSize > 24
    || typeof renderMarkdown !== "boolean"
    || typeof systemPrompt !== "string" || systemPrompt.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(systemPrompt)) {
    throw new Error("对话设置超出范围，请检查上下文轮数、字号与提示词（最多 4000 字符）。");
  }
  return { sendShortcut, sendWithoutReplyShortcut: sendWithoutReplyShortcut as ChatSettings["sendWithoutReplyShortcut"], contextTurns, systemPrompt, renderMarkdown, fontSize };
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

export function buildRequestHistory(messages: readonly Pick<Message, "role" | "content" | "status" | "savedOnly" | "topicStart" | "attachments" | "toolRounds" | "reasoningContent" | "thinking">[], question: string, contextTurns: number, attachments?: Attachment[]): ChatTurn[] {
  const rounds: ChatTurn[][] = [];
  let pending: ChatTurn | undefined;
  let notes: ChatTurn[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.topicStart) { rounds.length = 0; pending = undefined; notes = []; }
    if (message.status || !message.content.trim()) { pending = undefined; continue; }
    const turn: ChatTurn = { role: message.role, content: message.content };
    if (message.attachments?.length) turn.attachments = message.attachments;
    if (message.role === "assistant") {
      if (message.toolRounds?.length) turn.toolRounds = message.toolRounds;
      if (message.reasoningContent !== undefined) turn.reasoningContent = message.reasoningContent;
      if (message.thinking !== undefined) turn.thinking = message.thinking;
    }
    if (message.role === "user" && message.savedOnly) { notes.push(turn); pending = undefined; }
    else if (message.role === "user") pending = turn;
    else if (pending) { rounds.push([...notes, pending, turn]); notes = []; pending = undefined; }
  }
  const selected = contextTurns > 0 ? rounds.slice(-contextTurns) : [];
  const selectedNotes = contextTurns > 0 ? notes.slice(-99) : [];
  while (selected.length && selected.flat().length + selectedNotes.length > 99) selected.shift();
  const history = [...selected.flat(), ...selectedNotes];
  return [...history, { role: "user", content: question, ...(attachments?.length ? { attachments } : {}) }];
}
