// Saved tool rounds are data, never executable requests or reusable approvals.
export type ToolCall = { id: string; name: string; arguments: unknown };
export type ToolResult = { id: string; name: string; content: string; status: "completed" | "denied" | "failed" | "interrupted" };
export type ToolRound = { content: string; toolCalls: ToolCall[]; toolResults: ToolResult[]; reasoningContent?: string; thinking?: string };
export type ToolHistory = { messageIndex: number; rounds: ToolRound[]; reasoningContent?: string; thinking?: string };
export type McpSelection = { id: string; revision: string };
export type ToolTrace = { approvalId: string; serverName: string; toolName: string; status: "pending" | "running" | "completed" | "denied" | "failed" | "interrupted"; summary: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const identifier = (value: unknown): value is string => text(value, 128) && value.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

export function normalizeMcpSelections(value: unknown): McpSelection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) throw new Error("每个对话最多选择 3 个 MCP 服务。");
  const ids = new Set<string>();
  return value.map(item => {
    if (!record(item) || !text(item.id, 64) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id)
      || ids.has(item.id) || !text(item.revision, 64) || !/^[a-f0-9]{64}$/.test(item.revision)) throw new Error("MCP 服务选择无效。");
    ids.add(item.id); return { id: item.id, revision: item.revision };
  });
}

export function normalizeToolRounds(value: unknown): ToolRound[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5 || JSON.stringify(value).length > 2 * 1024 * 1024) throw new Error("工具记录超出范围。");
  let callCount = 0;
  return value.map(round => {
    const ids = new Set<string>();
    if (!record(round) || !text(round.content, 65536) || !Array.isArray(round.toolCalls) || !Array.isArray(round.toolResults)
      || round.toolCalls.length < 1 || round.toolCalls.length !== round.toolResults.length || (callCount += round.toolCalls.length) > 5
      || (round.reasoningContent !== undefined && !text(round.reasoningContent, 65536))
      || (round.thinking !== undefined && !text(round.thinking, 65536))) throw new Error("工具记录不完整。");
    const calls = round.toolCalls.map(call => {
      if (!record(call) || !identifier(call.id) || ids.has(call.id) || !text(call.name, 64) || !/^mcp_[a-f0-9]{32}$/.test(call.name)
        || !record(call.arguments) || JSON.stringify(call.arguments).length > 16384) throw new Error("工具调用记录无效。");
      ids.add(call.id); return { id: call.id, name: call.name, arguments: call.arguments };
    });
    const results = round.toolResults.map((result, index) => {
      if (!record(result) || result.id !== calls[index].id || result.name !== calls[index].name || !text(result.content, 65536)
        || !["completed", "denied", "failed", "interrupted"].includes(result.status as string)) throw new Error("工具结果与调用不匹配。");
      return { id: result.id as string, name: result.name as string, content: result.content, status: result.status as ToolResult["status"] };
    });
    return { content: round.content, toolCalls: calls, toolResults: results,
      ...(round.reasoningContent === undefined ? {} : { reasoningContent: round.reasoningContent as string }),
      ...(round.thinking === undefined ? {} : { thinking: round.thinking as string }) };
  });
}

export function normalizeToolTrace(value: unknown): ToolTrace[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5) throw new Error("工具状态记录无效。");
  return value.map(item => {
    if (!record(item) || !identifier(item.approvalId) || !text(item.serverName, 120) || [...item.serverName].length > 60 || !identifier(item.toolName) || !text(item.summary, 500)
      || !["pending", "running", "completed", "denied", "failed", "interrupted"].includes(item.status as string)) throw new Error("工具状态记录无效。");
    return { approvalId: item.approvalId, serverName: item.serverName, toolName: item.toolName,
      status: ["pending", "running"].includes(item.status as string) ? "interrupted" : item.status as ToolTrace["status"], summary: item.summary };
  });
}
