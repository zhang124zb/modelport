import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/chat-store";
import { errorMessage, modelport, providerInfo } from "@/lib/modelport";
import type { ChatTurn, KnowledgeContext, ModelOption, ProviderConfig, SelectedKnowledge, SelectedSkill } from "@/lib/modelport";
import { mcp } from "@/lib/mcp";
import type { McpApproval, McpEvent } from "@/lib/mcp";
import type { McpSelection, ToolRound, ToolTrace } from "@/lib/mcp-history";
import { createTextBatcher } from "@/lib/stream-batcher";

export type ActiveRequest = { requestId: string; conversationId: string; assistantMessageId: string };
type ReplyInput = ActiveRequest & {
  userMessageId: string; model: ModelOption; providerConfigs: readonly ProviderConfig[]; history: ChatTurn[];
  services: McpSelection[]; skill?: SelectedSkill; knowledge?: SelectedKnowledge; systemPrompt: string;
  onFailure: (error: unknown) => void;
};

export function useChatLifecycle() {
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [stoppingRequestId, setStoppingRequestId] = useState<string | null>(null);
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const [pendingMcp, setPendingMcp] = useState<{ approval: McpApproval; modelName: string; providerName: string; cloudModel: boolean } | null>(null);
  const [mcpDecisionBusy, setMcpDecisionBusy] = useState(false);
  const [mcpDecisionError, setMcpDecisionError] = useState("");
  const mcpDecisionRef = useRef(false);

  const runReply = async (input: ReplyInput, setConversations: Dispatch<SetStateAction<Conversation[]>>) => {
    const { requestId, conversationId, assistantMessageId, userMessageId, model, history, services, skill, knowledge } = input;
    setReplyingId(conversationId); setStreamingMessageId(assistantMessageId);
    let receivedText = "", toolRounds: ToolRound[] | undefined, reasoningContent: string | undefined, thinking: string | undefined;
    const batcher = createTextBatcher(delta => {
      if (activeRequestRef.current?.requestId !== requestId) return;
      setConversations(current => current.map(conversation => conversation.id === conversationId
        ? { ...conversation, messages: conversation.messages.map(message => message.id === assistantMessageId ? { ...message, content: message.content + delta } : message) } : conversation));
    });
    const settleMessages = (status: Message["status"], content: string) => {
      batcher.flush();
      setConversations(current => current.map(conversation => conversation.id === conversationId
        ? { ...conversation, messages: conversation.messages.flatMap((message): Message[] => {
          if (message.id === userMessageId) return [{ ...message, status }];
          if (message.id !== assistantMessageId) return [message];
          return content || message.toolTrace?.length || toolRounds?.length
            ? [{ ...message, content, status, toolRounds, reasoningContent, thinking,
              mcpModel: services.length ? { provider: model.provider, id: model.id } : undefined,
              toolTrace: message.toolTrace?.map(trace => ["pending", "running"].includes(trace.status) ? { ...trace, status: "interrupted" } : trace) }] : [];
        }) } : conversation));
    };
    try {
      const onDelta = (delta: string) => {
        if (activeRequestRef.current?.requestId !== requestId || !delta) return;
        receivedText += delta; batcher.push(delta);
      };
      const onSources = (retrieval: KnowledgeContext) => {
        if (activeRequestRef.current?.requestId !== requestId) return;
        setConversations(current => current.map(conversation => conversation.id === conversationId
          ? { ...conversation, messages: conversation.messages.map(message => message.id === assistantMessageId ? { ...message, retrieval } : message) } : conversation));
      };
      const onMcpEvent = (event: McpEvent) => {
        if (event.requestId !== requestId || activeRequestRef.current?.requestId !== requestId) return;
        batcher.flush(); // Approval/trace events are immediate, never delayed behind UI batching.
        if (event.type === "approval") {
          setMcpDecisionError(""); setPendingMcp({ approval: event, modelName: model.name,
            providerName: providerInfo(model.provider, input.providerConfigs).name, cloudModel: model.provider !== "ollama" });
        } else {
          if (event.status !== "pending") setPendingMcp(current => current?.approval.approvalId === event.approvalId ? null : current);
          const trace: ToolTrace = { approvalId: event.approvalId, serverName: event.serverName, toolName: event.toolName, status: event.status, summary: event.summary };
          setConversations(current => current.map(conversation => conversation.id === conversationId
            ? { ...conversation, messages: conversation.messages.map(message => message.id === assistantMessageId
              ? { ...message, toolTrace: [...(message.toolTrace ?? []).filter(item => item.approvalId !== trace.approvalId), trace] } : message) } : conversation));
        }
      };
      const result = services.length
        ? await modelport.streamMcpChat(model.provider, model.id, history, requestId, onDelta, services, onMcpEvent, skill ?? null, knowledge ?? null, onSources, input.systemPrompt)
        : await modelport.streamChat(model.provider, model.id, history, requestId, onDelta, skill ?? null, knowledge ?? null, onSources, input.systemPrompt);
      toolRounds = result.toolRounds; reasoningContent = result.reasoningContent; thinking = result.thinking;
      settleMessages(result.status === "completed" && result.content ? undefined : result.status === "cancelled" ? "stopped" : "failed", result.content);
      if (result.status === "completed" && !result.content) setConversationErrors(current => ({ ...current, [conversationId]: "模型返回了空内容，请重试。" }));
      if (result.status === "failed") setConversationErrors(current => ({ ...current, [conversationId]: result.error || "生成失败，请重试。" }));
    } catch (error) {
      settleMessages("failed", receivedText); input.onFailure(error);
      setConversationErrors(current => ({ ...current, [conversationId]: errorMessage(error) }));
    } finally {
      batcher.cancel();
      setPendingMcp(current => current?.approval.requestId === requestId ? null : current);
      if (activeRequestRef.current?.requestId === requestId) activeRequestRef.current = null;
      setReplyingId(null); setStreamingMessageId(null); setStoppingRequestId(null);
    }
  };
  const stopChat = async () => {
    const request = activeRequestRef.current;
    if (!request || stoppingRequestId === request.requestId) return;
    setStoppingRequestId(request.requestId);
    try { await modelport.cancelChat(request.requestId); setPendingMcp(current => current?.approval.requestId === request.requestId ? null : current); }
    catch (error) { if (activeRequestRef.current?.requestId === request.requestId) {
      setStoppingRequestId(null); setConversationErrors(current => ({ ...current, [request.conversationId]: `停止失败：${errorMessage(error)}` }));
    } }
  };
  const decideMcp = async (allow: boolean) => {
    if (!pendingMcp || mcpDecisionRef.current) return;
    const approval = pendingMcp.approval;
    if (activeRequestRef.current?.requestId !== approval.requestId) { setPendingMcp(null); return; }
    mcpDecisionRef.current = true; setMcpDecisionBusy(true); setMcpDecisionError("");
    try { await mcp.decideTool(approval.requestId, approval.approvalId, allow); setPendingMcp(current => current?.approval.approvalId === approval.approvalId ? null : current); }
    catch (error) { setMcpDecisionError(`${errorMessage(error)} 未确认执行；可以关闭提示以拒绝，或等待超时。`); }
    finally { mcpDecisionRef.current = false; setMcpDecisionBusy(false); }
  };
  return { activeRequestRef, replyingId, streamingMessageId, stoppingRequestId, conversationErrors, setConversationErrors,
    pendingMcp, mcpDecisionBusy, mcpDecisionError, runReply, stopChat, decideMcp };
}
