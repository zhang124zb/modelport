import type { ChatTurn, KnowledgeContext, KnowledgeSource, ModelOption, SelectedKnowledge, SelectedSkill } from "@/lib/modelport";
import { normalizeAttachments } from "./attachments.ts";
import { isProviderId } from "./providers.ts";
import { normalizeMcpSelections, normalizeToolRounds, normalizeToolTrace } from "./mcp-history.ts";
import type { McpSelection, ToolTrace } from "./mcp-history.ts";

export type MessageStatus = "streaming" | "stopped" | "failed" | "interrupted";
export type Message = ChatTurn & { id: string; status?: MessageStatus; skill?: SelectedSkill; knowledge?: SelectedKnowledge; retrieval?: KnowledgeContext; savedOnly?: boolean; topicStart?: boolean;
  toolTrace?: ToolTrace[]; mcpModel?: { provider: ModelOption["provider"]; id: string } };
export type Conversation = {
  id: string;
  title: string;
  date: string;
  model: ModelOption;
  messages: Message[];
  skill?: SelectedSkill;
  knowledge?: SelectedKnowledge;
  newTopicPending?: boolean;
  mcp?: McpSelection[];
};

export type ChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

const storageKey = "modelport.chat.v1";
const indexKey = "modelport.chat.v2";
const conversationPrefix = "modelport.chat.v2.conversation.";
const recoveryWarning = "聊天记录读取异常，已暂停保存和发送，原始数据未覆盖。请在常规设置中导出原始记录，再从备份恢复或明确重置。";
let chatStorageError = "";
type StoredConversation = { conversation: Conversation; key: string };
let storedConversations = new Map<string, StoredConversation>();
let storedRecordKeys = new Set<string>();
let lastIndex: string | null = null;
let lastLegacy: string | null = null;
let initialized = false;

export type ChatLoadResult = ChatState & { error?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  if (isRecord(value)) {
    try {
      const attachments = normalizeAttachments(value.attachments); if (attachments?.length && value.role !== "user") return false;
    }
    catch { return false; }
  }
  return isRecord(value)
    && typeof value.id === "string"
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string";
}

function validateToolMetadata(message: Message): void {
  const rounds = normalizeToolRounds(message.toolRounds); const trace = normalizeToolTrace(message.toolTrace);
  if (message.role !== "assistant" && (rounds?.length || trace?.length || message.reasoningContent !== undefined || message.thinking !== undefined)) throw new Error("工具记录只能属于助手消息。");
  for (const field of [message.reasoningContent, message.thinking]) {
    if (field !== undefined && (typeof field !== "string" || field.length > 65536)) throw new Error("工具推理记录无效或过长。");
  }
}

function isModel(value: unknown): value is ModelOption {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && isProviderId(value.provider)
    && typeof value.tone === "string"
    && typeof value.label === "string";
}

function isConversation(value: unknown): value is Conversation {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.date === "string"
    && isModel(value.model)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage);
}

function normalizeMessage(message: Message): Message {
  const normalized: Message = { id: message.id, role: message.role, content: message.content };
  if (message.attachments?.length) normalized.attachments = normalizeAttachments(message.attachments);
  if (message.role === "assistant") {
    try {
      validateToolMetadata(message);
      normalized.toolRounds = normalizeToolRounds(message.toolRounds);
      normalized.toolTrace = normalizeToolTrace(message.toolTrace);
      if (message.reasoningContent !== undefined) normalized.reasoningContent = message.reasoningContent;
      if (message.thinking !== undefined) normalized.thinking = message.thinking;
    } catch {
      // Preserve the conversation text if old or damaged tool metadata cannot be restored.
      normalized.status = "interrupted";
    }
    if (message.mcpModel && isProviderId(message.mcpModel.provider) && typeof message.mcpModel.id === "string" && message.mcpModel.id.length <= 128) {
      normalized.mcpModel = { provider: message.mcpModel.provider, id: message.mcpModel.id };
    }
  }
  if (message.role === "user" && message.savedOnly === true) normalized.savedOnly = true;
  if (message.role === "user" && message.topicStart === true) normalized.topicStart = true;
  normalized.skill = normalizeSkill(message.skill);
  normalized.knowledge = normalizeSkill(message.knowledge);
  normalized.retrieval = normalizeRetrieval(message.retrieval);
  if (message.status === "streaming") normalized.status = "interrupted";
  else if (message.status === "stopped" || message.status === "failed" || message.status === "interrupted") {
    normalized.status = message.status;
  }
  return normalized;
}

