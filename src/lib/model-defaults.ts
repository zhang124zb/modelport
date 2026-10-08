import type { ModelOption } from "./modelport";

export type ModelReference = Pick<ModelOption, "provider" | "id">;
export type ModelDefaults = { chatModel: ModelReference | null };
export const defaultModelSettings: ModelDefaults = { chatModel: null };
const storageKey = "modelport.preferences.models.v1";

export function validateModelDefaults(value: unknown): ModelDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("默认模型设置格式无效。");
  const reference = (value as Record<string, unknown>).chatModel;
  if (reference === null || reference === undefined) return { chatModel: null };
  if (typeof reference !== "object" || Array.isArray(reference)) throw new Error("默认模型选择无效。");
  const { provider, id } = reference as Record<string, unknown>;
  if ((provider !== "ollama" && provider !== "openai" && provider !== "deepseek") || typeof id !== "string"
    || !id.trim() || id.length > 240 || /[\u0000-\u001f\u007f-\u009f]/.test(id)) throw new Error("默认模型提供方或模型标识无效。");
  return { chatModel: { provider, id } };
}
export function loadModelDefaults(): { settings: ModelDefaults; error: string } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw && raw.length > 4000) throw new Error("配置过大。");
    return { settings: raw ? validateModelDefaults(JSON.parse(raw)) : { chatModel: null }, error: "" };
  } catch { return { settings: { chatModel: null }, error: "无法读取默认模型设置，原数据未覆盖。请在“默认模型”检查并保存后再发起新对话。" }; }
}
export function saveModelDefaults(settings: ModelDefaults): ModelDefaults {
  const validated = validateModelDefaults(settings);
  try { window.localStorage.setItem(storageKey, JSON.stringify(validated)); }
  catch { throw new Error("无法保存默认模型，请检查本机存储空间；本次修改尚未生效。"); }
  return validated;
}
export function resolveDefaultModel(settings: ModelDefaults, choices: readonly ModelReference[]): ModelReference {
  return settings.chatModel ?? choices.find(model => model.provider === "ollama" && model.id) ?? { provider: "ollama", id: "" };
}
