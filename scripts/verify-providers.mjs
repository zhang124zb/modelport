import { desktopChatStateExpression, chatStorageRawExpression, restoreChatStorageExpression } from "./chat-storage-fixture.mjs";
// Fresh isolated WebView only; localhost OpenAI-compatible fixture, never real cloud credentials.
// node scripts/verify-providers.mjs <CDP-port> [screenshot.png]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";
const requests = [], intervals = new Set(), ownIds = new Set();
const server = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ path: req.url, method: req.method, body, auth: req.headers.authorization, httpVersion: req.httpVersion });
  if (req.url === "/v1/other/models") { res.statusCode = 302; res.setHeader("location", "/v1/models"); return res.end(); }
  if (req.method === "GET" && req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ data: ["fixture-chat", "fixture-slow", "fixture-error"].map(id => ({ id })) }));
  }
  if (req.method === "POST" && ["/v1/chat/completions", "/v1/custom/chat"].includes(req.url)) {
    if (body.model === "fixture-error") { res.statusCode = 400; return res.end("{}"); }
    res.setHeader("content-type", "text/event-stream");
    const delta = text => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    delta("本地接口回复：");
    if (body.model === "fixture-slow") {
      const timer = setInterval(() => delta("继续生成。"), 500); intervals.add(timer);
      res.on("close", () => { clearInterval(timer); intervals.delete(timer); }); return;
    }
    delta("ModelPort 自定义提供商已成功连接。"); return res.end("data: [DONE]\n\n");
  }
  res.statusCode = 404; res.end("{}");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const host = `http://127.0.0.1:${server.address().port}/v1`;
