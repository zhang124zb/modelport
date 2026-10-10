// Pure checks: no desktop, network, real credentials or model invocation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/mcp.ts", "utf8");
const output = ts.transpile(source.replace('import { invoke } from "@tauri-apps/api/core";', "const invoke = (name, args) => ({name,args});"),
  { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext });
const { mcp, mcpConfig, mcpSelection, mcpUrlProblem, mcpErrorMessage, mcpVisibleText } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
for (const url of ["https://example.com/mcp", "http://127.0.0.1:9999/mcp", "http://[::1]:9999/mcp"]) assert.equal(mcpUrlProblem(url), "", url);
for (const url of ["http://localhost:9999", "http://example.com/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?token=secret", "https://example.com/mcp#secret", "file:///etc/passwd", "not a url"]) assert.notEqual(mcpUrlProblem(url), "", url);
assert.equal(mcpVisibleText("path\u202eexe\u200b"), "path\\u202eexe\\u200b");
const selection = { id: "id", revision: "revision", hasToken: true, token: "secret", url: "https://example.com" };
assert.deepEqual(mcpSelection(selection), { id: "id", revision: "revision" });
assert.deepEqual(mcp.removeServer(selection), { name: "remove_mcp_server", args: { selection: { id: "id", revision: "revision" } } });
const config = { ...selection, name: "service", enabled: false, disabledTools: ["erase"], unsupported: "shell" };
const sanitized = { id: "id", revision: "revision", name: "service", url: "https://example.com", enabled: false, disabledTools: ["erase"] };
assert.deepEqual(mcp.saveServer(config).args.config, sanitized);
assert.notEqual(mcpConfig(config).disabledTools, config.disabledTools, "Config payload must not share mutable tool permissions");
assert.deepEqual(mcp.decideTool("request", "approval", false), { name: "decide_mcp_tool", args: { requestId: "request", approvalId: "approval", allow: false } });
assert.ok(!mcpErrorMessage("failed Bearer secret and secret", "secret").includes("secret"));
assert.ok(!mcpErrorMessage("Authorization: Bearer private-value").includes("private-value"));
assert.equal(mcpErrorMessage("a".repeat(3000)).length, 1200);
assert.equal(mcpErrorMessage(new Error("first\nsecond")), "first second");
const page = readFileSync("src/features/settings/McpSettingsPage.tsx", "utf8");
const approval = readFileSync("src/components/McpApprovalDialog.tsx", "utf8");
for (const text of ["enabled: false", "window.confirm", "系统沙箱", "不会自动下载或运行", "没有执行任何工具", 'type="password"', "onRegisterLeaveGuard"]) assert.ok(page.includes(text), `Settings safety affordance: ${text}`);
for (const text of ["denyRef.current?.focus()", "dialog?.showModal()", "opener?.focus()", "onCancel=", "onDecision(false)", "完整参数", "产生费用", "结果接收方", "不能保证撤销"]) assert.ok(approval.includes(text), `Approval safety affordance: ${text}`);
for (const text of [page, approval, source]) assert.doesNotMatch(text, /dangerouslySetInnerHTML|localStorage|sessionStorage|innerHTML\s*=|autoApprove/);
console.log("PASS: MCP URL boundaries, minimal revision-bound IPC, token redaction and static safety/accessibility affordances");
