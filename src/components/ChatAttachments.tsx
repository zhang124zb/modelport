import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/attachments";
import { errorMessage, isDesktop, modelport } from "@/lib/modelport";
import { Icon } from "./Icon";

export type AttachmentNoticeData = { title: string; message: string; image?: string };

export function AttachmentNotice({ notice, onClose }: { notice: AttachmentNoticeData; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);
  return <dialog aria-labelledby="attachment-notice-title" aria-describedby="attachment-notice-content" className="attachment-dialog" ref={ref} role="alertdialog"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="attachment-notice-title">{notice.title}</h2><button aria-label="关闭附件提示" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button></header>
    {notice.image && <img alt={notice.title} className="attachment-large-image" src={notice.image} />}
    <pre id="attachment-notice-content">{notice.message}</pre>
    <button autoFocus className="attachment-confirm" onClick={onClose} type="button">知道了</button>
  </dialog>;
}

export function AttachmentMenu({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>(".attachment-menu button")?.focus();
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } };
    window.addEventListener("pointerdown", pointer); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", pointer); window.removeEventListener("keydown", key); };
  }, [open]);
  const read = (input: HTMLInputElement) => { const files = Array.from(input.files ?? []); input.value = ""; if (files.length) onFiles(files); };
  return <div className="attachment-control" ref={rootRef}>
    <button aria-label="添加附件" aria-expanded={open && !disabled} aria-controls="attachment-menu" disabled={disabled} onClick={() => setOpen(current => !current)} ref={buttonRef} title="添加图片或文件" type="button"><Icon name="plus" size={21} /></button>
    {open && !disabled && <div aria-label="附件选项" className="attachment-menu" id="attachment-menu" role="group">
      <button onClick={() => { setOpen(false); imageRef.current?.click(); }} type="button"><Icon name="image" size={20} />添加图片</button>
      <button onClick={() => { setOpen(false); fileRef.current?.click(); }} type="button"><Icon name="folder" size={20} />选择文件</button>
    </div>}
    <input accept=".png,.jpg,.jpeg,.webp" aria-label="选择图片附件" hidden multiple onChange={event => read(event.currentTarget)} ref={imageRef} type="file" />
    <input aria-label="选择聊天文件附件" hidden multiple onChange={event => read(event.currentTarget)} ref={fileRef} type="file" />
  </div>;
}

function AttachmentCard({ attachment, disabled, onRemove, onNotice }: { attachment: Attachment; disabled?: boolean; onRemove?: (id: string) => void; onNotice: (notice: AttachmentNoticeData) => void }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (attachment.kind !== "image" || !isDesktop) return;
    let cancelled = false;
    void modelport.getAttachment(attachment.id).then(record => {
      if (!cancelled) { setImage(`data:image/png;base64,${record.data}`); setError(""); }
    }).catch(reason => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [attachment.id, attachment.kind]);
  const preview = async () => {
    try {
      const record = await modelport.getAttachment(attachment.id);
      onNotice({ title: attachment.filename, message: record.attachment.kind === "text" ? record.data : "图片已缩放到最长边不超过 2048 像素；发送的是本地副本，不会修改原文件。",
        image: record.attachment.kind === "image" ? `data:image/png;base64,${record.data}` : undefined });
    } catch (reason) { onNotice({ title: "附件不可用", message: errorMessage(reason) }); }
  };
  return <div className={`attachment-card${error ? " attachment-missing" : ""}`} data-attachment-id={attachment.id}>
    <button aria-label={`预览附件 ${attachment.filename}`} className="attachment-preview" disabled={disabled} onClick={() => void preview()} title={error || attachment.filename} type="button">
      {image ? <img alt={attachment.filename} src={image} /> : <Icon name={attachment.kind === "image" ? "image" : "document"} size={27} />}
      <span><strong>{attachment.filename}</strong><small>{error ? "附件副本缺失或不可读取" : `${attachment.kind === "image" ? "图片" : "文字资料"} · ${(attachment.bytes / 1024).toFixed(1)} KiB`}</small></span>
    </button>
    {onRemove && <button aria-label={`移除附件 ${attachment.filename}`} className="attachment-remove" disabled={disabled} onClick={() => onRemove(attachment.id)} type="button"><Icon name="close" size={15} /></button>}
  </div>;
}

export function AttachmentList({ attachments, disabled, onRemove, onNotice }: { attachments: readonly Attachment[]; disabled?: boolean; onRemove?: (id: string) => void; onNotice: (notice: AttachmentNoticeData) => void }) {
  return <div aria-label={onRemove ? "待发送附件" : "消息附件"} className="attachment-list">
    {attachments.map(attachment => <AttachmentCard attachment={attachment} disabled={disabled} key={attachment.id} onNotice={onNotice} onRemove={onRemove} />)}
  </div>;
}
