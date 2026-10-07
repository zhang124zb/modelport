import type { ChatTurn, KnowledgeContext, KnowledgeSource, ModelOption, ProviderId, SelectedKnowledge, SelectedSkill } from "@/lib/modelport";

export type MessageStatus = "streaming" | "stopped" | "failed" | "interrupted";
export type Message = ChatTurn & { id: string; status?: MessageStatus; skill?: SelectedSkill; knowledge?: SelectedKnowledge; retrieval?: KnowledgeContext };
export type Conversation = {
  id: string;
  title: string;
  date: string;
  model: ModelOption;
  messages: Message[];
  skill?: SelectedSkill;
  knowledge?: SelectedKnowledge;
};

type ChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

const storageKey = "modelport.chat.v1";
const providers: ProviderId[] = ["openai", "deepseek", "ollama"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string";
}

function isModel(value: unknown): value is ModelOption {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && providers.includes(value.provider as ProviderId)
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
  normalized.skill = normalizeSkill(message.skill);
  normalized.knowledge = normalizeSkill(message.knowledge);
  normalized.retrieval = normalizeRetrieval(message.retrieval);
  if (message.status === "streaming") normalized.status = "interrupted";
  else if (message.status === "stopped" || message.status === "failed" || message.status === "interrupted") {
    normalized.status = message.status;
  }
  return normalized;
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
    const conversations = parsed.conversations.filter(isConversation).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map(normalizeMessage),
      skill: normalizeSkill(conversation.skill),
      knowledge: normalizeSkill(conversation.knowledge),
    }));
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
