export type Attachment = { id: string; filename: string; kind: "image" | "text"; bytes: number };
export type AttachmentRecord = { attachment: Attachment; data: string };
export const maxAttachments = 4;
export const maxImageBytes = 4 * 1024 * 1024;
export const maxTextBytes = 128 * 1024;

export function normalizeAttachments(value: unknown): Attachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxAttachments) throw new Error("附件列表无效，每条消息最多 4 个附件。");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("附件信息无效。");
    const { id, filename, kind, bytes } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || ids.has(id)
      || typeof filename !== "string" || !filename.trim() || [...filename].length > 240 || /[\\/\u0000-\u001f\u007f-\u009f]/.test(filename)
      || (kind !== "image" && kind !== "text") || typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1
      || bytes > (kind === "image" ? maxImageBytes : maxTextBytes)) throw new Error("附件信息无效或超出范围。");
    ids.add(id); return { id, filename, kind, bytes };
  });
}

export function fileKind(file: Pick<File, "name" | "type">): "image" | "text" | "video" | "unsupported" {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv|m4v|mpeg|mpg|wmv)$/i.test(file.name)) return "video";
  if (/\.(png|jpe?g|webp)$/i.test(file.name)) return "image";
  if (/\.(txt|md|markdown)$/i.test(file.name)) return "text";
  return "unsupported";
}

export async function readAttachment(file: File): Promise<{ filename: string; kind: "image" | "text"; data: string }> {
  const kind = fileKind(file);
  if (kind === "video") throw new Error("当前版本尚未接入视频识别，请改用截图；不会把视频当作图片发送。");
  if (kind === "unsupported") throw new Error("仅支持 PNG / JPEG / WebP 静态图片和 UTF-8 TXT / Markdown；PDF / Word 暂不支持。");
  if (!file.size || file.size > (kind === "image" ? 8 * 1024 * 1024 : maxTextBytes)) throw new Error(kind === "image" ? "原图片不能为空或超过 8 MiB。" : "文字附件不能为空或超过 128 KiB。");
  if (kind === "text") {
    let data: string;
    try { data = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error("文字附件无法按 UTF-8 读取，请先转换编码后再添加。"); }
    if (!data.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(data)) throw new Error("请选择非空 UTF-8 文本，不支持二进制文件。");
    return { filename: file.name, kind, data };
  }
  // Native canvas is already available; normalize formats and bound the saved/sent dimensions.
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("图片损坏或格式不受支持，请选择有效的 PNG / JPEG / WebP 图片。"); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 24_000_000) throw new Error("图片不能超过 2400 万像素，请先缩小后添加。");
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片，请重试。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/png").split(",")[1];
    if (!data || data.length > Math.ceil(maxImageBytes / 3) * 4) throw new Error("处理后的图片超过 4 MiB，请先缩小图片。");
    return { filename: file.name, kind, data };
  } finally { bitmap.close(); }
}

export function attachmentIds(conversations: readonly { messages: readonly { attachments?: readonly Attachment[] }[] }[], drafts: readonly Attachment[] = []): string[] {
  return [...new Set([...drafts.map(item => item.id), ...conversations.flatMap(chat => chat.messages.flatMap(message => message.attachments?.map(item => item.id) ?? []))])];
}
