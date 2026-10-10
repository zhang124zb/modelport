export const builtinProviderIds = ["ollama", "openai", "deepseek", "gemini", "anthropic", "qwen", "moonshot"] as const;
export type BuiltinProviderId = typeof builtinProviderIds[number];
export type ProviderId = BuiltinProviderId | `custom-${string}`;
export type ProviderConfig = { id: ProviderId; name: string; baseUrl: string; chatPath: string; models: string[]; networkCompatibility: boolean };
export const isCustomProvider = (id: string): id is `custom-${string}` => /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export const isProviderId = (id: unknown): id is ProviderId => typeof id === "string" && (builtinProviderIds.some(value => value === id) || isCustomProvider(id));

export const providerDetails: Record<BuiltinProviderId, { name: string; description: string; letter: string; tone: string; guide: string }> = {
  ollama: { name: "Ollama", description: "本机模型，无需 API Key", letter: "O", tone: "#111827", guide: "https://docs.ollama.com/quickstart" },
  openai: { name: "OpenAI", description: "GPT 系列与官方 API", letter: "O", tone: "#17211b", guide: "https://platform.openai.com/api-keys" },
  deepseek: { name: "DeepSeek", description: "DeepSeek 官方 API", letter: "D", tone: "#5368ff", guide: "https://api-docs.deepseek.com/" },
  gemini: { name: "Google Gemini", description: "Google AI Studio API", letter: "G", tone: "#4285f4", guide: "https://ai.google.dev/gemini-api/docs/openai" },
  anthropic: { name: "Anthropic Claude", description: "Claude 原生 Messages API", letter: "A", tone: "#c87958", guide: "https://platform.claude.com/docs/en/api/overview" },
  qwen: { name: "通义千问 · 阿里云百炼", description: "北京地域 OpenAI 兼容接口", letter: "Q", tone: "#7554d9", guide: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope" },
  moonshot: { name: "Kimi · Moonshot", description: "月之暗面官方 API", letter: "K", tone: "#222733", guide: "https://platform.kimi.com/docs/api/chat" },
};
export function providerInfo(id: ProviderId, configs: readonly ProviderConfig[] = []) {
  if (!isCustomProvider(id)) return providerDetails[id as BuiltinProviderId];
  return { name: configs.find(config => config.id === id)?.name ?? "自定义提供商", description: "OpenAI API 兼容", letter: "C", tone: "#657d92", guide: "" };
}
export const defaultProviderConfigs: ProviderConfig[] = [
  { id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", chatPath: "/api/chat", models: [], networkCompatibility: false },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", chatPath: "/chat/completions", models: ["gpt-4.1"], networkCompatibility: false },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", chatPath: "/chat/completions", models: ["deepseek-flash", "deepseek-v4-pro"], networkCompatibility: false },
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", chatPath: "/chat/completions", models: [], networkCompatibility: false },
  { id: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", chatPath: "/messages", models: [], networkCompatibility: false },
  { id: "qwen", name: "通义千问 · 阿里云百炼", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", chatPath: "/chat/completions", models: [], networkCompatibility: false },
  { id: "moonshot", name: "Kimi · Moonshot", baseUrl: "https://api.moonshot.cn/v1", chatPath: "/chat/completions", models: [], networkCompatibility: false },
];
export const endpointPreview = (config: Pick<ProviderConfig, "baseUrl" | "chatPath">) => `${config.baseUrl.replace(/\/+$/, "")}${config.chatPath}`;
