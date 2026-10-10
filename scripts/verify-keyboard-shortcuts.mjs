import { desktopChatStateExpression, chatStorageRawExpression, legacyChatSeedExpression, restoreChatStorageExpression } from "./chat-storage-fixture.mjs";
// Fresh isolated desktop profile only. Loopback model fixture; no Ollama/cloud dependency or real credentials.
// node scripts/verify-keyboard-shortcuts.mjs 9350 [keyboard.png]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
const preferencesKey = "modelport.preferences.chat.v1", chatKey = "modelport.chat.v1";
let originalPreferences, originalChat, verified = false, acceptDialog = true, dialogs = 0;
const exceptions = [];
let fixtureProvider;
const fixtureServer = createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(body.model, "fixture-shortcuts");
  response.setHeader("content-type", "text/event-stream");
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "MODELPORT_KEYBOARD_VERIFIED" } }] })}\n\ndata: [DONE]\n\n`);
});
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const stored = key => evaluate(key === "modelport.chat.v1" ? chatStorageRawExpression : `localStorage.getItem(${JSON.stringify(key)})`);
const chat = async () => await evaluate(desktopChatStateExpression);
const preferences = async () => JSON.parse(await stored(preferencesKey));
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) });
}
async function fill(selector, text) { await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); }`); await command("Input.insertText", { text }); }
async function select(id, value) { await evaluate(`{ const el = document.getElementById('${id}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); }`); }
async function section(label) { await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === ${JSON.stringify(label)}).click()`); await waitFor(`document.querySelector('#settings-page-title').innerText === ${JSON.stringify(label)}`); }
async function settings(label = "键盘快捷键") { await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()"); await section(label); }
async function closeSettings() { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); }
async function saveKeyboard() { await evaluate("document.querySelector('.keyboard-settings-save').click()"); await waitFor("document.querySelector('.keyboard-settings-save').disabled && document.querySelector('.chat-settings-notice')?.innerText.includes('快捷键已保存')"); }
async function trackRequests() {
  await command("Debugger.disable"); await command("Debugger.enable"); await evaluate("window.__shortcutRequests = []");
  const { result } = await command("Runtime.evaluate", { expression: "window.__TAURI_INTERNALS__.invoke" });
  await command("Debugger.setBreakpointOnFunctionCall", { objectId: result.objectId,
    condition: "arguments[0] === 'stream_chat' && (window.__shortcutRequests.push({ provider: arguments[1].provider, messages: arguments[1].messages }), false)",
  });
}
async function saveNote(text, modifiers = 2) { await fill(".composer textarea", text); await key("Enter", "Enter", 13, modifiers); await waitFor(`document.querySelector('.composer textarea').value === '' && [...document.querySelectorAll('.message.user')].at(-1)?.innerText.includes(${JSON.stringify(text)})`); }
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originalPreferences = await stored(preferencesKey); originalChat = await stored(chatKey);
  assert.equal(originalPreferences, null, "Use a fresh isolated WebView"); assert.equal((await chat()).conversations?.length ?? 0, 0, "Never run against real chats"); verified = true;
  await new Promise((resolve, reject) => { fixtureServer.once("error", reject); fixtureServer.listen(0, "127.0.0.1", resolve); });
  fixtureProvider = await evaluate("window.__TAURI_INTERNALS__.invoke('add_custom_provider')");
  await evaluate(`window.__TAURI_INTERNALS__.invoke('save_provider_config', { config: ${JSON.stringify({ ...fixtureProvider, name: "快捷键回归临时提供商", baseUrl: `http://127.0.0.1:${fixtureServer.address().port}/v1`, chatPath: "/chat/completions", models: ["fixture-shortcuts"], networkCompatibility: false })} })`);
  const marker = "MODELPORT_KEYBOARD_VERIFIED";
  const legacy = { sendShortcut: "ctrl-enter", contextTurns: 3, systemPrompt: `Reply ONLY ${marker}.`, renderMarkdown: false, fontSize: 18 };
  await evaluate(`localStorage.setItem('${preferencesKey}', ${JSON.stringify(JSON.stringify(legacy))})`); await reload();
  await settings(); assert.equal(await evaluate("document.querySelector('#chat-send-shortcut').value"), "ctrl-enter");
  assert.equal(await evaluate("document.querySelector('#chat-save-only-shortcut').value"), "none");
  assert.deepEqual(await preferences(), legacy);
  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()"); await saveKeyboard();
  assert.deepEqual(await preferences(), { ...legacy, sendShortcut: "enter", sendWithoutReplyShortcut: "ctrl-enter" });
  assert.equal(await evaluate("document.querySelectorAll('.keyboard-shortcut-row').length"), 8);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.keyboard-shortcut-row')].map(row => row.querySelector('span').innerText)"), ["发送", "发送但不生成回答", "创建新的对话", "新话题", "跳转到下一个会话", "跳转到上一个会话", "跳转到第N个会话", "显示/隐藏搜索弹窗"]);
  await select("chat-save-only-shortcut", "alt-enter"); acceptDialog = false;
  const before = dialogs; await section("键盘快捷键");
  await evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '常规设置').click()");
  await waitFor("document.querySelector('#settings-page-title').innerText === '键盘快捷键'"); assert.ok(dialogs > before);
  for (const action of [() => key("Escape", "Escape", 27), () => evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })")]) {
    const count = dialogs; await action();
    for (let attempt = 0; attempt < 30 && dialogs === count; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(dialogs > count && await evaluate("Boolean(document.querySelector('#chat-save-only-shortcut'))"));
  }
  const unchanged = await preferences();
  await evaluate(`{ window.__shortcutSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === '${preferencesKey}') throw new Error('quota'); return window.__shortcutSetItem.call(this, key, value); }; }`);
  await evaluate("document.querySelector('.keyboard-settings-save').click()"); await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('尚未生效')"); assert.deepEqual(await preferences(), unchanged);
  await evaluate("Storage.prototype.setItem = window.__shortcutSetItem"); acceptDialog = true; await saveKeyboard();
  await section("对话设置"); assert.ok(await evaluate("!document.querySelector('#chat-send-shortcut') && Boolean(document.querySelector('#chat-system-prompt'))"));
  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()");
  await evaluate("document.querySelector('.chat-settings-save').click()");
  await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('对话设置已保存')");
  assert.equal((await preferences()).sendWithoutReplyShortcut, "alt-enter");
  await section("常规设置"); assert.ok(await evaluate("document.querySelector('.settings-content').innerText.includes('启动行为')"));
  const prefsBeforeKeys = await stored(preferencesKey); await key("n", "KeyN", 78, 2); await key("k", "KeyK", 75, 2);
  assert.ok(await evaluate("Boolean(document.querySelector('.settings-dialog')) && !document.querySelector('.conversation-search-dialog')")); assert.equal(await stored(preferencesKey), prefsBeforeKeys);
  await section("键盘快捷键"); await select("chat-send-shortcut", "ctrl-enter"); await select("chat-save-only-shortcut", "alt-enter"); await saveKeyboard();
  assert.ok(await evaluate("document.querySelector('#chat-save-only-shortcut option[value=\"ctrl-enter\"]').disabled"));
  await select("chat-send-shortcut", "enter"); await select("chat-save-only-shortcut", "ctrl-enter"); await saveKeyboard();
  for (const [width, height] of [[1480, 960], [920, 680]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.keyboard-shortcuts-page'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
    assert.ok(await evaluate("(() => { const footer = document.querySelector('.chat-settings-actions').getBoundingClientRect(), dialog = document.querySelector('.settings-dialog').getBoundingClientRect(); return Math.abs(footer.bottom - dialog.bottom) < 3; })()"));
  }
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await command("Emulation.clearDeviceMetricsOverride"); await closeSettings();
  console.log("PASS: 8 shortcut rows, legacy preferences, independent defaults, save errors/leave guards, general navigation and minimum-window layout");

  await trackRequests();
  await evaluate("document.querySelector('.model-trigger').click()");
  await waitFor("[...document.querySelectorAll('.model-menu button')].some(button => button.querySelector('strong')?.innerText === 'fixture-shortcuts')");
  await evaluate("[...document.querySelectorAll('.model-menu button')].find(button => button.querySelector('strong')?.innerText === 'fixture-shortcuts').click()");
  await saveNote("第一条快捷键记录：搜索内容命中");
  assert.equal(await evaluate("window.__shortcutRequests.length"), 0); assert.ok(await evaluate("!document.querySelector('.modal-backdrop') && document.querySelector('.stream-note').innerText.includes('仅保存')"));
  for (const text of ["第二条快捷键记录", "第三条快捷键记录"]) { await key("n", "KeyN", 78, 2); await saveNote(text); }
  await waitFor(`${desktopChatStateExpression}.conversations.length === 3`);
  let state = await chat(); const ids = state.conversations.map(conversation => conversation.id);
  assert.ok(state.conversations.every(conversation => conversation.messages.length === 1 && conversation.messages[0].savedOnly && !conversation.messages[0].status));
  await key("Tab", "Tab", 9, 2); assert.equal((await chat()).activeConversationId, ids[1]);
  await key("Tab", "Tab", 9, 10); assert.equal((await chat()).activeConversationId, ids[0]);
  await key("1", "Digit1", 49, 2); await key("Tab", "Tab", 9, 10); assert.equal((await chat()).activeConversationId, ids[2]);
  await key("Tab", "Tab", 9, 2); assert.equal((await chat()).activeConversationId, ids[0]);
  await key("3", "Digit3", 51, 2); assert.equal((await chat()).activeConversationId, ids[2]);
  await key("9", "Digit9", 57, 2); assert.equal((await chat()).activeConversationId, ids[2]);
  await fill(".composer textarea", "保留未发送草稿"); acceptDialog = false; await key("n", "KeyN", 78, 2);
  assert.equal(await evaluate("document.querySelector('.composer textarea').value"), "保留未发送草稿"); assert.equal((await chat()).activeConversationId, ids[2]); acceptDialog = true;
  await key("Enter", "Enter", 13, 8); assert.ok(await evaluate("document.querySelector('.composer textarea').value.includes(String.fromCharCode(10))"));
  const count = state.conversations.flatMap(conversation => conversation.messages).length;
  await evaluate("document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, ctrlKey: true, bubbles: true })); document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, ctrlKey: true, bubbles: true }))");
  assert.equal((await chat()).conversations.flatMap(conversation => conversation.messages).length, count); assert.equal(await evaluate("window.__shortcutRequests.length"), 0);
  await fill(".composer textarea", "");
  await key("k", "KeyK", 75, 2); await waitFor("Boolean(document.querySelector('.conversation-search-dialog:modal'))"); assert.equal(await evaluate("document.activeElement.id"), "conversation-search-input");
  await fill("#conversation-search-input", "内容命中"); assert.equal(await evaluate("document.querySelectorAll('.conversation-search-results button').length"), 1);
  await evaluate("document.querySelector('.conversation-search-results button').click()"); await waitFor("!document.querySelector('.conversation-search-dialog')"); assert.equal((await chat()).activeConversationId, ids[2]);
  await key("k", "KeyK", 75, 2); await key("k", "KeyK", 75, 2); await waitFor("!document.querySelector('.conversation-search-dialog')");
  await evaluate("document.querySelector('[aria-label=\"搜索会话\"]').focus(); document.querySelector('[aria-label=\"搜索会话\"]').click()"); await key("Escape", "Escape", 27); await waitFor("!document.querySelector('.conversation-search-dialog')"); assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "搜索会话");
  await reload(); await waitFor("document.querySelector('.stream-note')?.innerText.includes('仅保存')");
  await evaluate("[...document.querySelectorAll('.utility-nav button')].find(button => button.innerText.includes('模型连接')).click()");
  await key("n", "KeyN", 78, 2); await key("k", "KeyK", 75, 2);
  assert.ok(await evaluate("Boolean(document.querySelector('.connection-modal')) && !document.querySelector('.conversation-search-dialog')")); assert.equal((await chat()).activeConversationId, ids[2]);
  await evaluate("document.querySelector('.connection-modal [aria-label=\"关闭设置\"]').click()");
  console.log("PASS: save-only performs no API call, 3 conversations persist, all navigation shortcuts wrap, draft/IME guards and local title/content search");

  const setup = { sendShortcut: "enter", sendWithoutReplyShortcut: "ctrl-enter", contextTurns: 3, systemPrompt: `Reply ONLY ${marker}.`, renderMarkdown: false, fontSize: 18 };
  state = await chat(); state.conversations.find(conversation => conversation.id === ids[2]).model = { id: "fixture-shortcuts", name: "fixture-shortcuts", provider: fixtureProvider.id, tone: "#111827", label: "T" };
  await evaluate(`localStorage.setItem('${preferencesKey}', ${JSON.stringify(JSON.stringify(setup))})`); await evaluate(legacyChatSeedExpression(JSON.stringify(state))); await reload();
  await key("N", "KeyN", 78, 10); await waitFor(`Boolean(${desktopChatStateExpression}.conversations.find(conversation => conversation.id === '` + ids[2] + "').newTopicPending)");
  await reload(); await waitFor("document.querySelector('.topic-divider')?.innerText.includes('下一条')"); await trackRequests();
  await saveNote("NEW_TOPIC_LOCAL_NOTE");
  const topicState = (await chat()).conversations.find(conversation => conversation.id === ids[2]); assert.ok(!topicState.newTopicPending && topicState.messages.at(-1).topicStart && topicState.messages.at(-1).savedOnly);
  await fill(".composer textarea", "Follow the current instruction."); await key("Enter", "Enter", 13);
  await waitFor("window.__shortcutRequests.length === 1"); await waitFor(`!document.querySelector('[aria-label="停止生成"]') && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('${marker}')`, 900);
  const request = await evaluate("window.__shortcutRequests[0]"); assert.equal(request.provider, fixtureProvider.id); assert.deepEqual(request.messages, [{ role: "user", content: "NEW_TOPIC_LOCAL_NOTE" }, { role: "user", content: "Follow the current instruction." }]);
  assert.ok((await chat()).conversations.find(conversation => conversation.id === ids[2]).messages[0].content.includes("第一条"));
  await settings(); await select("chat-save-only-shortcut", "alt-enter"); await saveKeyboard(); await closeSettings(); await saveNote("ALT_ENTER_LOCAL_NOTE", 1);
  assert.equal(await evaluate("window.__shortcutRequests.length"), 1);
  state = await chat(); const retryConversation = state.conversations.find(conversation => conversation.id === ids[2]);
  retryConversation.messages.push({ id: "shortcut-failed-topic", role: "user", content: "FAILED_TOPIC_QUESTION", topicStart: true, status: "failed" });
  await evaluate(legacyChatSeedExpression(JSON.stringify(state))); await reload();
  await evaluate("[...document.querySelectorAll('.chat-error button')].find(button => button.innerText === '编辑并重试').click()");
  assert.ok((await chat()).conversations.find(conversation => conversation.id === ids[2]).newTopicPending);
  assert.equal(await evaluate("document.querySelector('.composer textarea').value"), "FAILED_TOPIC_QUESTION");
  await trackRequests(); await key("Enter", "Enter", 13);
  await waitFor("window.__shortcutRequests.length === 1"); await waitFor(`!document.querySelector('[aria-label="停止生成"]') && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('${marker}')`, 900);
  assert.deepEqual((await evaluate("window.__shortcutRequests[0]")).messages, [{ role: "user", content: "FAILED_TOPIC_QUESTION" }]);
  assert.deepEqual(exceptions, []);
  console.log("PASS: new topic/retry exclude old history from actual native HTTP requests, preserve records across restart, Alt+Enter saves only, and connection modals block shortcuts");
} catch (error) {
  console.error("Keyboard verification failure:", await evaluate("({ title: document.querySelector('#settings-page-title')?.innerText, draft: document.querySelector('.composer textarea')?.value, requests: window.__shortcutRequests, error: document.querySelector('.chat-error')?.innerText })")); throw error;
} finally {
  if (verified) {
    await command("Debugger.disable"); await evaluate("if (window.__shortcutSetItem) Storage.prototype.setItem = window.__shortcutSetItem");
    await evaluate("document.querySelector('[aria-label=\"停止生成\"]')?.click()"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 100);
    for (const [key, original] of [[preferencesKey, originalPreferences], [chatKey, originalChat]]) await evaluate(key === "modelport.chat.v1" ? restoreChatStorageExpression(original) : original === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(original)})`);
    await command("Emulation.clearDeviceMetricsOverride"); await reload();
  }
  if (fixtureProvider) await evaluate(`window.__TAURI_INTERNALS__.invoke('remove_custom_provider', { provider: ${JSON.stringify(fixtureProvider.id)} })`).catch(() => {});
  close(); fixtureServer.closeAllConnections();
  if (fixtureServer.listening) await new Promise(resolve => fixtureServer.close(resolve));
}
