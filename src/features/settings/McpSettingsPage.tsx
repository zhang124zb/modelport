import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { isDesktop } from "@/lib/modelport";
import { mcp, mcpConfig, mcpErrorMessage, mcpUrlProblem } from "@/lib/mcp";
import type { McpServerConfig, McpSettingsProps, McpTestResult } from "@/lib/mcp";
import { useSettingsLeaveGuard } from "./useSettingsLeaveGuard";
import "./mcp.css";

type Props = McpSettingsProps & { onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void };
const newConfig = (): McpServerConfig => ({ id: "", revision: "", name: "", url: "", enabled: false, disabledTools: [] });

export function McpSettingsPage({ mcpServers, mcpLoading, mcpError, onMcpChanged, onRegisterLeaveGuard }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = mcpServers.find(server => server.id === selectedId);
  const [draft, setDraft] = useState<McpServerConfig>(newConfig);
  const [tokenDraft, setTokenDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current ? mcpConfig(current) : newConfig());
  const canLeave = useSettingsLeaveGuard({ dirty: dirty || Boolean(tokenDraft), busy,
    message: "MCP 有未保存的配置或令牌，确定放弃吗？", onRegisterLeaveGuard, onError: setNotice });

  useEffect(() => {
    if (selectedId && !current && !busy && !mcpLoading) { setSelectedId(null); setDraft(newConfig()); setTokenDraft(""); setTestResult(null); }
  }, [current, selectedId, busy, mcpLoading]);

  const select = (id: string | null) => {
    if (!canLeave()) return;
    const next = mcpServers.find(server => server.id === id);
    setSelectedId(id); setDraft(next ? mcpConfig(next) : newConfig()); setTokenDraft(""); setTestResult(null); setNotice(""); setFailed(false);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy || mcpLoading) return;
    if (!isDesktop) { setNotice("请在 ModelPort 桌面应用中配置 MCP。"); setFailed(true); return; }
    setBusy(true); setNotice(""); setFailed(false);
    try { await action(); }
    catch (error) {
      setNotice(mcpErrorMessage(error, tokenDraft.trim())); setFailed(true);
      // Keep the draft on conflicts; never silently retry a credential write or overwrite newer configuration.
      try { await onMcpChanged(); } catch { /* The parent's load error is displayed below. */ }
    } finally { setBusy(false); setTesting(false); }
  };
  const save = () => void run(async () => {
    const problem = mcpUrlProblem(draft.url.trim());
    if (problem) throw new Error(problem);
    if (!draft.name.trim()) throw new Error("请填写服务名称。");
    const saved = await mcp.saveServer({ ...draft, name: draft.name.trim(), url: draft.url.trim() });
    setSelectedId(saved.id); setDraft(mcpConfig(saved)); setTestResult(null);
    await onMcpChanged();
    setNotice(saved.enabled ? "配置已保存。只有在对话中选中服务、并逐次确认后，工具才能执行。" : "配置已保存，默认停用。连接测试只读取服务信息和工具列表。");
  });
  const unavailable = busy || mcpLoading;
  const invalidUrl = draft.url ? mcpUrlProblem(draft.url.trim()) : "";
  const endpointChanged = Boolean(current && draft.url.trim() !== current.url);
  const tools = testResult && testResult.server.id === current?.id && testResult.server.revision === current?.revision ? testResult.tools : null;

  return <div className="mcp-page">
    <section className="mcp-security" aria-label="MCP 安全提示">
      <Icon name="info" size={21} />
      <div><strong>外部工具可以操作真实数据，请只连接可信服务</strong>
        <p>工具可能读取、修改、删除数据，访问网络或产生费用。工具描述和返回内容并非安全保证；ModelPort 的逐次确认不是系统沙箱。返回结果会发送给当前对话的模型。即使仅测试连接，服务也会收到请求和已保存的令牌，请先核实来源。</p>
      </div>
    </section>
    {(notice || mcpError) && <p className={`mcp-notice${failed || mcpError ? " is-error" : ""}`} role={failed || mcpError ? "alert" : "status"}>{notice || mcpError}</p>}
    <div className="mcp-layout">
      <aside className="mcp-sidebar" aria-label="MCP 服务列表">
        <button className="mcp-add" disabled={unavailable} onClick={() => select(null)} type="button"><Icon name="plus" size={17} />添加服务</button>
        {mcpLoading && <p role="status">正在读取服务配置…</p>}
        {!mcpLoading && !mcpServers.length && <p>尚未添加服务。新服务默认停用，不会自动执行工具。</p>}
        <div className="mcp-server-list">{mcpServers.map(server => <button aria-pressed={selectedId === server.id} className={selectedId === server.id ? "is-active" : ""} disabled={unavailable} key={server.id} onClick={() => select(server.id)} type="button">
          <strong>{server.name}</strong><small>{server.enabled ? "已启用 · 仍需逐次确认" : "已停用"}</small><span>{server.url}</span>
        </button>)}</div>
      </aside>
      <div className="mcp-editor">
        <form onSubmit={event => { event.preventDefault(); save(); }}>
          <header className="mcp-editor-heading"><h4>{current ? current.name : "添加 MCP 服务"}</h4>
            {current && <button aria-label={`删除 MCP 服务 ${current.name}`} className="mcp-danger" disabled={unavailable} onClick={() => {
              if (window.confirm(`删除“${current.name}”及其已保存令牌？此操作不能撤销。不会删除历史聊天，也不会撤销该服务已经执行的操作。`)) void run(async () => {
                await mcp.removeServer(current); setSelectedId(null); setDraft(newConfig()); setTokenDraft(""); setTestResult(null); await onMcpChanged(); setNotice("服务及对应令牌已删除。历史记录保留，工具操作没有被重放。");
              });
            }} type="button"><Icon name="trash" size={17} />删除</button>}
          </header>
          <label>服务名称<input aria-label="MCP 服务名称" autoComplete="off" disabled={unavailable} maxLength={60} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：我的资料检索服务" value={draft.name} /></label>
          <label>连接方式<select disabled value="http"><option value="http">Streamable HTTP</option></select></label>
          <label>MCP 服务地址<input aria-label="MCP 服务地址" autoComplete="off" disabled={unavailable || Boolean(current?.hasToken)} onChange={event => { setDraft({ ...draft, url: event.target.value, enabled: false }); setTestResult(null); }} placeholder="https://example.com/mcp" spellCheck={false} value={draft.url} /></label>
          {invalidUrl && <p className="mcp-inline-error" role="alert">{invalidUrl}</p>}
          <p className="mcp-hint">远程服务必须使用 HTTPS，HTTP 仅允许本机回环地址。地址不能夹带令牌或查询参数。{current?.hasToken && "已保存令牌；更改地址前必须先删除旧令牌，避免把凭据发送给其他服务。"}{endpointChanged && "地址已修改，服务已在表单中停用，请重新核对后启用。"}</p>
          <label className="mcp-enable"><input checked={draft.enabled} disabled={unavailable || !current || endpointChanged} onChange={event => {
            if (event.target.checked && !window.confirm(`启用“${draft.name}”（${draft.url}）？\n\n外部工具可能读取、修改或删除数据、访问网络、产生费用，并把结果交给当前模型。确认弹窗不能限制服务自身的系统权限。\n\n请仅启用你信任的服务；启用后还须在对话中选中它，每次工具执行仍须单独确认。`)) return;
            setDraft({ ...draft, enabled: event.target.checked });
          }} type="checkbox" /><span>允许在对话中选择此服务<small>默认关闭。每次执行都需要确认，不提供自动批准。</small></span></label>
          {!current && <p className="mcp-hint">先保存为停用状态，再进行连接测试、保存令牌或启用服务。</p>}
          <div className="mcp-actions"><button className="mcp-primary" disabled={unavailable || !dirty || !isDesktop || !draft.name.trim() || !draft.url.trim() || Boolean(invalidUrl)} type="submit">{busy ? "处理中…" : "保存配置"}</button>
            {current && <button disabled={unavailable || dirty || Boolean(tokenDraft)} onClick={() => { setTesting(true); void run(async () => {
              const result = await mcp.testServer(current); setTestResult(result); setNotice(`连接测试成功，发现 ${result.tools.length} 个工具。没有执行任何工具。`);
            }); }} type="button">{testing ? "正在连接…" : "连接测试 · 获取工具"}</button>}
          </div>
        </form>
        {current && <section className="mcp-token" aria-label="MCP 访问令牌">
          <h4>访问令牌 <small>{current.hasToken ? "已保存，不能读回" : "未保存"}</small></h4>
          <label>Bearer Token<input aria-label="MCP 访问令牌" autoComplete="off" disabled={unavailable || dirty} onChange={event => setTokenDraft(event.target.value)} placeholder={current.hasToken ? "输入新令牌以替换，不会显示旧令牌" : "无需认证的服务可留空"} spellCheck={false} type="password" value={tokenDraft} /></label>
          <p className="mcp-hint">只存入 Windows 安全凭据库，不写入配置、聊天记录或备份。不会把模型 API Key 转发给 MCP。保存令牌不会建立连接。</p>
          {current.url.startsWith("http:") && <p className="mcp-local-warning">本机 HTTP 不加密，拥有本机访问权限的程序仍可能监听或冒充服务。请确认端口对应可信服务后再发送令牌。</p>}
          <div className="mcp-actions"><button disabled={unavailable || dirty || !tokenDraft.trim()} onClick={() => void run(async () => {
            const saved = await mcp.saveToken(current, tokenDraft.trim()); setTokenDraft(""); setDraft(mcpConfig(saved)); setTestResult(null); await onMcpChanged(); setNotice("令牌已保存到系统凭据库，没有发送给模型或写入聊天备份。");
          })} type="button">保存令牌</button>
            {current.hasToken && <button className="mcp-danger" disabled={unavailable || dirty} onClick={() => {
              if (window.confirm(`删除“${current.name}”的访问令牌？配置与聊天记录保留。需要认证的服务将无法连接，已有操作不会被撤销。`)) void run(async () => {
                const saved = await mcp.removeToken(current); setTokenDraft(""); setDraft(mcpConfig(saved)); setTestResult(null); await onMcpChanged(); setNotice("访问令牌已删除。");
              });
            }} type="button">删除令牌</button>}
          </div>
        </section>}
        {current && <section className="mcp-tools" aria-label="MCP 工具管理"><h4>工具 <small>{tools ? `${tools.length} 个 · 协议 ${testResult?.protocolVersion}` : "尚未获取"}</small></h4>
          <p className="mcp-hint">工具说明由外部服务提供，不代表可信。取消勾选可禁止模型使用该工具；每次执行仍须单独确认。配置有未保存修改时，请先保存。</p>
          {tools ? tools.length ? tools.map(tool => <article className="mcp-tool" key={tool.name}>
            <label className="mcp-tool-toggle"><input checked={!draft.disabledTools.includes(tool.name)} disabled={unavailable} onChange={event => setDraft({ ...draft, disabledTools: event.target.checked ? draft.disabledTools.filter(name => name !== tool.name) : [...draft.disabledTools, tool.name] })} type="checkbox" /><strong>{tool.name}</strong></label>
            <p>{tool.description || "服务未提供说明，请自行确认用途。"}</p><details><summary>查看参数结构（服务提供）</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
          </article>) : <p className="mcp-hint">服务连接成功，但没有公开工具。</p> : <p className="mcp-hint">保存配置后点击“连接测试”，只读取元信息，不执行工具。</p>}
        </section>}
        <section className="mcp-coming"><h4>首版范围</h4><p>仅支持 HTTP 工具调用与文本／JSON 结果。本地程序（stdio）、自动安装、OAuth 登录、资源浏览和提示模板尚未开放。不会自动下载或运行服务程序。</p></section>
      </div>
    </div>
  </div>;
}