let client, originals, verified = false;
const keys = ["modelport.chat.v1", "modelport.preferences.models.v1", "modelport.preferences.general.v1", "modelport.preferences.chat.v1"];
const exceptions = [];
let acceptDialog = true;
try {
  client = await connectDesktop(Number(process.argv[2] ?? 9390));
  const { command, evaluate, waitFor, reload, on } = client;
  on("Page.javascriptDialogOpening", () => void command("Page.handleJavaScriptDialog", { accept: acceptDialog }));
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await command("Page.enable"); await command("Runtime.enable");
  originals = await Promise.all(keys.map(key => evaluate(key === "modelport.chat.v1" ? chatStorageRawExpression : `localStorage.getItem(${JSON.stringify(key)})`)));
  assert.equal((await evaluate(desktopChatStateExpression)).conversations?.length ?? 0, 0, "Use a fresh isolated WebView, never real chats"); verified = true;
  const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  const fill = async (selector, text) => { await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); }`); await command("Input.insertText", { text }); };
  const section = async label => { await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText.trim() === ${JSON.stringify(label)}).click()`); await waitFor(`document.querySelector('#settings-page-title').innerText === ${JSON.stringify(label)}`); };
  const settings = async () => { await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()"); await waitFor("Boolean(document.querySelector('.settings-dialog:modal'))"); await section("模型提供方"); };
  const save = async () => { await evaluate("document.querySelector('.provider-save').click()"); await waitFor("document.querySelector('.provider-save').disabled && !document.querySelector('.provider-save').innerText.includes('处理中')"); };
  const close = async () => { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); };
  const create = async () => {
    const previous = await evaluate("document.querySelector('.provider-card.selected').dataset.providerId");
    await evaluate("document.querySelector('.provider-add').click()");
    await waitFor(`document.querySelector('.provider-card.selected').dataset.providerId !== ${JSON.stringify(previous)} && document.querySelector('.provider-card.selected').dataset.providerId.startsWith('custom-') && Boolean(document.querySelector('[aria-label="提供商名称"]'))`);
    const id = await evaluate("document.querySelector('.provider-card.selected').dataset.providerId"); ownIds.add(id); return id;
  };
  const selectModel = async id => { await evaluate("document.querySelector('.model-trigger').click()"); await evaluate(`[...document.querySelectorAll('.model-menu button')].find(button => button.querySelector('strong')?.innerText === ${JSON.stringify(id)}).click()`); };
  const send = async text => { await fill(".composer textarea", text); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); };
  const stored = () => evaluate(desktopChatStateExpression);
  await settings();
  const expectedVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.ok(await evaluate(`document.querySelector('.utility-nav .muted').innerText.includes(${JSON.stringify(expectedVersion)})`), "Desktop must contain the latest embedded frontend");
  const labels = await evaluate("[...document.querySelectorAll('.provider-card strong')].map(el => el.innerText)");
  for (const label of ["Google Gemini", "Anthropic Claude", "通义千问 · 阿里云百炼", "Kimi · Moonshot"]) assert.ok(labels.includes(label));
  await evaluate("[...document.querySelectorAll('.provider-card')].find(button => button.innerText.includes('Anthropic Claude')).click()");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"API 模式\"]').value"), "anthropic");
  assert.match(await evaluate("document.querySelector('.provider-url-preview').innerText"), /api.anthropic.com\/v1\/messages/);
  console.log("PASS: four new providers render; Claude uses its native protocol and official address");
  const primary = await create();
  await fill('[aria-label="提供商名称"]', "ModelPort 本地测试"); await fill('[aria-label="API 主机"]', host); await fill('[aria-label="API 路径"]', "/custom/chat");
  acceptDialog = false; await evaluate("document.querySelector('[data-provider-id=\"openai\"]').click()");
  assert.equal(await evaluate("document.querySelector('.provider-card.selected').dataset.providerId"), primary); acceptDialog = true;
  await evaluate("document.querySelector('.provider-network input').click()");
  await fill('[aria-label="新模型 ID"]', "fixture-chat"); await evaluate("document.querySelector('.provider-model-create button').click()");
  await save();
  await evaluate("document.querySelector('.provider-models-heading button').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('连接成功')");
  assert.equal(requests.at(-1).path, "/v1/models"); assert.equal(requests.at(-1).auth, undefined);
  const saved = (await invoke("list_provider_configs")).find(config => config.id === primary);
  assert.equal(saved.name, "ModelPort 本地测试"); assert.equal(saved.chatPath, "/custom/chat"); assert.equal(saved.networkCompatibility, true); assert.equal(requests.at(-1).httpVersion, "1.1"); assert.deepEqual(saved.models, ["fixture-chat", "fixture-slow", "fixture-error"]);
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("document.querySelector('.settings-dialog').getBoundingClientRect().right <= innerWidth && document.querySelector('.provider-editor').scrollWidth <= document.querySelector('.provider-editor').clientWidth + 1"));
  await command("Emulation.clearDeviceMetricsOverride");
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  console.log("PASS: custom host/path, manual models, discovery, native persistence and compact layout");
  await section("默认模型");
  await evaluate(`{ const el = document.querySelector('#default-chat-model'); el.value = ${JSON.stringify(`${primary}:fixture-chat`)}; el.dispatchEvent(new Event('change', { bubbles:true })); }`);
  await evaluate("document.querySelector('.defaults-settings-save').click()"); await waitFor("document.querySelector('.defaults-settings-save').disabled"); await close();
  await reload(); await waitFor("document.querySelector('.model-trigger').innerText.includes('fixture-chat')");
  await send("测试自定义模型的完整聊天链路"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]') && document.querySelector('.message.assistant')?.innerText.includes('已成功连接')");
  assert.equal(requests.at(-1).path, "/v1/custom/chat"); assert.equal(requests.at(-1).body.model, "fixture-chat");
  assert.equal((await stored()).conversations[0].model.provider, primary);
  await selectModel("fixture-slow"); await send("测试停止生成"); await waitFor("document.querySelector('.message.assistant:last-child')?.innerText.includes('本地接口回复') && Boolean(document.querySelector('[aria-label=\"停止生成\"]'))");
  await evaluate("document.querySelector('[aria-label=\"停止生成\"]').click()"); await waitFor("!document.querySelector('.stop-button')");
  await waitFor(`${desktopChatStateExpression}.conversations[0].messages.at(-1).status === 'stopped'`);
  const beforeFailure = requests.length;
  const failure = await evaluate(`window.__TAURI_INTERNALS__.invoke('send_chat', { provider:${JSON.stringify(primary)}, model:'fixture-error', messages:[{role:'user',content:'error check'}] }).then(() => '', String)`);
  assert.match(failure, /HTTP 400/); assert.equal(requests.length, beforeFailure + 1);
  console.log("PASS: restart/default model, real native HTTP chat, custom path, partial cancellation and error handling");
  await settings(); const keyed = await create();
  await fill('[aria-label="提供商名称"]', "ModelPort 密钥隔离测试"); await fill('[aria-label="API 主机"]', host); await fill('[aria-label="API 密钥"]', "modelport-provider-test-key");
  await evaluate("document.querySelector('[aria-label=\"显示密钥\"]').click()"); assert.equal(await evaluate("document.querySelector('[aria-label=\"API 密钥\"]').type"), "text");
  await save(); assert.equal(await invoke("has_provider_key", { provider: keyed }), true); assert.equal(await invoke("has_provider_key", { provider: primary }), false);
  await evaluate("document.querySelector('.provider-check').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('连接成功')"); assert.equal(requests.at(-1).auth, "Bearer modelport-provider-test-key");
  await fill('[aria-label="API 主机"]', `${host}/other`); await evaluate("document.querySelector('.provider-save').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('旧密钥')");
  assert.equal((await invoke("list_provider_configs")).find(config => config.id === keyed).baseUrl, host);
  await evaluate("document.querySelector('.remove-key').click()"); await waitFor("!document.querySelector('.remove-key')"); assert.equal(await invoke("has_provider_key", { provider: keyed }), false);
  await save();
  const beforeRedirect = requests.length;
  const redirect = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_available_models', { provider:${JSON.stringify(keyed)} }).then(() => '', String)`);
  assert.match(redirect, /HTTP 302/); assert.equal(requests.length, beforeRedirect + 1, "Native request must not follow redirects");
  await evaluate("document.querySelector('[aria-label=\"删除自定义提供商\"]').click()"); await waitFor("!document.querySelector('[aria-label=\"提供商名称\"]')"); ownIds.delete(keyed);
  console.log("PASS: distinct vault entries, key visibility/check, host-change protection and key deletion");
  await evaluate("[...document.querySelectorAll('.provider-card')].find(button => button.innerText.includes('ModelPort 本地测试')).click()");
  const chatsBefore = (await stored()).conversations.length;
  await evaluate("document.querySelector('[aria-label=\"删除自定义提供商\"]').click()"); await waitFor("!document.querySelector('[aria-label=\"提供商名称\"]')"); ownIds.delete(primary);
  assert.equal((await stored()).conversations.length, chatsBefore);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('modelport.preferences.models.v1')).chatModel.provider"), primary);
  const beforeDeleted = requests.length;
  const deleted = await evaluate(`window.__TAURI_INTERNALS__.invoke('send_chat', { provider:${JSON.stringify(primary)}, model:'fixture-chat', messages:[{role:'user',content:'deleted check'}] }).then(() => '', String)`);
  assert.match(deleted, /已删除或不存在/); assert.equal(requests.length, beforeDeleted);
  assert.deepEqual(exceptions, []);
  console.log("PASS: deleting custom providers preserves chats/default references; no cross-provider fallback; no page exceptions");
} finally {
  if (client) {
    for (const id of ownIds) await client.evaluate(`window.__TAURI_INTERNALS__.invoke('remove_custom_provider', {provider:${JSON.stringify(id)}}).catch(() => null)`).catch(() => {});
    if (verified) {
      for (let i = 0; i < keys.length; i++) await client.evaluate(keys[i] === "modelport.chat.v1" ? restoreChatStorageExpression(originals[i]) : originals[i] === null ? `localStorage.removeItem(${JSON.stringify(keys[i])})` : `localStorage.setItem(${JSON.stringify(keys[i])},${JSON.stringify(originals[i])})`).catch(() => {});
      await client.reload().catch(() => {});
    }
    client.close();
  }
  for (const interval of intervals) clearInterval(interval);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
