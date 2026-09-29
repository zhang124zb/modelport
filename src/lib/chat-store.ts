import type { ChatTurn, ModelOption, ProviderId } from "@/lib/modelport";

export type MessageStatus = "streaming" | "stopped" | "failed" | "interrupted";
export type Message = ChatTurn & { id: string; status?: MessageStatus };
export type Conversation = {
  id: string;
  title: string;
  date: string;
  model: ModelOption;
  messages: Message[];
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
  if (message.status === "streaming") normalized.status = "interrupted";
  else if (message.status === "stopped" || message.status === "failed" || message.status === "interrupted") {
    normalized.status = message.status;
  }
  return normalized;
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
