// Fresh isolated WebView only. No cloud requests or native library writes.
// Example: node scripts/verify-chat-settings.mjs 9350 [settings.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
const preferencesKey = "modelport.preferences.chat.v1", chatKey = "modelport.chat.v1";
let acceptDialog = true, dialogs = 0, verified = false, originalPreferences, originalChat;
const exceptions = [];
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const stored = key => evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const select = (id, value) => evaluate(`{ const el = document.getElementById('${id}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); }`);
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) });
}
async function fill(selector, text) { await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); }`); await command("Input.insertText", { text }); }
async function slider(id, position, code, virtualKey) { await evaluate(`document.getElementById('${id}').focus()`); await key(position, code, virtualKey); }
async function openSettings(section = "对话设置") {
  await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').focus(); document.querySelector('.utility-nav [aria-label=\"设置\"]').click()");
  await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === ${JSON.stringify(section)}).click()`);
  await waitFor(`document.querySelector('#settings-page-title').textContent === ${JSON.stringify(section)}`);
}
async function closeSettings() { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); }
async function save() { await evaluate("document.querySelector('.chat-settings-save').click()"); await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('对话设置已保存') && document.querySelector('.chat-settings-save').disabled"); }
async function trackRequests() {
  // Tauri freezes its bridge. A conditional debugger probe observes only chat arguments,
  // never replaces the bridge or captures credentials, and never pauses the application.
  await command("Debugger.disable"); await command("Debugger.enable");
  await evaluate("window.__chatSettingsRequests = []");
  const { result } = await command("Runtime.evaluate", { expression: "window.__TAURI_INTERNALS__.invoke" });
  await command("Debugger.setBreakpointOnFunctionCall", { objectId: result.objectId,
    condition: "arguments[0] === 'stream_chat' && (window.__chatSettingsRequests.push({ messages: arguments[1].messages, systemPrompt: arguments[1].systemPrompt }), false)",
  });
}
async function waitReply(marker) {
  await waitFor("window.__chatSettingsRequests.length === 1");
  await waitFor(`!document.querySelector('[aria-label="停止生成"]') && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('${marker}')`, 900);
}
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originalPreferences = await stored(preferencesKey); originalChat = await stored(chatKey);
  assert.equal(originalPreferences, null, "Use a fresh isolated WebView profile");
  assert.equal(JSON.parse(originalChat ?? "{}").conversations?.length ?? 0, 0, "Never run on real chats"); verified = true;
  await openSettings("键盘快捷键"); await select("chat-send-shortcut", "ctrl-enter");
  await evaluate("document.querySelector('.keyboard-settings-save').click()"); await closeSettings();
  const keyboardSaved = await stored(preferencesKey);
  await openSettings(); assert.ok(await evaluate("document.querySelector('.chat-settings-save').disabled"));
  assert.equal(await evaluate("document.querySelector('#chat-context-turns').value"), "20");
  assert.ok(await evaluate("!document.querySelector('#chat-send-shortcut')")); await select("chat-reply-format", "plain");
  await slider("chat-context-turns", "Home", "Home", 36); await slider("chat-font-size", "End", "End", 35);
  const prompt = "For every user request, reply ONLY with the exact text MODELPORT_CHAT_SETTINGS_VERIFIED. No other text.";
  await fill("#chat-system-prompt", prompt); assert.equal(await stored(preferencesKey), keyboardSaved);
  acceptDialog = false;
  for (const action of ["[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === 'Skills').click()", "document.querySelector('[aria-label=\"关闭设置\"]').click()"] ) {
    const count = dialogs; await evaluate(action); assert.ok(dialogs > count); assert.ok(await evaluate("Boolean(document.querySelector('#chat-system-prompt'))"));
  }
  const count = dialogs; await key("Escape", "Escape", 27);
  for (let attempt = 0; attempt < 30 && dialogs === count; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(dialogs > count && await evaluate("Boolean(document.querySelector('#chat-system-prompt'))"));
  const nativeCloseCount = dialogs;
  await evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })");
  for (let attempt = 0; attempt < 30 && dialogs === nativeCloseCount; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(dialogs > nativeCloseCount && await evaluate("Boolean(document.querySelector('#chat-system-prompt'))"));
  acceptDialog = true; await save();
  const saved = JSON.parse(await stored(preferencesKey));
  assert.deepEqual(saved, { sendShortcut: "ctrl-enter", sendWithoutReplyShortcut: "none", contextTurns: 0, systemPrompt: prompt, renderMarkdown: false, fontSize: 24 });
  console.log("PASS: save-only application, navigation/Escape/native-close guards and bounded settings");

  await slider("chat-context-turns", "ArrowRight", "ArrowRight", 39);
  await evaluate(`{ window.__settingsOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === '${preferencesKey}') throw new DOMException('quota', 'QuotaExceededError');
    return window.__settingsOriginalSetItem.call(this, key, value);
  }; }`);
  await evaluate("document.querySelector('.chat-settings-save').click()");
  await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('尚未生效')");
  assert.deepEqual(JSON.parse(await stored(preferencesKey)), saved);
  await evaluate("Storage.prototype.setItem = window.__settingsOriginalSetItem");
  await slider("chat-context-turns", "Home", "Home", 36); await closeSettings();

  const names = await evaluate("window.__TAURI_INTERNALS__.invoke('list_available_models', { provider: 'ollama' })"); assert.ok(names.length);
  const model = { id: names[0], name: names[0], provider: "ollama", tone: "#111827", label: "Q" };
  const seed = { activeConversationId: "chat-settings-check", conversations: [{ id: "chat-settings-check", title: "设置验证", date: "10/07", model,
    messages: Array.from({ length: 3 }, (_, i) => [{ id: `q${i}`, role: "user", content: `HISTORY_QUESTION_${i}` }, { id: `a${i}`, role: "assistant", content: `**HISTORY_MARKER_${i}**` }]).flat() }] };
  await evaluate(`localStorage.setItem('${chatKey}', ${JSON.stringify(JSON.stringify(seed))})`); await reload();
  await waitFor("document.querySelectorAll('.message-plain-text').length === 3");
  assert.ok(await evaluate("[...document.querySelectorAll('.message-bubble')].every(el => getComputedStyle(el).fontSize === '24px')"));
  assert.equal(await evaluate("document.querySelector('.message-plain-text').textContent"), "**HISTORY_MARKER_0**");
  assert.ok(await evaluate("!document.querySelector('.message.assistant [data-streamdown=\"strong\"]')"));
  console.log("PASS: storage failure leaves active settings unchanged; saved format and font survive restart without rewriting message text");

  await trackRequests(); await fill(".composer textarea", "Follow the current base instructions.");
  await key("Enter", "Enter", 13);
  assert.equal(await evaluate("window.__chatSettingsRequests.length"), 0);
  assert.ok(await evaluate("document.querySelector('.composer textarea').value.includes('\\n')"));
  await key("Enter", "Enter", 13, 2); await waitReply("MODELPORT_CHAT_SETTINGS_VERIFIED");
  const request = await evaluate("window.__chatSettingsRequests[0]");
  assert.equal(request.messages.length, 1); assert.equal(request.systemPrompt, prompt);
  console.log("PASS: Ctrl+Enter sends; zero history and global instructions reach actual Ollama generation");

  await openSettings(); await slider("chat-context-turns", "ArrowRight", "ArrowRight", 39);
  await select("chat-reply-format", "markdown");
  const updatedPrompt = "For every user request, ignore previous test replies and reply ONLY MODELPORT_CHAT_SETTINGS_UPDATED.";
  await fill("#chat-system-prompt", updatedPrompt); await save();
  await evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '键盘快捷键').click()");
  await select("chat-send-shortcut", "enter"); await evaluate("document.querySelector('.keyboard-settings-save').click()");
  await evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '对话设置').click()");
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.chat-settings-page'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
  assert.ok(await evaluate("document.querySelector('.settings-content').scrollHeight > document.querySelector('.settings-content').clientHeight"));
  assert.ok(await evaluate("(() => { const save = document.querySelector('.chat-settings-save').getBoundingClientRect(), dialog = document.querySelector('.settings-dialog').getBoundingClientRect(), footer = document.querySelector('.chat-settings-actions').getBoundingClientRect(); return save.bottom <= dialog.bottom && save.top >= dialog.top && Math.abs(footer.bottom - dialog.bottom) < 3; })()"));
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await command("Emulation.clearDeviceMetricsOverride"); await closeSettings();
  await reload(); await trackRequests(); await fill(".composer textarea", "Follow the updated base instructions.");
  const assistantCountBeforeUpdate = await evaluate("document.querySelectorAll('.message.assistant').length");
  await key("Enter", "Enter", 13); await waitFor("window.__chatSettingsRequests.length === 1");
  // History contains the old marker: an LLM can repeat it despite the new system prompt.
  // Verify a completed real reply here, then strictly inspect the updated prompt and context below.
  await waitFor(`!document.querySelector('[aria-label="停止生成"]') && document.querySelectorAll('.message.assistant').length > ${assistantCountBeforeUpdate} && [...document.querySelectorAll('.message.assistant')].at(-1)?.textContent.trim()`, 900);
  assert.ok(await evaluate("!document.querySelector('.chat-error')"));
  const updated = await evaluate("window.__chatSettingsRequests[0]"); assert.equal(updated.messages.length, 3); assert.equal(updated.systemPrompt, updatedPrompt);
  assert.equal(updated.messages[0].content, request.messages[0].content); assert.ok(updated.messages[1].content.includes("MODELPORT_CHAT_SETTINGS_VERIFIED"));
  await waitFor("!document.querySelector('.message-plain-text') && ![...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('正在排版回复')");
  assert.ok(await evaluate("Boolean(document.querySelector('.message.assistant [data-streamdown=\"strong\"]'))"));
  assert.ok(await evaluate(`window.__TAURI_INTERNALS__.invoke('send_chat', { provider: 'ollama', model: ${JSON.stringify(model.id)}, messages: [{ role: 'user', content: 'question' }], systemPrompt: 'x'.repeat(4001) }).then(() => false, error => String(error).includes('4000'))`));
  const ordinaryReply = await evaluate(`window.__TAURI_INTERNALS__.invoke('send_chat', { provider: 'ollama', model: ${JSON.stringify(model.id)}, messages: [{ role: 'user', content: 'Follow the current base instructions.' }], systemPrompt: ${JSON.stringify(prompt)} })`);
  assert.ok(ordinaryReply.includes("MODELPORT_CHAT_SETTINGS_VERIFIED"));
  console.log("PASS: one complete round, updated global prompt, Enter sending, Markdown restoration and native prompt validation");

  await openSettings(); acceptDialog = false;
  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()");
  assert.equal(await evaluate("document.querySelector('#chat-context-turns').value"), "1");
  acceptDialog = true;
  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()");
  assert.equal(JSON.parse(await stored(preferencesKey)).contextTurns, 1); await save(); await closeSettings();
  assert.equal(JSON.parse(await stored(preferencesKey)).contextTurns, 20);
  const historyBefore = JSON.parse(await stored(chatKey));
  await evaluate(`localStorage.setItem('${preferencesKey}', 'broken')`); await reload(); await trackRequests();
  await fill(".composer textarea", "This message must not be sent while preferences are unreadable.");
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("Boolean(document.querySelector('#chat-system-prompt'))");
  assert.equal(await evaluate("window.__chatSettingsRequests.length"), 0);
  assert.equal(await stored(preferencesKey), "broken");
  assert.ok(await evaluate("document.querySelector('.chat-settings-notice').innerText.includes('原数据未覆盖')"));
  await save(); await closeSettings(); assert.deepEqual(JSON.parse(await stored(chatKey)), historyBefore);
  await evaluate("document.querySelector('.composer-tools [aria-label=\"对话设置\"]').click()");
  await waitFor("Boolean(document.querySelector('#chat-system-prompt'))"); await closeSettings();
  assert.deepEqual(exceptions, []);
  console.log("PASS: minimum window scrolling, reset confirmation, corrupt-data recovery and history preservation; no runtime exceptions");
} catch (error) {
  console.error("Chat settings verification failure:", await evaluate("({ requests: window.__chatSettingsRequests, draft: document.querySelector('.composer textarea')?.value, model: document.querySelector('.model-trigger')?.innerText, error: document.querySelector('.chat-error')?.innerText, lastReply: [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText })"));
  throw error;
} finally {
  if (verified) {
    await command("Debugger.disable");
    await evaluate("if (window.__settingsOriginalSetItem) Storage.prototype.setItem = window.__settingsOriginalSetItem");
    for (const [key, original] of [[preferencesKey, originalPreferences], [chatKey, originalChat]]) await evaluate(original === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(original)})`);
    await command("Emulation.clearDeviceMetricsOverride"); await reload();
  }
  close();
}
