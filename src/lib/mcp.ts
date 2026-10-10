import { invoke } from "@tauri-apps/api/core";

export type McpSelection = { id: string; revision: string };
export type McpServerConfig = McpSelection & { name: string; url: string; enabled: boolean; disabledTools: string[] };
export type McpServer = McpServerConfig & { hasToken: boolean };
export type McpTool = { name: string; description: string; inputSchema: unknown };
export type McpTestResult = { server: McpServer; tools: McpTool[]; protocolVersion: string };
export type McpSettingsProps = {
  mcpServers: readonly McpServer[];
  mcpLoading: boolean;
  mcpError: string;
  onMcpChanged: () => Promise<void>;
};
export type McpApproval = {
  type: "approval";
  requestId: string;
  approvalId: string;
  serverName: string;
  serverUrl: string;
  toolName: string;
  arguments: unknown;
  modelLabel: string;
  providerDestination: string;
};
export type McpToolStatus = "pending" | "running" | "completed" | "denied" | "failed" | "interrupted";
export type McpToolEvent = {
  type: "tool";
  requestId: string;
  approvalId: string;
  serverName: string;
  toolName: string;
  status: McpToolStatus;
  summary: string;
};
export type McpEvent = McpApproval | McpToolEvent;

export const mcpSelection = ({ id, revision }: McpSelection): McpSelection => ({ id, revision });
export const mcpConfig = ({ id, revision, name, url, enabled, disabledTools }: McpServerConfig): McpServerConfig =>
  ({ id, revision, name, url, enabled, disabledTools: [...disabledTools] });

// The native side validates again before storing credentials or opening a connection.
export function mcpUrlProblem(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return "地址不能包含用户名、密码、查询参数或片段。令牌请单独保存。";
    if (url.protocol === "https:") return "";
    if (url.protocol === "http:" && (url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname))) return "";
    return "远程 MCP 地址必须使用 HTTPS；HTTP 仅允许明确的本机回环 IP（127.0.0.1 / ::1）。";
  } catch { return "请输入完整的 MCP 服务地址，例如 https://example.com/mcp。"; }
}

// Invisible formatting characters must not conceal the operation being approved.
export function mcpVisibleText(value: string): string {
  return value.replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function mcpErrorMessage(error: unknown, transientToken = ""): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "操作失败，请重试。";
  return (transientToken ? message.split(transientToken).join("[已隐藏令牌]") : message)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏令牌]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1200);
}

export const mcp = {
  listServers: () => invoke<McpServer[]>("list_mcp_servers"),
  saveServer: (config: McpServerConfig) => invoke<McpServer>("save_mcp_server", { config: mcpConfig(config) }),
  removeServer: (selection: McpSelection) => invoke<void>("remove_mcp_server", { selection: mcpSelection(selection) }),
  testServer: (selection: McpSelection) => invoke<McpTestResult>("test_mcp_server", { selection: mcpSelection(selection) }),
  saveToken: (selection: McpSelection, token: string) => invoke<McpServer>("save_mcp_token", { selection: mcpSelection(selection), token }),
  removeToken: (selection: McpSelection) => invoke<McpServer>("remove_mcp_token", { selection: mcpSelection(selection) }),
  decideTool: (requestId: string, approvalId: string, allow: boolean) => invoke<void>("decide_mcp_tool", { requestId, approvalId, allow }),
};
