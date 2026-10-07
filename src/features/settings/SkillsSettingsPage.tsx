import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/Icon";
import { errorMessage, isDesktop, modelport } from "@/lib/modelport";
import type { SkillPreview, SkillRecord } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";

type Editor = { id: string | null; revision: string | null; document: string; displayName: string; imported: boolean; baseline: string };
const emptyDocument = "---\nname: my-skill\ndescription: \"\"\n---\n";
const templates = [
  { name: "翻译助手", slug: "translation", description: "将用户提供的文字翻译为指定语言，保留原意和格式。", body: "先确认目标语言，未指定时先询问。保持人名、数字、术语和段落格式。仅输出译文；遇到歧义时附简短说明，不编造原文没有的信息。" },
  { name: "文章润色", slug: "writing", description: "改进用户提供的文章表达，不改变事实与作者立场。", body: "保留原文事实、数字和立场。改善语句流畅性和结构，避免夸大或添加未经证实的信息。先给出润色稿，再列出主要修改点。" },
  { name: "代码审阅", slug: "code-review", description: "审阅用户粘贴的代码，找出问题并给出可操作的修改建议。", body: "只审阅用户提供的代码，不声称读取了本机文件或运行了测试。优先检查正确性、边界处理和安全问题。说明具体位置、原因和最小修改方案；不确定的结论明确标注。" },
];
const fingerprint = (document: string, displayName: string) => JSON.stringify([document, displayName]);
const canDiscard = ({ dirty, busy }: { dirty: boolean; busy: boolean }) => !busy && (!dirty || window.confirm("技能有未保存的内容，确定放弃修改吗？"));
const fromRecord = (record: SkillRecord): Editor => ({ id: record.summary.id, revision: record.summary.revision,
  document: record.document, displayName: record.summary.displayName, imported: false,
  baseline: fingerprint(record.document, record.summary.displayName) });