function normalizeConversation(conversation: Conversation): Conversation {
  const { id, name, provider, tone, label } = conversation.model;
  return { id: conversation.id, title: conversation.title, date: conversation.date, model: { id, name, provider, tone, label },
    messages: conversation.messages.map(normalizeMessage), skill: normalizeSkill(conversation.skill), knowledge: normalizeSkill(conversation.knowledge),
    newTopicPending: conversation.newTopicPending === true ? true : undefined,
    mcp: (() => { try { return normalizeMcpSelections(conversation.mcp); } catch { return undefined; } })() };
}

function normalizeSkill(value: unknown): SelectedSkill | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length > 64
    || typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision)
    || typeof value.name !== "string" || !value.name || value.name.length > 240) return undefined;
  return { id: value.id, revision: value.revision, name: value.name };
}

function normalizeRetrieval(value: unknown): KnowledgeContext | undefined {
  if (!isRecord(value) || !Array.isArray(value.sources) || value.sources.length > 4) return undefined;
  const base = normalizeSkill(value.base);
  if (!base) return undefined;
  const sources: KnowledgeSource[] = [];
  for (const item of value.sources) {
    if (!isRecord(item) || item.number !== sources.length + 1 || typeof item.documentId !== "string" || item.documentId.length > 64
      || typeof item.documentRevision !== "string" || !/^[a-f0-9]{64}$/.test(item.documentRevision)
      || typeof item.filename !== "string" || item.filename.length > 480 || typeof item.text !== "string" || item.text.length > 2000
      || !Number.isInteger(item.chunkIndex) || (item.chunkIndex as number) < 1 || !Number.isInteger(item.startLine) || (item.startLine as number) < 1
      || !Number.isInteger(item.endLine) || (item.endLine as number) < (item.startLine as number)) return undefined;
    sources.push({ number: item.number as number, documentId: item.documentId, documentRevision: item.documentRevision, filename: item.filename,
      text: item.text, chunkIndex: item.chunkIndex as number, startLine: item.startLine as number, endLine: item.endLine as number });
  }
  return { base, sources };
}

export function loadChatState(): ChatLoadResult {
  chatStorageError = "";
  initialized = true;
  storedConversations = new Map();
  storedRecordKeys = new Set();
  try {
    lastIndex = window.localStorage.getItem(indexKey);
    lastLegacy = window.localStorage.getItem(storageKey);
    if (lastIndex !== null && lastLegacy !== null) chatStorageError = recoveryWarning;
    const stored = lastIndex ?? lastLegacy;
    if (stored === null) return { conversations: [], activeConversationId: null };
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || !Array.isArray(parsed.conversations)) {
      throw new Error("Invalid chat state");
    }
    let conversations: Conversation[];
    if (lastIndex !== null) {
      if (parsed.format !== "modelport-chat-store" || parsed.version !== 2) throw new Error("Invalid chat index");
      conversations = [];
      const ids = new Set<string>();
      for (const entry of parsed.conversations) {
        try {
          if (!isRecord(entry) || typeof entry.id !== "string" || ids.has(entry.id)
            || typeof entry.key !== "string" || !entry.key.startsWith(conversationPrefix)) throw new Error("Invalid chat reference");
          ids.add(entry.id);
          storedRecordKeys.add(entry.key);
          const raw = window.localStorage.getItem(entry.key);
          const value: unknown = raw === null ? null : JSON.parse(raw);
          if (!isConversation(value) || value.id !== entry.id) throw new Error("Invalid stored conversation");
          const conversation = normalizeConversation(value);
          conversations.push(conversation);
          storedConversations.set(conversation.id, { conversation, key: entry.key });
        } catch { chatStorageError = recoveryWarning; }
      }
    } else {
      conversations = parsed.conversations.filter(isConversation).map(normalizeConversation);
    }
    const activeConversationId = typeof parsed.activeConversationId === "string"
      && conversations.some((conversation) => conversation.id === parsed.activeConversationId)
      ? parsed.activeConversationId
      : null;
    if (chatStorageError || conversations.length !== parsed.conversations.length) {
      chatStorageError = recoveryWarning;
      return { conversations, activeConversationId, error: chatStorageError };
    }
    return { conversations, activeConversationId };
  } catch {
    chatStorageError = recoveryWarning;
    return { conversations: [], activeConversationId: null, error: chatStorageError };
  }
}

