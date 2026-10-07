// Fresh isolated desktop WebView only; no cloud calls or native library writes.
// node scripts/verify-general-settings.mjs 9350 [general-dark.png] [chat-dark.png]
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { connectDesktop } from "./desktop-client.mjs";
const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
const generalKey = "modelport.preferences.general.v1", chatKey = "modelport.chat.v1", preferencesKey = "modelport.preferences.chat.v1";
let originalGeneral, originalChat, originalPreferences, verified = false, acceptDialog = true, promptText = "", dialogs = 0;
const exceptions = [];
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog, promptText }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const stored = key => evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const chats = async () => JSON.parse(await stored(chatKey) ?? "{}");
async function fill(selector, text) { await evaluate(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); }`); await command("Input.insertText", { text }); }
async function select(id, value) { await evaluate(`{ const el = document.getElementById('${id}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); }`); }
async function section(label) { await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === ${JSON.stringify(label)}).click()`); await waitFor(`document.querySelector('#settings-page-title').innerText === ${JSON.stringify(label)}`); }
async function settings() { await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()"); await section("常规设置"); }
async function closeSettings() { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); }
async function save() { await evaluate("document.querySelector('.general-settings-save').click()"); await waitFor("document.querySelector('.general-settings-save').disabled && document.querySelector('.chat-settings-notice')?.innerText.includes('常规设置已保存')"); }
async function key(key, code, windowsVirtualKeyCode) { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode }); }
async function button(label) { await evaluate(`[...document.querySelectorAll('.general-data-actions button')].find(button => button.innerText === ${JSON.stringify(label)}).click()`); }
async function upload(file) { const { root } = await command("DOM.getDocument"); const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="选择聊天备份"]' }); await command("DOM.setFileInputFiles", { nodeId, files: [file] }); }
async function quota(key) { await evaluate(`{ window.__generalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === ${JSON.stringify(key)}) throw new Error('quota'); return window.__generalSetItem.call(this, key, value); }; }`); }
async function unquota() { await evaluate("Storage.prototype.setItem = window.__generalSetItem"); }
async function screenshot(path) { if (path) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(path, Buffer.from(data, "base64")); } }
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originalGeneral = await stored(generalKey); originalChat = await stored(chatKey); originalPreferences = await stored(preferencesKey);
  assert.equal(originalGeneral, null); assert.equal((await chats()).conversations?.length ?? 0, 0, "Use a fresh isolated profile, never real chats"); verified = true;
  const libraryBefore = await evaluate("Promise.all([window.__TAURI_INTERNALS__.invoke('list_skills'), window.__TAURI_INTERNALS__.invoke('list_knowledge_bases')])");
  await settings(); assert.ok(await evaluate("document.querySelector('.general-settings-save').disabled"));
  await select("general-theme", "dark"); assert.ok(await evaluate("!document.documentElement.classList.contains('dark')")); assert.equal(await stored(generalKey), null);
  acceptDialog = false;
  for (const action of [() => evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '键盘快捷键').click()"), () => key("Escape", "Escape", 27), () => evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })")]) {
    const before = dialogs; await action(); for (let attempt = 0; attempt < 30 && dialogs === before; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(dialogs > before && await evaluate("Boolean(document.querySelector('#general-theme'))"));
  }
  acceptDialog = true; await quota(generalKey); await evaluate("document.querySelector('.general-settings-save').click()");
  await waitFor("document.querySelector('.chat-settings-notice').innerText.includes('尚未生效')"); assert.equal(await stored(generalKey), null); assert.ok(await evaluate("!document.documentElement.classList.contains('dark')")); await unquota(); await save();
  assert.ok(await evaluate("document.documentElement.classList.contains('dark')"));
  await select("general-theme", "system"); await save();
  for (const value of ["light", "dark", "light"]) { await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }); await waitFor(`document.documentElement.classList.contains('dark') === ${value === "dark"}`); }
  await select("general-theme", "dark"); await evaluate("document.querySelector('#general-animations').click()"); await select("general-startup", "new-chat"); await select("general-sidebar", "collapsed"); await save(); await closeSettings();
  const model = { id: "deepseek-flash", name: "DeepSeek Flash", provider: "deepseek", tone: "#5368ff", label: "D" };
  const seed = { activeConversationId: "general-chat", conversations: [{ id: "general-chat", title: "常规设置验证", date: "10/07", model,
    messages: [{ id: "general-user", role: "user", content: "本机聊天内容" }, { id: "general-assistant", role: "assistant", content: "# 深色聊天\n\n**Markdown 保留**\n\n```js\nconst answer = 42;\n```" }] },
    { id: "general-note", title: "仅保存的记录", date: "10/07", model, newTopicPending: true, messages: [{ id: "general-note-msg", role: "user", content: "备份笔记", savedOnly: true, topicStart: true }] }] };
  await evaluate(`localStorage.setItem('${chatKey}', ${JSON.stringify(JSON.stringify(seed))})`); await reload();
  await waitFor("document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && document.documentElement.classList.contains('dark')");
  assert.equal((await chats()).activeConversationId, null); assert.equal((await chats()).conversations.length, 2);
  assert.ok(await evaluate("document.querySelector('.model-trigger').innerText.includes('Ollama') || !document.querySelector('.model-trigger').innerText.includes('DeepSeek')"));
  assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.app-shell')).transitionDuration) < 0.001"));
  await evaluate("document.querySelector('[aria-label=\"展开侧边栏\"]').click()"); await evaluate("[...document.querySelectorAll('.conversation-section:last-child button')].find(button => button.innerText.includes('常规设置验证')).click()");
  await settings(); await select("general-startup", "last-conversation"); await select("general-sidebar", "expanded"); await save(); await closeSettings(); await reload();
  assert.equal((await chats()).activeConversationId, "general-chat"); assert.ok(await evaluate("!document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && document.querySelector('.model-trigger').innerText.includes('DeepSeek')"));
  await waitFor("Boolean(document.querySelector('.message.assistant [data-streamdown=\"strong\"]'))"); await screenshot(process.argv[4]);
  console.log("PASS: explicit save, failed-save/exit protection, system theme changes, reduced animation and restart-only conversation/sidebar choices");

  await settings();
  const labels = await evaluate("[...document.querySelectorAll('.settings-nav button')].map(button => button.innerText)");
  for (const label of labels) { await section(label); assert.equal(await evaluate("getComputedStyle(document.querySelector('.settings-dialog')).backgroundColor"), "rgb(32, 43, 57)"); }
  await section("常规设置");
  for (const [width, height] of [[1480, 960], [920, 680]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.general-settings-page'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
    assert.ok(await evaluate("(() => { const footer = document.querySelector('.chat-settings-actions').getBoundingClientRect(), dialog = document.querySelector('.settings-dialog').getBoundingClientRect(); return Math.abs(footer.bottom - dialog.bottom) < 3; })()"));
    if (width === 920) await screenshot(process.argv[3]);
  }
  await command("Emulation.clearDeviceMetricsOverride");
  const downloadRoot = resolve("release"); mkdirSync(downloadRoot, { recursive: true });
  const downloadDirectory = mkdtempSync(join(downloadRoot, "general-settings-check-"));
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await button("导出聊天备份"); let filename;
  for (let attempt = 0; attempt < 100; attempt++) { filename = readdirSync(downloadDirectory).find(name => /^ModelPort-chats-.*\.json$/.test(name)); if (filename) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(filename, "Actual backup download must finish in the isolated test directory");
  const backupFile = join(downloadDirectory, filename), exported = readFileSync(backupFile, "utf8"), backup = JSON.parse(exported);
  assert.equal(backup.format, "modelport-chat-backup"); assert.equal(backup.conversations.length, 2); assert.ok(!("apiKey" in backup) && !("settings" in backup));
  console.log(`PASS: all settings render dark without layout overflow, Markdown keeps its content, actual JSON download verified at ${backupFile}`);

  const beforeImport = await stored(chatKey); await upload(resolve("scripts/fixtures/SKILL.md")); await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('不是有效')"); assert.equal(await stored(chatKey), beforeImport);
  await closeSettings(); await fill(".composer textarea", "导入必须保留的草稿"); await settings(); await upload(backupFile); await waitFor("Boolean(document.querySelector('.general-import-preview'))");
  acceptDialog = false; const before = dialogs; await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); assert.ok(dialogs > before && await evaluate("Boolean(document.querySelector('.general-import-preview'))"));
  await button("确认合并导入"); assert.equal(await stored(chatKey), beforeImport);
  acceptDialog = true; await quota(chatKey); await button("确认合并导入"); await waitFor("document.querySelector('.chat-settings-notice').innerText.includes('尚未改变')"); assert.equal(await stored(chatKey), beforeImport); await unquota();
  await button("确认合并导入"); await waitFor("!document.querySelector('.general-import-preview') && JSON.parse(localStorage.getItem('modelport.chat.v1')).conversations.length === 4");
  const imported = await chats(); assert.equal(imported.activeConversationId, "general-chat"); assert.equal(new Set(imported.conversations.map(chat => chat.id)).size, 4);
  assert.ok(imported.conversations.some(chat => chat.newTopicPending && chat.messages[0].savedOnly && chat.messages[0].topicStart));
  assert.equal(await evaluate("document.querySelector('.composer textarea').value"), "导入必须保留的草稿");
  const beforeClear = await stored(chatKey), generalBeforeClear = await stored(generalKey);
  acceptDialog = false; await button("清空聊天记录"); assert.equal(await stored(chatKey), beforeClear);
  acceptDialog = true; promptText = "wrong"; await button("清空聊天记录"); assert.equal(await stored(chatKey), beforeClear);
  promptText = "清空对话"; await quota(chatKey); await button("清空聊天记录"); assert.equal(await stored(chatKey), beforeClear); await unquota();
  await button("清空聊天记录"); await waitFor("JSON.parse(localStorage.getItem('modelport.chat.v1')).conversations.length === 0");
  assert.equal(await stored(generalKey), generalBeforeClear); assert.equal(await stored(preferencesKey), originalPreferences); assert.equal(await evaluate("document.querySelector('.composer textarea').value"), "");
  await upload(backupFile); await waitFor("Boolean(document.querySelector('.general-import-preview'))"); await button("确认合并导入"); assert.equal((await chats()).conversations.length, 2);
  assert.deepEqual(await evaluate("Promise.all([window.__TAURI_INTERNALS__.invoke('list_skills'), window.__TAURI_INTERNALS__.invoke('list_knowledge_bases')])"), libraryBefore);
  console.log("PASS: invalid import/cancellation/save failure preserve chats, confirmed import merges copies without losing draft, typed clear is isolated and backup restores chats");

  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()"); assert.equal(await stored(generalKey), generalBeforeClear); await save(); await closeSettings();
  assert.ok(await evaluate("!document.documentElement.classList.contains('dark')"));
  await evaluate("document.querySelector('.primary-actions button').click()");
  await fill(".composer textarea", "Write a detailed numbered list of 1000 small software design tips. Continue until all 1000 are written.");
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await waitFor("Boolean(document.querySelector('[aria-label=\"停止生成\"]'))");
  await settings(); assert.ok(await evaluate("[...document.querySelectorAll('.general-data-actions button')].every(button => button.disabled) && document.querySelector('.general-settings-page').innerText.includes('结束生成')"));
  await closeSettings(); await evaluate("document.querySelector('[aria-label=\"停止生成\"]')?.click()"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 300);
  console.log("PASS: actual Ollama generation blocks import/export/clear until stopped");
  await evaluate(`localStorage.setItem('${generalKey}', 'broken')`); await reload(); assert.equal(await stored(generalKey), "broken"); await settings();
  assert.ok(await evaluate("document.querySelector('.chat-settings-notice').innerText.includes('原数据未覆盖')")); await save(); await closeSettings();
  assert.deepEqual(exceptions, []); console.log("PASS: restore-default confirmation, corrupt-setting recovery and no runtime exceptions");
} catch (error) { console.error("General verification failure:", await evaluate("({ page: document.querySelector('#settings-page-title')?.innerText, notice: document.querySelector('.chat-settings-notice')?.innerText, draft: document.querySelector('.composer textarea')?.value, theme: document.documentElement.className })")); throw error; }
finally {
  if (verified) {
    await evaluate("if (window.__generalSetItem) Storage.prototype.setItem = window.__generalSetItem");
    await evaluate("document.querySelector('[aria-label=\"停止生成\"]')?.click()"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 300);
    for (const [key, original] of [[generalKey, originalGeneral], [chatKey, originalChat], [preferencesKey, originalPreferences]]) await evaluate(original === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(original)})`);
    await command("Emulation.clearDeviceMetricsOverride"); await command("Emulation.setEmulatedMedia", { features: [] }); await reload();
  }
  close();
}
