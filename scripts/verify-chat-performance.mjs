// Fresh isolated WebView; synthetic history and a loopback model, never cloud calls.
// node scripts/verify-chat-performance.mjs <debug-port>
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connectDesktop } from "./desktop-client.mjs";
import { chatStorageRawExpression, desktopChatStateExpression, legacyChatSeedExpression, restoreChatStorageExpression } from "./chat-storage-fixture.mjs";

const expectedBurst = "BURST:" + Array.from({ length: 400 }, (_,i) => String(i % 10)).join("") + ":TAIL";
const timers = new Set();
const server = createServer(async (request, response) => {
  let text = ""; for await (const chunk of request) text += chunk;
  const body = JSON.parse(text);
  response.setHeader("content-type", "text/event-stream");
  const delta = content => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  if (body.model === "fixture-burst") {
    delta("BURST:"); for (let i = 0; i < 400; i++) delta(String(i % 10)); delta(":TAIL");
    response.end("data: [DONE]\n\n");
  } else {
    delta("STOP:"); const timer = setInterval(() => delta("继续"), 20); timers.add(timer);
    response.on("close", () => { clearInterval(timer); timers.delete(timer); });
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let client, verified = false, originalChat, originalPreferences, providerId;
const exceptions = [];
try {
  client = await connectDesktop(Number(process.argv[2] ?? 9364));
  const { command, evaluate, waitFor, reload, on } = client;
  on("Page.javascriptDialogOpening", () => void command("Page.handleJavaScriptDialog", { accept: true }));
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await command("Page.enable"); await command("Runtime.enable");
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originalChat = await evaluate(chatStorageRawExpression);
  originalPreferences = await evaluate("localStorage.getItem('modelport.preferences.chat.v1')");
  assert.equal((await evaluate(desktopChatStateExpression)).conversations.length, 0, "Never run against real chats"); verified = true;
  const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
  const chats = () => evaluate(desktopChatStateExpression);
  const index = () => evaluate("JSON.parse(localStorage.getItem('modelport.chat.v2'))");
  const fill = async value => { await evaluate("document.querySelector('.composer textarea').focus()"); await command("Input.insertText", { text: value }); };
  const clickConversation = name => evaluate(`[...document.querySelectorAll('.conversation-section button')].find(button => button.innerText.includes(${JSON.stringify(name)})).click()`);
  const model = { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O" };
  const history = { activeConversationId: "long", conversations: [{ id: "long", title: "千条历史验证", date: "10/10", model,
    messages: Array.from({ length: 1000 }, (_,i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", content: `fixture message ${i} ` + "历史内容 ".repeat(12) })) },
    { id: "other", title: "不应重写的会话", date: "10/10", model, messages: [{ id: "other-user", role: "user", content: "保留不变" }] }] };
  await evaluate("localStorage.setItem('modelport.preferences.chat.v1', JSON.stringify({ renderMarkdown: false, sendShortcut: 'enter', sendWithoutReplyShortcut: 'ctrl-enter' }))");
  await evaluate(legacyChatSeedExpression(JSON.stringify(history)));
  const start = performance.now(); await reload();
  await waitFor("document.querySelectorAll('.message').length === 80 && Boolean(document.querySelector('.load-older-messages'))");
  const visibleReadyMs = +(performance.now() - start).toFixed(1);
  assert.equal((await chats()).conversations[0].messages.length, 1000);
  assert.equal(await evaluate("document.querySelector('.message').dataset.messageId"), "m920");
  assert.equal(await evaluate("localStorage.getItem('modelport.chat.v1')"), null, "Successful migration removes legacy storage only after commit");
  await evaluate("document.querySelector('.conversation-canvas').scrollTop = 500");
  const beforeScroll = await evaluate("({ height: document.querySelector('.conversation-canvas').scrollHeight, top: document.querySelector('.conversation-canvas').scrollTop })");
  await evaluate("document.querySelector('.load-older-messages').click()");
  await waitFor("document.querySelectorAll('.message').length === 160");
  const afterScroll = await evaluate("({ height: document.querySelector('.conversation-canvas').scrollHeight, top: document.querySelector('.conversation-canvas').scrollTop })");
  assert.ok(Math.abs(afterScroll.top - beforeScroll.top - (afterScroll.height - beforeScroll.height)) <= 3, "Loading older messages preserves the visible scroll position");
  await clickConversation("不应重写的会话"); await clickConversation("千条历史验证");
  await waitFor("document.querySelectorAll('.message').length === 80");
  const otherKey = (await index()).conversations.find(entry => entry.id === "other").key;
  await evaluate("window.__performanceWrites = []; window.__performanceSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('modelport.chat.v2')) window.__performanceWrites.push(key); return window.__performanceSetItem.call(this, key, value); }");
  await fill("PAGINATION_SAVED_NOTE");
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await waitFor(`${desktopChatStateExpression}.conversations.find(chat => chat.id === 'long').messages.length === 1001`);
  assert.equal((await index()).conversations.find(entry => entry.id === "other").key, otherKey);
  assert.equal((await evaluate("window.__performanceWrites")).filter(key => key.includes('.conversation.')).length, 1);
  assert.equal((await chats()).conversations.find(chat => chat.id === "long").messages.at(-1).savedOnly, true);

  const provider = await invoke("add_custom_provider"); providerId = provider.id;
  await invoke("save_provider_config", { config: { ...provider, name: "性能回归临时提供商", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, chatPath: "/chat/completions", models: ["fixture-burst", "fixture-stop"], networkCompatibility: false } });
  await evaluate("Storage.prototype.setItem = window.__performanceSetItem"); await reload();
  await evaluate("document.querySelector('.primary-actions button').click()");
  const chooseModel = async id => {
    await evaluate("document.querySelector('.model-trigger').click()");
    await evaluate(`[...document.querySelectorAll('.model-menu button')].find(button => button.querySelector('strong')?.innerText === ${JSON.stringify(id)}).click()`);
  };
  await chooseModel("fixture-burst");
  await evaluate("window.__performanceWrites = []; window.__performanceSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('modelport.chat.v2')) window.__performanceWrites.push(key); return window.__performanceSetItem.call(this, key, value); }");
  await fill("只调用本地测试服务"); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("!document.querySelector('[aria-label=\"停止生成\"]') && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes(':TAIL')");
  assert.equal((await chats()).conversations[0].messages.at(-1).content, expectedBurst);
  const streamRecordWrites = (await evaluate("window.__performanceWrites")).filter(key => key.includes('.conversation.')).length;
  assert.ok(streamRecordWrites <= 8, "Hundreds of tokens must not cause hundreds of synchronous saves");
  await chooseModel("fixture-stop"); await fill("测试停止时的最后一段文字"); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("Boolean(document.querySelector('[aria-label=\"停止生成\"]')) && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('继续')");
  await evaluate("document.querySelector('[aria-label=\"停止生成\"]').click()");
  await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')");
  await waitFor(`${desktopChatStateExpression}.conversations[0].messages.at(-1).status === 'stopped'`);
  const stopped = (await chats()).conversations[0].messages.at(-1);
  assert.equal(stopped.status, "stopped"); assert.ok(stopped.content.startsWith("STOP:") && stopped.content.includes("继续"));
  await evaluate("Storage.prototype.setItem = window.__performanceSetItem"); await reload();
  assert.equal((await chats()).conversations[0].messages.at(-1).content, stopped.content);
  // A damaged v2 child must freeze writes while leaving unrelated history readable.
  const current = await index(), damagedKey = current.conversations[0].key;
  await evaluate(`localStorage.setItem(${JSON.stringify(damagedKey)}, '{"messages":')`); await reload();
  await waitFor("document.querySelector('.chat-error')?.innerText.includes('暂停保存')");
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(damagedKey)})`), '{"messages":');
  assert.ok(await evaluate("[...document.querySelectorAll('.conversation-title')].some(title => title.innerText.includes('千条历史验证'))"));
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ passed: true, storedMessages: 1000, initialRenderedMessages: 80, loadedOlderMessages: 160,
    visibleReadyMs, burstTokens: 402, streamRecordWrites, stoppedTextPreserved: true, damagedRecordProtected: true }, null, 2));
} finally {
  if (client && verified) {
    await client.evaluate("if (window.__performanceSetItem) Storage.prototype.setItem = window.__performanceSetItem; document.querySelector('[aria-label=\"停止生成\"]')?.click()").catch(() => {});
    await client.waitFor("!document.querySelector('[aria-label=\"停止生成\"]')").catch(() => {});
    if (providerId) await client.evaluate(`window.__TAURI_INTERNALS__.invoke('remove_custom_provider', { provider: ${JSON.stringify(providerId)} }).catch(() => null)`).catch(() => {});
    await client.evaluate(restoreChatStorageExpression(originalChat)).catch(() => {});
    await client.evaluate(originalPreferences === null ? "localStorage.removeItem('modelport.preferences.chat.v1')" : `localStorage.setItem('modelport.preferences.chat.v1', ${JSON.stringify(originalPreferences)})`).catch(() => {});
    await client.reload().catch(() => {});
  }
  client?.close(); for (const timer of timers) clearInterval(timer);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