export function saveChatState(state: ChatState): void {
  if (!initialized) loadChatState();
  // Protect every writer, including a pending save during unmount.
  if (chatStorageError) throw new Error(chatStorageError);
  writeChatState(state);
}

export function readRawChatState(): string {
  const rawIndex = window.localStorage.getItem(indexKey);
  if (rawIndex !== null) {
    const records: Record<string, string | null> = {};
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(conversationPrefix)) records[key] = window.localStorage.getItem(key);
    }
    return JSON.stringify({ format: "modelport-chat-recovery", version: 1,
      index: rawIndex, records, legacy: window.localStorage.getItem(storageKey) }, null, 2);
  }
  const stored = window.localStorage.getItem(storageKey);
  if (stored === null) throw new Error("没有可导出的原始聊天记录；如果存储仍无法读取，请先检查系统存储权限。");
  return stored;
}

// Only an explicitly confirmed recovery/reset may replace protected data.
export function recoverChatState(state: ChatState): void {
  if (!isRecord(state) || !Array.isArray(state.conversations) || !state.conversations.every(isConversation)
    || (state.activeConversationId !== null && (typeof state.activeConversationId !== "string"
      || !state.conversations.some(conversation => conversation.id === state.activeConversationId)))) {
    throw new Error("恢复数据无效，原始记录未修改。");
  }
  writeChatState(state, true);
  chatStorageError = "";
}

export function getChatStorageError(): string { return chatStorageError; }

function writeChatState(state: ChatState, recovery = false): void {
  const storage = window.localStorage;
  const currentLegacy = storage.getItem(storageKey);
  if (!recovery && (storage.getItem(indexKey) !== lastIndex || currentLegacy !== lastLegacy)) {
    chatStorageError = "聊天存储已被其他窗口修改，已暂停保存和发送。请关闭其他窗口后重新打开应用；原始数据未覆盖。";
    throw new Error(chatStorageError);
  }
  const entries = new Map<string, StoredConversation>();
  const oldKeys = new Set(storedRecordKeys);
  if (recovery) {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(conversationPrefix)) oldKeys.add(key);
    }
  }
  const staged: string[] = [];
  let nextIndex: string;
  try {
    for (const conversation of state.conversations) {
      if (entries.has(conversation.id)) throw new Error("存在重复会话标识，尚未保存。");
      const previous = recovery ? undefined : storedConversations.get(conversation.id);
      if (previous?.conversation === conversation) entries.set(conversation.id, previous);
      else {
        const key = conversationPrefix + crypto.randomUUID();
        staged.push(key);
        storage.setItem(key, JSON.stringify(conversation));
        entries.set(conversation.id, { conversation, key });
      }
    }
    nextIndex = JSON.stringify({ format: "modelport-chat-store", version: 2,
      activeConversationId: state.activeConversationId, conversations: [...entries].map(([id, entry]) => ({ id, key: entry.key })) });
    // Commit the index last: failed writes always leave the previous records readable.
    if (!recovery && (storage.getItem(indexKey) !== lastIndex || storage.getItem(storageKey) !== lastLegacy)) {
      chatStorageError = "聊天存储已被其他窗口修改，已暂停保存和发送。请重新打开本窗口；原始记录未覆盖。";
      throw new Error(chatStorageError);
    }
    if (nextIndex !== lastIndex) storage.setItem(indexKey, nextIndex);
  } catch (error) {
    for (const key of staged) { try { storage.removeItem?.(key); } catch { /* Uncommitted records are never read. */ } }
    throw error;
  }
  const retained = new Set([...entries.values()].map(entry => entry.key));
  for (const key of oldKeys) {
    if (!retained.has(key)) { try { storage.removeItem?.(key); } catch { /* A leftover record cannot hide the committed data. */ } }
  }
  let legacyAfterCommit = currentLegacy;
  try { if ((lastIndex === null || recovery) && storage.removeItem) { storage.removeItem(storageKey); legacyAfterCommit = null; } } catch { /* Keep legacy data if cleanup is unavailable. */ }
  storedConversations = entries;
  storedRecordKeys = retained;
  lastIndex = nextIndex;
  lastLegacy = legacyAfterCommit;
  initialized = true;
}

