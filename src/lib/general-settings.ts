export type GeneralSettings = {
  theme: "light" | "dark" | "system";
  animations: boolean;
  startup: "last-conversation" | "new-chat";
  sidebar: "expanded" | "collapsed";
};
export const defaultGeneralSettings: GeneralSettings = { theme: "light", animations: true, startup: "last-conversation", sidebar: "expanded" };
const storageKey = "modelport.preferences.general.v1";

export function validateGeneralSettings(value: unknown): GeneralSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("常规设置格式无效。");
  const record = value as Record<string, unknown>;
  const theme = record.theme === undefined ? defaultGeneralSettings.theme : record.theme;
  const animations = record.animations === undefined ? defaultGeneralSettings.animations : record.animations;
  const startup = record.startup === undefined ? defaultGeneralSettings.startup : record.startup;
  const sidebar = record.sidebar === undefined ? defaultGeneralSettings.sidebar : record.sidebar;
  if ((theme !== "light" && theme !== "dark" && theme !== "system") || typeof animations !== "boolean"
    || (startup !== "last-conversation" && startup !== "new-chat") || (sidebar !== "expanded" && sidebar !== "collapsed")) throw new Error("常规设置选项无效，请检查外观和启动行为。");
  return { theme, animations, startup, sidebar };
}
export function loadGeneralSettings(): { settings: GeneralSettings; error: string } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw && raw.length > 4000) throw new Error("配置过大。");
    return { settings: raw ? validateGeneralSettings(JSON.parse(raw)) : { ...defaultGeneralSettings }, error: "" };
  } catch { return { settings: { ...defaultGeneralSettings }, error: "无法读取常规设置，暂用默认值；原数据未覆盖。检查并保存可重新建立配置。" }; }
}
export function saveGeneralSettings(settings: GeneralSettings): GeneralSettings {
  const validated = validateGeneralSettings(settings);
  try { window.localStorage.setItem(storageKey, JSON.stringify(validated)); }
  catch { throw new Error("无法保存常规设置，请检查本机存储空间；本次修改尚未生效。"); }
  return validated;
}
export function resolveTheme(theme: GeneralSettings["theme"], systemDark: boolean): "light" | "dark" {
  return theme === "system" ? systemDark ? "dark" : "light" : theme;
}
