import { Fragment, lazy, memo, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "@/components/Icon";
import { AttachmentList } from "@/components/ChatAttachments";
import type { AttachmentNoticeData } from "@/components/ChatAttachments";
import { KnowledgeSources } from "@/components/KnowledgeSources";
import { McpToolTrace } from "@/components/McpApprovalDialog";
import type { Conversation } from "@/lib/chat-store";

const messagePageSize = 80;

const MessageResponse = lazy(() => import("@/components/ai-elements/message").then(module => ({ default: module.MessageResponse })));
type Props = {
  conversation: Conversation; streamingMessageId: string | null; editableMessageId?: string;
  fontSize: number; renderMarkdown: boolean; canvasRef: RefObject<HTMLElement | null>;
  onLoadOlder: () => void; onAttachmentNotice: (notice: AttachmentNoticeData) => void;
};

export const ConversationMessages = memo(function ConversationMessages({ conversation, streamingMessageId, editableMessageId,
  fontSize, renderMarkdown, canvasRef, onLoadOlder, onAttachmentNotice }: Props) {
  const [visibleCount, setVisibleCount] = useState(messagePageSize);
  const scrollBeforeLoad = useRef<{ height: number; top: number } | null>(null);
  const start = Math.max(0, conversation.messages.length - visibleCount);
  useLayoutEffect(() => {
    const canvas = canvasRef.current, previous = scrollBeforeLoad.current;
    if (canvas && previous) canvas.scrollTop = previous.top + canvas.scrollHeight - previous.height;
    scrollBeforeLoad.current = null;
  }, [visibleCount, canvasRef]);
  return <div className="message-stream">
    <div className="chat-heading"><span>{conversation.title}</span></div>
    {start > 0 && <button className="load-older-messages" onClick={() => {
      const canvas = canvasRef.current;
      if (canvas) scrollBeforeLoad.current = { height: canvas.scrollHeight, top: canvas.scrollTop };
      onLoadOlder(); setVisibleCount(count => count + messagePageSize);
    }} type="button">加载更早的消息（还有 {start} 条）</button>}
    {conversation.messages.slice(start).map(message => <Fragment key={message.id}>
      {message.topicStart && <div className="topic-divider">新话题 · 不携带之前的聊天上下文</div>}
      <article className={`message ${message.role}`} data-message-id={message.id}>
        {message.role === "assistant" && <div className="assistant-avatar"><Icon name="spark" size={18} /></div>}
        <div className="message-bubble" style={{ fontSize }}>
          {message.role === "assistant" ? message.content
            ? renderMarkdown ? <Suspense fallback={<span>正在排版回复…</span>}><MessageResponse key={message.id === streamingMessageId ? "streaming" : "static"} mode={message.id === streamingMessageId ? "streaming" : "static"}>{message.content}</MessageResponse></Suspense>
              : <div className="message-plain-text">{message.content}</div>
            : message.id === streamingMessageId && <div aria-label="正在生成回复" className="typing"><span /><span /><span /></div>
            : message.content}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} onNotice={onAttachmentNotice} /> : null}
          {message.skill && <span className="message-skill">选用技能：{message.skill.name} · {message.skill.revision.slice(0, 8)}</span>}
          {message.knowledge && <span className="message-knowledge">选用知识库：{message.knowledge.name} · {message.knowledge.revision.slice(0, 8)}</span>}
          {message.savedOnly && <span className="stream-note">仅保存，未生成回复</span>}
          {message.role === "assistant" && message.retrieval && <KnowledgeSources context={message.retrieval} />}
          {message.toolTrace?.length ? <details className="mcp-chat-trace"><summary>工具记录 · {message.toolTrace.length} 次（不会自动重放）</summary><McpToolTrace events={message.toolTrace} /></details> : null}
          {message.role === "assistant" && message.status === "stopped" && <span className="stream-note">已停止生成</span>}
          {message.role === "assistant" && message.status === "failed" && <span className="stream-note">生成失败</span>}
          {message.role === "assistant" && message.status === "interrupted" && <span className="stream-note">生成中断</span>}
          {message.id === editableMessageId && <span className="stream-note">{message.status === "stopped" ? "回复已停止" : message.status === "failed" ? "回复失败" : "回复中断"}</span>}
        </div>
      </article>
    </Fragment>)}
    {conversation.newTopicPending && <div className="topic-divider" role="status">新话题 · 下一条消息将重新开始上下文</div>}
  </div>;
});