export function withoutEmptyAssistantMessages(conversations: Conversation[]): Conversation[] {
  return conversations.map(conversation => {
    const messages = conversation.messages.filter(message => message.role !== "assistant" || message.content.length > 0 || message.toolTrace?.length || message.toolRounds?.length);
    return messages.length === conversation.messages.length ? conversation : { ...conversation, messages };
  });
}

export const maxChatBackupBytes = 10 * 1024 * 1024;
export function serializeChatBackup(state: ChatState): string {
  const text = JSON.stringify({ format: "modelport-chat-backup", version: 1, attachmentsIncluded: false, exportedAt: new Date().toISOString(),
    conversations: state.conversations.map(normalizeConversation) }, null, 2);
  if (new Blob([text]).size > maxChatBackupBytes) throw new Error("聊天备份超过 10 MiB，暂不支持导出，请先减少记录。");
  return text;
}
export function parseChatBackup(text: string): Conversation[] {
  if (text.length > maxChatBackupBytes || new Blob([text]).size > maxChatBackupBytes) throw new Error("聊天备份超过 10 MiB。");
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("不是有效的 JSON 聊天备份。"); }
  if (!isRecord(parsed) || parsed.format !== "modelport-chat-backup" || parsed.version !== 1 || !Array.isArray(parsed.conversations)
    || parsed.conversations.length > 5000 || !parsed.conversations.every(isConversation)) throw new Error("备份格式或会话内容无效；仅支持 ModelPort v1 聊天备份。");
  const ids = new Set<string>(); let messageCount = 0;
  for (const conversation of parsed.conversations) {
    for (const message of conversation.messages) validateToolMetadata(message);
    messageCount += conversation.messages.length;
    if (!conversation.id || ids.has(conversation.id) || conversation.id.length > 128 || conversation.title.length > 1000 || conversation.date.length > 100
      || conversation.model.id.length > 240 || conversation.model.name.length > 240 || !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(conversation.model.tone) || conversation.model.label.length > 20
      || new Set(conversation.messages.map(message => message.id)).size !== conversation.messages.length
      || conversation.messages.some(message => !message.id || message.id.length > 128 || message.content.length > 200000
        || (message.status !== undefined && !["streaming", "stopped", "failed", "interrupted"].includes(message.status)))
      || messageCount > 20000) throw new Error("备份存在重复标识或内容超出导入范围；原聊天未修改。");
    ids.add(conversation.id);
  }
  // Imported data cannot grant service permissions; tool history remains inert.
  return parsed.conversations.map(conversation => ({ ...normalizeConversation(conversation), mcp: undefined }));
}
export function mergeImportedChats(current: readonly Conversation[], imported: readonly Conversation[]): Conversation[] {
  // Import as copies: IDs never collide and repeated imports never overwrite an existing chat.
  return [...imported.map(conversation => ({ ...normalizeConversation(conversation), mcp: undefined, id: crypto.randomUUID(),
    messages: conversation.messages.map(message => ({ ...normalizeMessage(message), id: crypto.randomUUID() })) })), ...current];
}
