import { Channel, invoke } from "@tauri-apps/api/core";

export type ProviderId = "openai" | "deepseek" | "ollama";

export type ModelOption = {
  id: string;
  name: string;
  provider: ProviderId;
  tone: string;
  label: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type StreamChatResult = {
  status: "completed" | "cancelled" | "failed";
  content: string;
  error?: string;
};

export const isDesktop = "__TAURI_INTERNALS__" in window;

export const providerDetails: Record<ProviderId, {
  name: string;
  description: string;
  letter: string;
  tone: string;
}> = {
  openai: { name: "OpenAI", description: "GPT 系列与官方 API", letter: "O", tone: "#17211b" },
  deepseek: { name: "DeepSeek", description: "DeepSeek 官方 API", letter: "D", tone: "#5368ff" },
  ollama: { name: "Ollama", description: "本机 127.0.0.1:11434", letter: "Q", tone: "#111827" },
};

export const defaultModels: ModelOption[] = [
  { id: "deepseek-flash", name: "DeepSeek Flash", provider: "deepseek", tone: "#5368ff", label: "D" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", tone: "#5368ff", label: "D" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", tone: "#17211b", label: "O" },
];

export function modelOption(provider: ProviderId, id: string): ModelOption {
  const detail = providerDetails[provider];
  return { id, name: id, provider, tone: detail.tone, label: detail.letter };
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试。";
}

export const modelport = {
  hasKey: (provider: ProviderId) => invoke<boolean>("has_provider_key", { provider }),
  saveKey: (provider: ProviderId, key: string) => invoke<void>("save_provider_key", { provider, key }),
  removeKey: (provider: ProviderId) => invoke<void>("remove_provider_key", { provider }),
  listModels: (provider: ProviderId) => invoke<string[]>("list_available_models", { provider }),
  sendChat: (provider: ProviderId, model: string, messages: ChatTurn[]) =>
    invoke<string>("send_chat", { provider, model, messages }),
  streamChat: (provider: ProviderId, model: string, messages: ChatTurn[], requestId: string, onDelta: (delta: string) => void) => {
    const onEvent = new Channel<string>();
    onEvent.onmessage = onDelta;
    return invoke<StreamChatResult>("stream_chat", { provider, model, messages, requestId, onEvent });
  },
  cancelChat: (requestId: string) => invoke<void>("cancel_chat", { requestId }),
};