export function SkillsSettingsPage({ skills, skillsLoading, skillsError, onSkillsChanged, onRegisterLeaveGuard }: SettingsPageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = editor !== null && fingerprint(editor.document, editor.displayName) !== editor.baseline;
  const leaveState = useRef({ dirty, busy }); leaveState.current = { dirty, busy };
  const canLeave = () => canDiscard(leaveState.current);
  useEffect(() => {
    onRegisterLeaveGuard?.(() => canDiscard(leaveState.current));
    let disposed = false;
    let stopListening: (() => void) | undefined;
    if (isDesktop) void getCurrentWindow().onCloseRequested((event) => {
      if (!canDiscard(leaveState.current)) event.preventDefault();
    }).then((stop) => { if (disposed) stop(); else stopListening = stop; })
      .catch(() => { if (!disposed) setNotice("无法启用窗口关闭保护，请保存技能后再关闭软件。"); });
    return () => { disposed = true; stopListening?.(); onRegisterLeaveGuard?.(null); };
  }, [onRegisterLeaveGuard]);
  const visible = skills.filter((skill) => (filter === "all" || skill.enabled === (filter === "enabled"))
    && `${skill.displayName} ${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = skills.find((skill) => skill.id === editor?.id);

  const changeEditor = (next: Editor) => { setEditor(next); setPreview(null); setNotice(""); };
  const create = (document = emptyDocument, displayName = "") => {
    if (!canLeave()) return;
    changeEditor({ id: null, revision: null, document, displayName, imported: false, baseline: fingerprint(emptyDocument, "") });
  };
  const open = async (id: string) => {
    if (!canLeave()) return; setBusy(true); setNotice("");
    try { changeEditor(fromRecord(await modelport.getSkill(id))); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !canLeave()) return;
    if (file.name.toLowerCase() !== "skill.md") { setNotice("请选择单个 SKILL.md 文件；暂不导入目录或压缩包。"); return; }
    if (file.size > 128 * 1024) { setNotice("技能文件不能超过 128 KiB。"); return; }
    setBusy(true); setNotice("");
    try {
      const document = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const parsed = await modelport.previewSkill(document);
      changeEditor({ id: null, revision: null, document, displayName: parsed.name, imported: true, baseline: "" });
      setPreview(parsed); setNotice("导入预览已就绪，检查内容后点击保存。保存后默认禁用，不会修改原文件。");
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const validate = async () => {
    if (!editor) return; setBusy(true); setNotice("");
    try { setPreview(await modelport.previewSkill(editor.document)); setNotice("格式检查通过。仅支持指令正文，不执行脚本或读取关联文件。"); }
    catch (error) { setPreview(null); setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!editor) return; setBusy(true); setNotice("");
    try {
      const parsed = await modelport.previewSkill(editor.document);
      let id = editor.id; let revision = editor.revision;
      const conflict = skills.find((skill) => skill.name === parsed.name && skill.id !== id);
      if (conflict) {
        if (!editor.imported) throw new Error("已有同名技能，请修改 YAML 中的 name。");
        if (!window.confirm(`已有“${conflict.displayName}”。确定用导入内容替换吗？替换后会禁用，需重新审阅启用。`)) return;
        id = conflict.id; revision = conflict.revision;
      }
      const record = await modelport.saveSkill(editor.document, editor.displayName, editor.imported, id, revision);
      setEditor(fromRecord(record)); setPreview(parsed); await onSkillsChanged();
      setNotice(record.summary.enabled ? "技能已保存。已绑定的会话使用新版前会提示确认。" : "技能已保存，请审阅后启用，再到聊天区选择使用。");
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!selected || dirty) return;
    if (!selected.enabled && !window.confirm("确认已审阅该技能并启用？选择云端模型时，技能正文会发送给对应模型服务商；不会授予任何本机执行权限。")) return;
    setBusy(true); setNotice("");
    try { await modelport.setSkillEnabled(selected, !selected.enabled); await onSkillsChanged(); setNotice(selected.enabled ? "已禁用。后续请求不再使用此技能。" : "已启用，可到聊天输入区选择。"); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || !canLeave() || !window.confirm(`删除“${selected.displayName}”？导入原文件和聊天记录会保留。`)) return;
    setBusy(true); setNotice("");
    try { await modelport.removeSkill(selected); setEditor(null); setPreview(null); await onSkillsChanged(); setNotice("技能已删除，原文件和聊天记录未更改。"); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };

  return (
    <div className="skills-page">
      <div className="skills-actions">
        <span>{skills.length} 个技能 · {skills.filter((skill) => skill.enabled).length} 个已启用</span>
        <button disabled={busy || !isDesktop || Boolean(skillsError)} onClick={() => create()} type="button"><Icon name="plus" size={17} />新建技能</button>
        <button disabled={busy || !isDesktop || Boolean(skillsError)} onClick={() => fileRef.current?.click()} type="button"><Icon name="file" size={17} />导入技能</button>
        <input accept=".md" aria-label="导入 SKILL.md 文件" hidden onChange={(event) => void importFile(event)} ref={fileRef} type="file" />
      </div>
      <p className="skills-boundary">仅使用 SKILL.md 指令正文；不会运行 scripts/、读取 references/ 或 assets/，也不会按 allowed-tools 授予权限。云端模型会收到选中技能的正文。更换技能建议新建对话，避免旧回复影响结果。</p>
      {skillsError && <div className="skills-notice" role="alert">{skillsError}<button disabled={busy} onClick={() => void onSkillsChanged()} type="button">重新读取</button></div>}
      {notice && <p className="skills-notice" role="status">{notice}</p>}
      <div className="skills-filters">
        <input aria-label="搜索技能" onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或用途" type="search" value={query} />
        <select aria-label="筛选技能" onChange={(event) => setFilter(event.target.value)} value={filter}><option value="all">全部技能</option><option value="enabled">已启用</option><option value="disabled">已禁用</option></select>
      </div>
      <div className="skills-layout">
        <div aria-label="技能列表" className="skills-list">
          {skillsLoading && <p>正在读取技能…</p>}
          {visible.map((skill) => <button aria-pressed={editor?.id === skill.id} className={editor?.id === skill.id ? "is-active" : ""} disabled={busy} key={skill.id} onClick={() => void open(skill.id)} type="button">
            <strong>{skill.displayName}</strong><span>{skill.description}</span><small>{skill.enabled ? "已启用" : "已禁用"}{skill.compatibility ? " · 有兼容要求" : ""}</small>
          </button>)}
          {!skillsLoading && !skillsError && visible.length === 0 && <p>{skills.length ? "没有匹配的技能。" : "还没有技能，可新建或导入。"}</p>}
        </div>
        {editor ? <div className="skills-editor">
          <label>显示名称<input aria-label="技能显示名称" disabled={busy} maxLength={120} onChange={(event) => { setEditor({ ...editor, displayName: event.target.value }); }} value={editor.displayName} /></label>
          <label>SKILL.md 原文<textarea aria-label="技能指令文件" disabled={busy} onChange={(event) => { setEditor({ ...editor, document: event.target.value }); setPreview(null); }} spellCheck={false} value={editor.document} /></label>
          <small>{selected ? `${selected.source} · 版本 ${selected.revision.slice(0, 8)}` : editor.imported ? "导入预览 · 尚未保存" : "新建技能 · 尚未保存"}{dirty ? " · 有未保存修改" : ""}</small>
          <div className="skills-editor-actions">
            <button disabled={busy || Boolean(skillsError)} onClick={() => void save()} type="button">保存技能</button>
            <button disabled={busy} onClick={() => void validate()} type="button">检查并预览</button>
            {selected && <><button disabled={busy || dirty} onClick={() => void toggle()} type="button">{selected.enabled ? "禁用技能" : "启用技能"}</button><button className="skills-delete" disabled={busy} onClick={() => void remove()} type="button">删除技能</button></>}
          </div>
          {preview && <section aria-label="技能预览" className="skills-preview"><h4>{preview.name}</h4><p>{preview.description}</p>{preview.compatibility && <p>兼容要求：{preview.compatibility}</p>}<pre>{preview.body}</pre></section>}
        </div> : <div className="skills-start"><Icon name="wand" size={30} /><h4>把常用的任务方法变成技能</h4><p>选择一个技能查看内容，或从模板创建自己的技能。模板不会自动启用。</p>
          {templates.map((template) => <button disabled={busy || !isDesktop || Boolean(skillsError)} key={template.slug} onClick={() => create(`---\nname: ${template.slug}\ndescription: ${template.description}\n---\n${template.body}`, template.name)} type="button">从“{template.name}”创建</button>)}
        </div>}
      </div>
    </div>
  );
}
