import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { errorMessage, isDesktop, modelport } from "@/lib/modelport";
import type { KnowledgeContext, KnowledgeRecord } from "@/lib/modelport";
import type { SettingsPageProps } from "./pages";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";

export function KnowledgeSettingsPage({ knowledgeBases, knowledgeLoading, knowledgeError, onKnowledgeChanged, onRegisterLeaveGuard }: SettingsPageProps) {
  const [record, setRecord] = useState<KnowledgeRecord | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<KnowledgeContext | null>(null);
  const [document, setDocument] = useState<{ filename: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = creating ? Boolean(name) : Boolean(record && name !== record.summary.name);
  const canLeave = useSettingsLeaveGuard({ dirty, busy, message: "知识库名称有未保存的修改，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });
  const blocked = busy || knowledgeLoading || !isDesktop || Boolean(knowledgeError);
  const showRecord = (next: KnowledgeRecord) => { setRecord(next); setName(next.summary.name); setCreating(false); setResult(null); setDocument(null); };
  const open = async (id: string) => {
    if (knowledgeLoading || !canLeave()) return; setBusy(true); setNotice("");
    try { showRecord(await modelport.getKnowledgeBase(id)); } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const save = async (event?: FormEvent) => {
    event?.preventDefault(); if (blocked) return; setBusy(true); setNotice("");
    try { showRecord(await modelport.saveKnowledgeBase(name, creating ? null : record?.summary ?? null)); await onKnowledgeChanged(); setNotice("知识库已保存。先导入资料、检索预览，再审阅启用。"); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!record || !files.length || !canLeave()) return;
    if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 2 * 1024 * 1024) { setNotice("每批最多 20 个文件，总大小最多 2 MiB。"); return; }
    if (files.some(file => file.size > 512 * 1024 || !/\.(txt|md|markdown)$/i.test(file.name))) { setNotice("请选择不超过 512 KiB 的 TXT / Markdown 文件；PDF / Word 暂不支持。"); return; }
    const conflicts = files.filter(file => record.documents.some(doc => doc.filename.toLowerCase() === file.name.toLowerCase()));
    if (conflicts.length && !window.confirm(`存在 ${conflicts.length} 个同名文件，确定替换？整批保存后知识库会禁用，需重新审阅启用。`)) return;
    setBusy(true); setNotice("");
    try {
      const documents = await Promise.all(files.map(async file => ({ filename: file.name, text: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) })));
      showRecord(await modelport.importKnowledgeDocuments(record.summary, documents, Boolean(conflicts.length)));
      await onKnowledgeChanged(); setNotice("资料已导入并完成分段。知识库默认禁用，可先测试检索，再审阅启用。原文件未修改。");
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!record || dirty || blocked) return;
    if (!record.summary.enabled && !window.confirm("确认已审阅资料并启用？聊天中选择云端模型时，命中的资料片段会发送给对应服务商；不会上传整个知识库或授予文件执行权限。")) return;
    setBusy(true); setNotice("");
    try { const summary = await modelport.setKnowledgeEnabled(record.summary, !record.summary.enabled); setRecord({ ...record, summary }); await onKnowledgeChanged(); setNotice(summary.enabled ? "已启用，请到聊天区选择此知识库。" : "已禁用，后续聊天不再使用。"); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const remove = async (documentId?: string) => {
    if (!record || !canLeave()) return;
    const label = documentId ? record.documents.find(doc => doc.id === documentId)?.filename : record.summary.name;
    if (!window.confirm(`删除“${label}”？只移除本地库副本，原文件、聊天和历史来源片段保留。`)) return;
    setBusy(true); setNotice("");
    try {
      if (documentId) { await modelport.removeKnowledgeDocument(record.summary, documentId); showRecord(await modelport.getKnowledgeBase(record.summary.id)); }
      else { await modelport.removeKnowledgeBase(record.summary); setRecord(null); setName(""); setResult(null); setDocument(null); }
      await onKnowledgeChanged(); setNotice("已删除本地副本，原文件与聊天记录未更改。");
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const viewDocument = async (id: string) => {
    if (!record || busy) return; setBusy(true); setNotice("");
    try { const data = await modelport.getKnowledgeDocument(record.summary.id, id); setDocument({ filename: data.summary.filename, text: data.text }); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault(); if (!record || busy) return; setBusy(true); setNotice("");
    try { setResult(await modelport.searchKnowledge(record.summary, query)); }
    catch (error) { setResult(null); setNotice(errorMessage(error)); } finally { setBusy(false); }
  };

  return <div className="knowledge-page">
    <div className="knowledge-actions"><span>{knowledgeBases.length} 个知识库 · 本地文本检索</span><button disabled={blocked} onClick={() => { if (canLeave()) { setRecord(null); setName(""); setCreating(true); setNotice(""); setResult(null); setDocument(null); } }} type="button"><Icon name="plus" size={17} />新建知识库</button></div>
    <p className="knowledge-boundary">首版支持 UTF-8 的 TXT / Markdown。资料仅存本地；选用云端模型时只发送命中的片段。采用中文关键词与英文词匹配，不是语义向量检索。增删或替换资料后会重新禁用，不会修改原文件或执行资料中的指令。</p>
    {knowledgeError && <div className="knowledge-notice" role="alert">{knowledgeError}<button disabled={busy} onClick={() => void onKnowledgeChanged()} type="button">重新读取</button></div>}
    {notice && <p className="knowledge-notice" role="status">{notice}</p>}
    <div className="knowledge-layout"><div aria-label="知识库列表" className="knowledge-list">
      {knowledgeLoading && <p>正在读取知识库…</p>}
      {knowledgeBases.map(base => <button aria-pressed={record?.summary.id === base.id} className={record?.summary.id === base.id ? "is-active" : ""} disabled={busy || knowledgeLoading} key={base.id} onClick={() => void open(base.id)} type="button"><strong>{base.name}</strong><span>{base.documentCount} 份资料 · {base.chunkCount} 个片段</span><small>{base.enabled ? "已启用" : "已禁用"}</small></button>)}
      {!knowledgeLoading && !knowledgeBases.length && <p>还没有知识库，先创建一个并导入资料。</p>}
    </div><div className="knowledge-main">
      {creating || record ? <>
        <form className="knowledge-name" onSubmit={(event) => void save(event)}><label>知识库名称<input aria-label="知识库名称" disabled={busy} maxLength={120} onChange={event => setName(event.target.value)} required value={name} /></label><button disabled={blocked || !name.trim()} type="submit">保存知识库</button></form>
        {record && <>
          <div className="knowledge-actions"><small>{record.documents.length} 份资料 · {record.summary.chunkCount} 个片段 · 版本 {record.summary.revision.slice(0, 8)}</small><button disabled={blocked || dirty} onClick={() => fileRef.current?.click()} type="button">导入资料</button><button disabled={blocked || dirty || !record.documents.length} onClick={() => void toggle()} type="button">{record.summary.enabled ? "禁用知识库" : "启用知识库"}</button><button className="knowledge-delete" disabled={blocked} onClick={() => void remove()} type="button">删除知识库</button><input accept=".txt,.md,.markdown" aria-label="导入知识库资料" hidden multiple onChange={event => void importFiles(event)} ref={fileRef} type="file" /></div>
          <div aria-label="资料列表" className="knowledge-documents">{record.documents.map(doc => <div key={doc.id}><button disabled={busy} onClick={() => void viewDocument(doc.id)} type="button"><Icon name="document" size={17} /><span>{doc.filename}<small>{(doc.bytes / 1024).toFixed(1)} KiB · {doc.chunkCount} 个片段</small></span></button><button aria-label={`删除资料 ${doc.filename}`} className="knowledge-delete" disabled={blocked || dirty} onClick={() => void remove(doc.id)} type="button"><Icon name="close" size={16} /></button></div>)}{!record.documents.length && <p>选择 TXT / Markdown 文件导入。单文件最多 512 KiB，每批最多 20 个 / 2 MiB。</p>}</div>
          <form aria-label="知识库检索测试" className="knowledge-search" onSubmit={event => void search(event)}><label>检索测试<input aria-label="知识库检索问题" disabled={busy} maxLength={2048} onChange={event => { setQuery(event.target.value); setResult(null); }} placeholder="输入关键词或问题，查看实际命中的片段" required value={query} /></label><button disabled={busy || !query.trim() || !record.documents.length} type="submit">测试检索</button></form>
          {result && <section aria-label="知识库检索结果" className="knowledge-results"><h4>{result.sources.length ? `命中 ${result.sources.length} 个片段` : "未找到匹配资料"}</h4>{!result.sources.length && <p>请尝试更具体的关键词，或补充相关资料。聊天遇到此情况不会发送模型请求。</p>}{result.sources.map(source => <article key={source.number}><strong>[资料{source.number}] {source.filename} · 第 {source.startLine}–{source.endLine} 行</strong><pre>{source.text}</pre></article>)}</section>}
          {document && <section aria-label="知识库资料原文" className="knowledge-document"><div><h4>{document.filename}</h4><button aria-label="关闭资料预览" onClick={() => setDocument(null)} type="button"><Icon name="close" size={16} /></button></div><pre>{document.text}</pre></section>}
        </>}
      </> : <div className="knowledge-start"><Icon name="book" size={30} /><h4>用自己的资料回答问题</h4><p>新建知识库、导入文本、测试检索，再启用并在聊天中选择。新对话默认不使用知识库。</p></div>}
    </div></div>
  </div>;
}
