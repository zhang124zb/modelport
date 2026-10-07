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

export type SkillReference = { id: string; revision: string };
export type SelectedSkill = SkillReference & { name: string };
export type GitHubOrigin = { repository: string; path: string; commit: string; documentHash: string };
export type SkillSummary = SkillReference & {
  name: string; displayName: string; description: string; enabled: boolean; source: string; compatibility: string | null; github: GitHubOrigin | null;
};
export type SkillRecord = { summary: SkillSummary; document: string };
export type SkillPreview = { name: string; description: string; compatibility: string | null; body: string };
export type GitHubSkillPreview = { origin: GitHubOrigin; document: string; preview: SkillPreview };
export type SkillSettingsProps = {
  skills: readonly SkillSummary[]; skillsLoading: boolean; skillsError: string; onSkillsChanged: () => Promise<void>;
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
  { id: "", name: "Ollama（选择本地模型）", provider: "ollama", tone: "#111827", label: "Q" },
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
  sendChat: (provider: ProviderId, model: string, messages: ChatTurn[], skill: SkillReference | null = null) =>
    invoke<string>("send_chat", { provider, model, messages, skill }),
  streamChat: (provider: ProviderId, model: string, messages: ChatTurn[], requestId: string, onDelta: (delta: string) => void, skill: SkillReference | null = null) => {
    const onEvent = new Channel<string>();
    onEvent.onmessage = onDelta;
    return invoke<StreamChatResult>("stream_chat", { provider, model, messages, requestId, onEvent, skill });
  },
  cancelChat: (requestId: string) => invoke<void>("cancel_chat", { requestId }),
  listSkills: () => invoke<SkillSummary[]>("list_skills"),
  previewSkill: (document: string) => invoke<SkillPreview>("preview_skill", { document }),
  previewGitHubSkill: (repository: string, gitRef: string, path: string) =>
    invoke<GitHubSkillPreview>("preview_github_skill", { repository, gitRef, path }),
  installGitHubSkill: (origin: GitHubOrigin, displayName: string, id: string | null = null, expectedRevision: string | null = null) =>
    invoke<SkillRecord>("install_github_skill", { origin, displayName, id, expectedRevision }),
  getSkill: (id: string) => invoke<SkillRecord>("get_skill", { id }),
  saveSkill: (document: string, displayName: string, imported: boolean, id: string | null = null, expectedRevision: string | null = null) =>
    invoke<SkillRecord>("save_skill", { document, displayName, imported, id, expectedRevision }),
  setSkillEnabled: (skill: SkillReference, enabled: boolean) => invoke<SkillSummary>("set_skill_enabled", { skill, enabled }),
  removeSkill: (skill: SkillReference) => invoke<void>("remove_skill", { skill }),
};
