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

export function loadChatState(): ChatState {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return { conversations: [], activeConversationId: null };
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || !Array.isArray(parsed.conversations)) {
      return { conversations: [], activeConversationId: null };
    }
    const conversations = parsed.conversations.filter(isConversation).map(normalizeConversation);
    const activeConversationId = typeof parsed.activeConversationId === "string"
      && conversations.some((conversation) => conversation.id === parsed.activeConversationId)
      ? parsed.activeConversationId
      : null;
    return { conversations, activeConversationId };
  } catch {
    return { conversations: [], activeConversationId: null };
  }
}

export function saveChatState(state: ChatState): void {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
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
