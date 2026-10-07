import type { KnowledgeContext } from "@/lib/modelport";

export function KnowledgeSources({ context }: { context: KnowledgeContext }) {
  if (!context.sources.length) return <p className="knowledge-no-match">知识库：{context.base.name} · 未命中资料，本次未调用模型。</p>;
  return <details aria-label="本次检索来源" className="message-sources"><summary>本次检索片段 · {context.base.name} · {context.sources.length} 个来源</summary>
    <p>这是本次检索到的资料，不代表模型已全部引用。片段快照随聊天保留。</p>
    {context.sources.map(source => <details key={source.number}><summary>[资料{source.number}] {source.filename} · 第 {source.startLine}–{source.endLine} 行</summary><pre>{source.text}</pre><small>片段 {source.chunkIndex} · 内容版本 {source.documentRevision.slice(0, 8)}</small></details>)}
  </details>;
}
