import { useLayoutEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import type { McpApproval, McpToolEvent, McpToolStatus } from "@/lib/mcp";
import { mcpVisibleText } from "@/lib/mcp";
import "@/features/settings/mcp.css";

type Props = {
  approval: McpApproval;
  modelName: string;
  providerName: string;
  cloudModel: boolean;
  busy: boolean;
  error: string;
  onDecision: (allow: boolean) => void;
};

export function McpApprovalDialog({ approval, modelName, providerName, cloudModel, busy, error, onDecision }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal(); denyRef.current?.focus();
    return () => { dialog?.close(); opener?.focus(); };
  }, [approval.approvalId]);
  return <dialog aria-describedby="mcp-approval-warning" aria-labelledby="mcp-approval-title" className="mcp-approval-dialog" data-approval-id={approval.approvalId} data-request-id={approval.requestId} onCancel={event => { event.preventDefault(); if (!busy) onDecision(false); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) event.preventDefault(); }} ref={dialogRef}>
    <header><div><span className="mcp-approval-eyebrow">外部工具 · 等待你的确认</span><h2 id="mcp-approval-title">允许这一次工具操作吗？</h2></div>
      <button aria-label="拒绝操作并关闭" className="icon-button" disabled={busy} onClick={() => onDecision(false)} type="button"><Icon name="close" /></button></header>
    <div className="mcp-security" id="mcp-approval-warning"><Icon name="info" size={23} /><div><strong>此操作可能影响真实数据，不能保证撤销</strong>
      <p>工具可能读取、修改或删除数据，访问网络或产生费用。名称和说明不是安全保证。若不清楚用途或发现异常参数，请拒绝。确认不等于系统沙箱。</p></div></div>
    <dl className="mcp-approval-details"><div><dt>服务</dt><dd>{mcpVisibleText(approval.serverName)}</dd></div><div><dt>服务地址</dt><dd>{mcpVisibleText(approval.serverUrl)}</dd></div><div><dt>工具</dt><dd>{mcpVisibleText(approval.toolName)}</dd></div>
      <div><dt>结果接收方</dt><dd>{mcpVisibleText(providerName)} · {mcpVisibleText(modelName)}<small>{mcpVisibleText(approval.providerDestination)}</small></dd></div></dl>
    <p className="mcp-approval-destination">{cloudModel ? "工具返回的资料将发送给所选模型服务。可能包含文件内容、个人信息或其他敏感数据；请确认你有权共享。" : "工具返回资料将交给所选模型处理。请核对模型连接地址；本地模型不代表外部 MCP 服务也在本机。"}</p>
    {approval.serverUrl.startsWith("http:") && <p className="mcp-local-warning">此服务使用本机 HTTP，连接未加密；仅在确认本机服务可信时允许。</p>}
    <section className="mcp-approval-arguments" aria-label="本次工具参数"><h3>将发送给该服务的完整参数</h3><pre>{mcpVisibleText(JSON.stringify(approval.arguments, null, 2) ?? "null")}</pre><small>不可见的方向或格式控制字符显示为 Unicode 转义，防止参数被视觉隐藏。</small></section>
    <p className="mcp-hint">仅批准当前这一次调用。后续调用仍会询问。拒绝、关闭或按 Esc 不会执行本次工具。参数和结果会作为聊天记录保存在本机，可能进入未加密的聊天备份；请勿在参数中填写密码或密钥。</p>
    {error && <p className="mcp-notice is-error" role="alert">{error}</p>}
    <footer><button className="mcp-deny" disabled={busy} onClick={() => onDecision(false)} ref={denyRef} type="button">拒绝执行</button>
      <button className="mcp-allow" disabled={busy} onClick={() => onDecision(true)} type="button">{busy ? "正在提交…" : "允许本次操作"}</button></footer>
  </dialog>;
}

const statusLabels: Record<McpToolStatus, string> = { pending: "等待确认", running: "正在执行", completed: "已完成", denied: "已拒绝", failed: "失败", interrupted: "已中断" };
export function McpToolTrace({ events }: { events: readonly Pick<McpToolEvent, "approvalId" | "serverName" | "toolName" | "status" | "summary">[] }) {
  if (!events.length) return null;
  return <section aria-label="外部工具操作记录" className="mcp-tool-trace"><strong><Icon name="mcp" size={16} />工具操作</strong>
    <ul>{events.map(event => <li key={event.approvalId}><span>{event.serverName} · {event.toolName}</span><small data-status={event.status}>{statusLabels[event.status]}</small>{event.summary && <p>{event.summary}</p>}</li>)}</ul>
    <small>记录仅供查看，重新打开或导入聊天不会重新执行工具。</small>
  </section>;
}
