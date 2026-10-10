// Fresh isolated WebView only. Local HTTP MCP/model fixtures; no cloud/Ollama calls or credentials.
// node scripts/verify-mcp.mjs <CDP-port> [settings.png] [approval.png]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const requests = [], toolCalls = [], modelRequests = [], ownServers = new Set(), ownProviders = new Set();
let callNumber = 0;
const fixtureTool = { name: "fixture_lookup", description: "本地测试工具：按 query 返回固定资料。不会读写真实文件。",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } };
const server = createServer(async (req, res) => {
  try {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ path: req.url, body, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    if (req.url === "/mcp-redirect") { res.statusCode = 302; res.setHeader("location", "/mcp"); return res.end("{}"); }
    if (req.url === "/mcp") {
      const result = value => res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }));
      if (body.method === "server/discover") return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Legacy fixture" } }));
      if (body.method === "initialize") return result({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "modelport-fixture", version: "1.0" } });
      if (body.method === "notifications/initialized") { res.statusCode = 202; return res.end(); }
      if (body.method === "tools/list") return result({ tools: [fixtureTool] });
      if (body.method === "tools/call") { toolCalls.push(body.params); return result({ content: [{ type: "text", text: "MCP_FIXTURE_RESULT_ONLY" }], isError: false }); }
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Not implemented" } }));
    }
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "fixture-mcp" }] }));
    if (req.url === "/v1/chat/completions") {
      modelRequests.push(body);
      const lastUser = body.messages.findLastIndex(message => message.role === "user");
      const activeRound = body.messages.slice(lastUser + 1);
      if (activeRound.some(message => message.role === "tool")) return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "工具确认完成" }, finish_reason: "stop" }] }));
      const alias = body.tools?.[0]?.function?.name;
      assert.ok(alias, "MCP-enabled model request must contain native tool definitions");
      const badSchema = String(body.messages[lastUser].content).includes("BAD_SCHEMA");
      return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: `fixture_call_${++callNumber}`, type: "function",
        function: { name: alias, arguments: JSON.stringify({ query: badSchema ? 42 : "fixture-data" }) } }] }, finish_reason: "tool_calls" }] }));
    }
    res.statusCode = 404; res.end("{}");
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const host = `http://127.0.0.1:${server.address().port}`;
const fixtureName = `MCP 安全验证 ${Date.now()}`;
const keys = ["modelport.chat.v1", "modelport.preferences.models.v1", "modelport.preferences.general.v1", "modelport.preferences.chat.v1"];
let client, originals, verified = false, acceptDialog = true;
const confirmTexts = [], exceptions = [];
try {
  client = await connectDesktop(Number(process.argv[2] ?? 9392));
  const { command, evaluate, waitFor, reload, on } = client;
  on("Page.javascriptDialogOpening", ({ message }) => { confirmTexts.push(message); void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await command("Page.enable"); await command("Runtime.enable");
  originals = await Promise.all(keys.map(key => evaluate(`localStorage.getItem(${JSON.stringify(key)})`)));
  assert.equal(JSON.parse(originals[0] ?? "{}").conversations?.length ?? 0, 0, "Use a fresh isolated WebView, never real chats"); verified = true;
  const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  const invokeError = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)}).then(() => '', String)`);
  const fill = async (selector, text) => { await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); }`); await command("Input.insertText", { text }); };
  const clickText = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(button => button.innerText.includes(${JSON.stringify(text)})).click()`);
  const stored = () => evaluate("JSON.parse(localStorage.getItem('modelport.chat.v1') ?? '{}')");
  const currentServer = async () => (await invoke("list_mcp_servers")).find(entry => entry.name === fixtureName);
  const closeSettings = async () => { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); };
  const send = async text => { await fill(".composer textarea", text); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); };
  const done = async () => { await waitFor("!document.querySelector('[aria-label=\"停止生成\"]') && !document.querySelector('.mcp-approval-dialog')"); };
  const approval = async () => { await waitFor("Boolean(document.querySelector('.mcp-approval-dialog:modal'))"); return evaluate("({requestId:document.querySelector('.mcp-approval-dialog').dataset.requestId,approvalId:document.querySelector('.mcp-approval-dialog').dataset.approvalId})"); };
  const saveMcp = async () => { await evaluate("document.querySelector('.mcp-primary').click()"); await waitFor("document.querySelector('.mcp-primary').disabled && !document.querySelector('.mcp-primary').innerText.includes('处理中')"); };

  const provider = await invoke("add_custom_provider"); ownProviders.add(provider.id);
  await invoke("save_provider_config", { config: { ...provider, name: "MCP 本地模型验证", baseUrl: `${host}/v1`, chatPath: "/chat/completions", models: ["fixture-mcp"], networkCompatibility: false } });
  await reload();
  await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()");
  await clickText(".settings-nav button", "MCP"); await waitFor("Boolean(document.querySelector('.mcp-page'))");
  await evaluate("document.querySelector('.mcp-add').click()");
  await fill('[aria-label="MCP 服务名称"]', fixtureName);
  await fill('[aria-label="MCP 服务地址"]', "http://remote.invalid/mcp");
  assert.ok(await evaluate("document.querySelector('.mcp-primary').disabled"));
  assert.match(await evaluate("document.querySelector('.mcp-inline-error').innerText"), /HTTPS/);
  await fill('[aria-label="MCP 服务地址"]', `${host}/mcp`); await saveMcp();
  const saved = await currentServer(); assert.ok(saved); ownServers.add(saved.id); assert.equal(saved.enabled, false); assert.equal(saved.hasToken, false);
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"MCP 访问令牌\"]').value"), "");
  await clickText(".mcp-actions button", "连接测试"); await waitFor("document.querySelector('.mcp-notice')?.innerText.includes('连接测试成功')");
  assert.equal(toolCalls.length, 0); assert.ok(await evaluate("document.querySelector('.mcp-tool')?.innerText.includes('fixture_lookup')"));
  assert.ok(requests.some(entry => entry.body?.method === "server/discover") && requests.some(entry => entry.body?.method === "initialize"));
  console.log("PASS: MCP settings creation defaults disabled; remote HTTP blocked; legacy fallback metadata test executes zero tools");
  const fakeToken = "modelport-mcp-fixture-token-not-a-real-secret";
  await fill('input[aria-label="MCP 访问令牌"]', fakeToken);
  await clickText(".mcp-token button", "保存令牌");
  await waitFor("document.querySelector('input[aria-label=\"MCP 访问令牌\"]').value === '' && document.querySelector('.mcp-token').innerText.includes('已保存')");
  const withToken = await currentServer(); assert.equal(withToken.hasToken, true); assert.notEqual(withToken.revision, saved.revision);
  assert.ok(!JSON.stringify(withToken).includes(fakeToken)); assert.ok(!JSON.stringify(await stored()).includes(fakeToken));
  await clickText(".mcp-actions button", "连接测试"); await waitFor("document.querySelector('.mcp-notice')?.innerText.includes('连接测试成功')");
  assert.equal(requests.at(-1).auth, `Bearer ${fakeToken}`); assert.equal(toolCalls.length, 0);
  const blockedHost = await invokeError("save_mcp_server", { config: { id: withToken.id, revision: withToken.revision, name: withToken.name, url: `${host}/other-mcp`, enabled: false, disabledTools: [] } });
  assert.match(blockedHost, /旧令牌/); assert.equal((await currentServer()).url, `${host}/mcp`);
  await clickText(".mcp-token button", "删除令牌"); await waitFor("document.querySelector('.mcp-token').innerText.includes('未保存')");
  assert.equal((await currentServer()).hasToken, false);
  console.log("PASS: synthetic token stays in native vault, input clears, endpoint edits blocked until token removal; never forwarded to model");
  acceptDialog = false; await evaluate("document.querySelector('.mcp-enable input').click()");
  assert.equal(await evaluate("document.querySelector('.mcp-enable input').checked"), false);
  acceptDialog = true; await evaluate("document.querySelector('.mcp-enable input').click()"); await saveMcp();
  assert.equal((await currentServer()).enabled, true); assert.ok(confirmTexts.some(text => text.includes("系统权限") && text.includes("产生费用")));
  await clickText(".mcp-actions button", "连接测试"); await waitFor("document.querySelector('.mcp-notice')?.innerText.includes('连接测试成功')");
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("document.querySelector('.settings-dialog').getBoundingClientRect().right <= innerWidth && document.querySelector('.mcp-editor').scrollWidth <= document.querySelector('.mcp-editor').clientWidth + 1"));
  await command("Emulation.clearDeviceMetricsOverride");
  await evaluate("document.querySelector('.settings-content').scrollTop = 0");
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await closeSettings(); await evaluate("document.querySelector('.model-trigger').click()");
  await clickText(".model-menu button", "fixture-mcp");
  await evaluate("document.querySelector('.mcp-chat-picker').open = true");
  await evaluate(`[...document.querySelectorAll('.mcp-chat-menu label')].find(label => label.innerText.includes(${JSON.stringify(fixtureName)})).querySelector('input').click()`);
  await evaluate("document.querySelector('.mcp-chat-picker').open = false");
  await send("拒绝测试"); await approval();
  assert.equal(toolCalls.length, 0, "No execution before approval");
  assert.ok(await evaluate("document.activeElement.classList.contains('mcp-deny')"));
  const dialogText = await evaluate("document.querySelector('.mcp-approval-dialog').innerText");
  for (const text of [fixtureName, `${host}/mcp`, "fixture_lookup", "fixture-data", "fixture-mcp", "产生费用", "结果接收方", "系统沙箱"]) assert.ok(dialogText.includes(text), text);
  if (process.argv[4]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[4], Buffer.from(data, "base64")); }
  await evaluate("document.querySelector('.mcp-deny').click()"); await done();
  assert.equal(toolCalls.length, 0); assert.equal((await stored()).conversations[0].messages.at(-1).toolRounds[0].toolResults[0].status, "denied");
  assert.ok(modelRequests.at(-1).messages.some(message => message.role === "tool" && message.content.includes("拒绝")));
  console.log("PASS: mandatory modal shows exact destination/arguments; default focus deny; denying yields tool result without execution");

  await send("允许测试"); await approval(); assert.equal(toolCalls.length, 0);
  await evaluate("document.querySelector('.mcp-allow').click()"); await done();
  assert.deepEqual(toolCalls, [{ name: "fixture_lookup", arguments: { query: "fixture-data" } }]);
  assert.ok(await evaluate("document.querySelector('.message.assistant:last-child')?.innerText.includes('工具确认完成')"));
  assert.equal((await stored()).conversations[0].messages.at(-1).toolRounds[0].toolResults[0].status, "completed");
  const beforeNext = modelRequests.length;
  await send("再次调用，历史不能重放"); await approval(); assert.equal(toolCalls.length, 1);
  const withHistory = modelRequests[beforeNext]; assert.ok(withHistory.messages.some(message => message.role === "tool" && message.content.includes("MCP_FIXTURE_RESULT_ONLY")));
  await evaluate("document.querySelector('[aria-label=\"拒绝操作并关闭\"]').click()"); await done(); assert.equal(toolCalls.length, 1);
  console.log("PASS: exactly one approved native tools/call; full history is sent as context and never replays previous operations");

  await send("停止等待授权"); const stopped = await approval();
  await invoke("cancel_chat", { requestId: stopped.requestId }); await done(); assert.equal(toolCalls.length, 1);
  const stale = await invokeError("decide_mcp_tool", { requestId: stopped.requestId, approvalId: stopped.approvalId, allow: true });
  assert.ok(stale.length, "Expired approval must not execute"); assert.equal(toolCalls.length, 1);
  await send("BAD_SCHEMA 参数校验"); await done();
  assert.equal(toolCalls.length, 1); assert.ok(!await evaluate("Boolean(document.querySelector('.mcp-approval-dialog'))"));
  assert.equal((await stored()).conversations[0].messages.at(-1).toolRounds[0].toolResults[0].status, "failed");
  console.log("PASS: cancel during approval executes nothing; stale decision rejected; wrong-schema arguments blocked before approval");

  await send("授权期间配置改变"); const changedApproval = await approval();
  const beforeChange = await currentServer();
  const changed = await invoke("save_mcp_server", { config: { id: beforeChange.id, revision: beforeChange.revision, name: beforeChange.name, url: beforeChange.url, enabled: false, disabledTools: [] } });
  assert.notEqual(changed.revision, beforeChange.revision);
  await invoke("decide_mcp_tool", { requestId: changedApproval.requestId, approvalId: changedApproval.approvalId, allow: true }); await done();
  assert.equal(toolCalls.length, 1, "A decision for the old config cannot execute after disabling the server");
  assert.equal((await stored()).conversations[0].messages.at(-1).toolRounds[0].toolResults[0].status, "failed");
  console.log("PASS: configuration changes invalidate an outstanding approval before any native execution");

  const redirect = await invoke("save_mcp_server", { config: { id: "", revision: "", name: `${fixtureName} redirect`, url: `${host}/mcp-redirect`, enabled: false, disabledTools: [] } }); ownServers.add(redirect.id);
  const beforeRedirect = requests.length;
  const redirectError = await invokeError("test_mcp_server", { selection: { id: redirect.id, revision: redirect.revision } });
  assert.ok(redirectError.length); assert.equal(requests.length, beforeRedirect + 1); assert.equal(requests.at(-1).path, "/mcp-redirect");
  const beforeReload = { calls: toolCalls.length, models: modelRequests.length }; await reload();
  assert.equal(toolCalls.length, beforeReload.calls); assert.equal(modelRequests.length, beforeReload.models);
  assert.ok(await evaluate("document.querySelector('.mcp-chat-trace')?.innerText.includes('不会自动重放')"));
  assert.ok(await evaluate("document.querySelector('.mcp-chat-picker summary').innerText.includes('工具')"));
  assert.ok((await stored()).conversations[0].messages.some(message => message.toolRounds?.length));
  assert.ok(requests.filter(entry => entry.path.startsWith('/v1/')).every(entry => entry.auth === undefined), "MCP token must never be sent to the model");
  assert.ok(requests.every(entry => entry.auth === undefined || entry.auth === `Bearer ${fakeToken}`), "Only the synthetic test token can occur");
  assert.ok(await evaluate("document.querySelector('.mcp-chat-menu')?.textContent.includes('不携带原始工具结果')"));
  assert.deepEqual(exceptions, []);
  console.log("PASS: redirect is not followed; reload restores inert trace/history without model/tool replay; no tokens or page exceptions");
} finally {
  if (client) {
    if (verified) {
      await client.evaluate("document.querySelector('.mcp-deny')?.click(); document.querySelector('[aria-label=\"停止生成\"]')?.click()").catch(() => {});
      await client.waitFor("!document.querySelector('[aria-label=\"停止生成\"]')").catch(() => {});
    }
    for (const id of ownServers) {
      await client.evaluate(`window.__TAURI_INTERNALS__.invoke('list_mcp_servers').then(servers => { const server=servers.find(item=>item.id===${JSON.stringify(id)}); if(server) return window.__TAURI_INTERNALS__.invoke('remove_mcp_server',{selection:{id:server.id,revision:server.revision}}); })`).catch(error => console.error(`Fixture service cleanup failed: ${String(error)}`));
    }
    for (const id of ownProviders) await client.evaluate(`window.__TAURI_INTERNALS__.invoke('remove_custom_provider',{provider:${JSON.stringify(id)}})`).catch(error => console.error(`Fixture provider cleanup failed: ${String(error)}`));
    if (verified) {
      for (const [index, key] of keys.entries()) await client.evaluate(originals[index] === null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(originals[index])})`).catch(() => {});
      await client.command("Emulation.clearDeviceMetricsOverride").catch(() => {}); await client.reload().catch(() => {});
    }
    client.close();
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
