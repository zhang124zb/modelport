// Fresh isolated desktop WebView only. Saves preferences and calls real Ollama, never cloud models or credentials writes.
// node scripts/verify-model-defaults.mjs 9350 [defaults.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";
const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
const modelKey = "modelport.preferences.models.v1", chatKey = "modelport.chat.v1", generalKey = "modelport.preferences.general.v1", chatPreferencesKey = "modelport.preferences.chat.v1";
let originals, verified = false, acceptDialog = true, promptText = "", dialogs = 0;
const exceptions = [];
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog, promptText }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const stored = key => evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
const defaultValue = async () => JSON.parse(await stored(modelKey));
const chat = async () => JSON.parse(await stored(chatKey) ?? "{}");
const modelLabel = () => evaluate("document.querySelector('.model-trigger').innerText");
async function select(id, value) { await evaluate(`{ const el = document.getElementById('${id}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); }`); }
async function fill(text) { await evaluate("{ const el = document.querySelector('.composer textarea'); el.focus(); el.select(); }"); await command("Input.insertText", { text }); }
async function section(label) { await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === ${JSON.stringify(label)}).click()`); await waitFor(`document.querySelector('#settings-page-title').innerText === ${JSON.stringify(label)}`); }
async function settings() { await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()"); await section("默认模型"); }
async function closeSettings() { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); }
async function save() { await evaluate("document.querySelector('.defaults-settings-save').click()"); await waitFor("document.querySelector('.defaults-settings-save').disabled && document.querySelector('.chat-settings-notice')?.innerText.includes('默认模型已保存')"); }
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers }); }
async function newChat() { await key("n", "KeyN", 78, 2); await waitFor("JSON.parse(localStorage.getItem('modelport.chat.v1')).activeConversationId === null"); }
async function trackRequests() {
  await command("Debugger.disable"); await command("Debugger.enable"); await evaluate("window.__defaultRequests = []");
  const { result } = await command("Runtime.evaluate", { expression: "window.__TAURI_INTERNALS__.invoke" });
  await command("Debugger.setBreakpointOnFunctionCall", { objectId: result.objectId,
    condition: "arguments[0] === 'stream_chat' && (window.__defaultRequests.push({ provider: arguments[1].provider, model: arguments[1].model }), false)",
  });
}
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originals = await Promise.all([modelKey, chatKey, generalKey, chatPreferencesKey].map(stored));
  assert.equal(originals[0], null); assert.equal(originals[2], null); assert.equal((await chat()).conversations?.length ?? 0, 0, "Use a fresh isolated profile, never real chats"); verified = true;
  const models = await evaluate("window.__TAURI_INTERNALS__.invoke('list_available_models', { provider: 'ollama' })"); assert.ok(models.length);
  const chosenLocal = models.at(-1);
  await waitFor(`document.querySelector('.model-trigger').innerText.includes(${JSON.stringify(models[0])})`); await trackRequests();
  await settings(); assert.equal(await evaluate("document.querySelector('#default-chat-model').value"), "auto"); assert.ok(await evaluate("document.querySelector('.defaults-settings-save').disabled"));
  await select("default-chat-model", "openai:gpt-4.1"); assert.equal(await stored(modelKey), null); assert.ok((await modelLabel()).includes(models[0]));
  acceptDialog = false;
  for (const action of [() => evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '常规设置').click()"), () => key("Escape", "Escape", 27), () => evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })")]) {
    const before = dialogs; await action(); for (let attempt = 0; attempt < 30 && dialogs === before; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(dialogs > before && await evaluate("Boolean(document.querySelector('#default-chat-model'))"));
  }
  acceptDialog = true;
  await evaluate(`{ window.__defaultsSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === '${modelKey}') throw new Error('quota'); return window.__defaultsSetItem.call(this, key, value); }; }`);
  await evaluate("document.querySelector('.defaults-settings-save').click()"); await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('尚未生效')"); assert.equal(await stored(modelKey), null); assert.ok((await modelLabel()).includes(models[0]));
  await evaluate("Storage.prototype.setItem = window.__defaultsSetItem"); await save(); assert.deepEqual(await defaultValue(), { chatModel: { provider: "openai", id: "gpt-4.1" } }); assert.ok((await modelLabel()).includes("GPT-4.1"));
  await section("模型提供方"); await evaluate("document.querySelector('.settings-content .provider-models-heading button').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('连接成功')"); assert.ok((await modelLabel()).includes("GPT-4.1")); await closeSettings();
  await newChat(); assert.ok((await modelLabel()).includes("GPT-4.1"));
  await evaluate("document.querySelector('.model-trigger').click()"); await evaluate("[...document.querySelectorAll('.model-menu button')].find(button => button.innerText.includes('DeepSeek Flash')).click()"); await newChat(); assert.ok((await modelLabel()).includes("GPT-4.1"));
  await reload(); await waitFor("document.querySelector('.model-trigger').innerText.includes('GPT-4.1')"); assert.equal(await evaluate("window.__defaultRequests?.length ?? 0"), 0);
  if (!await evaluate("window.__TAURI_INTERNALS__.invoke('has_provider_key', { provider: 'openai' })")) {
    await settings(); assert.ok(await evaluate("document.querySelector('.defaults-settings-page').innerText.includes('尚未配置 API Key')")); await closeSettings();
  }
  console.log("PASS: selectable cloud defaults, explicit save/failed-save/exit guards, new chats and restart retain the choice, connection tests do not switch it");

  const history = { activeConversationId: "default-history", conversations: [{ id: "default-history", title: "历史模型保持不变", date: "10/08", model: { provider: "deepseek", id: "deepseek-flash", name: "DeepSeek Flash", tone: "#5368ff", label: "D" }, messages: [{ id: "history-user", role: "user", content: "历史用户记录", savedOnly: true }] }] };
  await evaluate(`localStorage.setItem('${chatKey}', ${JSON.stringify(JSON.stringify(history))})`); await reload(); assert.ok((await modelLabel()).includes("DeepSeek Flash"));
  const historyBefore = await stored(chatKey); await settings(); await select("default-chat-model", `ollama:${chosenLocal}`); await save(); assert.equal(await stored(chatKey), historyBefore); assert.ok((await modelLabel()).includes("DeepSeek Flash")); await closeSettings();
  await newChat(); assert.ok((await modelLabel()).includes(chosenLocal)); await reload(); assert.ok((await modelLabel()).includes(chosenLocal));
  await settings(); await section("常规设置"); await select("general-startup", "new-chat"); await evaluate("document.querySelector('.general-settings-save').click()"); await closeSettings();
  await evaluate("document.querySelector('.conversation-section:last-child button').click()"); assert.ok((await modelLabel()).includes("DeepSeek Flash")); await reload(); assert.equal((await chat()).activeConversationId, null); assert.ok((await modelLabel()).includes(chosenLocal));
  await settings(); await select("default-chat-model", "deepseek:deepseek-flash"); await save(); await closeSettings(); await reload(); assert.ok((await modelLabel()).includes("DeepSeek Flash"));
  assert.deepEqual((await chat()).conversations[0].model, history.conversations[0].model);
  await evaluate("document.querySelector('.model-trigger').click()"); await evaluate(`[...document.querySelectorAll('.model-menu button')].find(button => button.innerText.includes(${JSON.stringify(chosenLocal)})).click()`);
  assert.ok((await modelLabel()).includes(chosenLocal));
  const beforeClear = await stored(modelKey); await settings(); await section("常规设置"); promptText = "清空对话"; await evaluate("document.querySelector('.general-data-actions .general-danger').click()"); promptText = ""; await closeSettings();
  assert.equal((await chat()).conversations.length, 0); assert.equal(await stored(modelKey), beforeClear); assert.ok((await modelLabel()).includes("DeepSeek Flash"));
  console.log("PASS: explicit Ollama variants and DeepSeek defaults, history keeps its own model, startup-new-chat uses the saved preference without rewriting history");

  const missing = "modelport-not-installed-default";
  await evaluate(`localStorage.setItem('${modelKey}', ${JSON.stringify(JSON.stringify({ chatModel: { provider: "ollama", id: missing } }))})`); await reload();
  assert.ok((await modelLabel()).includes(missing)); await settings(); assert.equal(await evaluate("document.querySelector('#default-chat-model').value"), `ollama:${missing}`);
  assert.ok(await evaluate("document.querySelector('.defaults-settings-page').innerText.includes('不会自动改用另一家服务')")); await closeSettings(); await newChat(); await trackRequests();
  await fill("This missing model must not be replaced by a different model."); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("window.__defaultRequests.length === 1"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]') && Boolean(document.querySelector('.chat-error'))", 300);
  assert.deepEqual(await evaluate("window.__defaultRequests[0]"), { provider: "ollama", model: missing }); assert.ok((await modelLabel()).includes(missing));
  await newChat(); await evaluate(`localStorage.setItem('${modelKey}', 'broken')`); await reload(); await trackRequests(); const beforeCorrupt = await stored(chatKey);
  await fill("Unclear preferences must not trigger a request."); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await waitFor("Boolean(document.querySelector('#default-chat-model'))");
  assert.equal(await evaluate("window.__defaultRequests.length"), 0); assert.equal(await stored(modelKey), "broken"); assert.equal(await stored(chatKey), beforeCorrupt);
  await select("default-chat-model", `ollama:${chosenLocal}`); await save(); await closeSettings(); await fill(""); await newChat();
  await evaluate(`localStorage.setItem('${chatPreferencesKey}', ${JSON.stringify(JSON.stringify({ contextTurns: 0, systemPrompt: "Reply ONLY MODELPORT_DEFAULT_MODEL_VERIFIED.", renderMarkdown: false }))})`); await reload(); await trackRequests();
  await fill("Follow the instruction."); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await waitFor("window.__defaultRequests.length === 1");
  await waitFor("!document.querySelector('[aria-label=\"停止生成\"]') && [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('MODELPORT_DEFAULT_MODEL_VERIFIED')", 900);
  assert.deepEqual(await evaluate("window.__defaultRequests[0]"), { provider: "ollama", model: chosenLocal });
  console.log("PASS: unavailable model never falls back, corrupt preferences preserve data and pause new requests, chosen default reaches actual Ollama");

  await settings(); await select("default-chat-model", "openai:gpt-4.1"); await save(); assert.ok((await modelLabel()).includes(chosenLocal));
  const savedBeforeReset = await stored(modelKey); await section("常规设置"); await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复默认').click()"); await evaluate("document.querySelector('.general-settings-save').click()"); assert.equal(await stored(modelKey), savedBeforeReset);
  await select("general-theme", "dark"); await evaluate("document.querySelector('.general-settings-save').click()"); await section("默认模型");
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.defaults-settings-page'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
  assert.ok(await evaluate("(() => { const footer = document.querySelector('.chat-settings-actions').getBoundingClientRect(), dialog = document.querySelector('.settings-dialog').getBoundingClientRect(); return Math.abs(footer.bottom - dialog.bottom) < 3; })()"));
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  acceptDialog = false; await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复自动选择').click()"); assert.equal(await evaluate("document.querySelector('#default-chat-model').value"), "openai:gpt-4.1"); acceptDialog = true;
  await evaluate("[...document.querySelectorAll('.chat-settings-actions button')].find(button => button.innerText === '恢复自动选择').click()"); assert.equal(await stored(modelKey), savedBeforeReset); await save(); assert.deepEqual(await defaultValue(), { chatModel: null });
  assert.deepEqual(exceptions, []); console.log("PASS: reset confirmation, general settings cannot overwrite model preference, dark/minimum-window layout and no runtime exceptions");
} catch (error) { console.error("Default model verification failure:", await evaluate("({ page: document.querySelector('#settings-page-title')?.innerText, notice: document.querySelector('.chat-settings-notice')?.innerText, error: document.querySelector('.chat-error')?.innerText, requests: window.__defaultRequests, model: document.querySelector('.model-trigger')?.innerText })")); throw error; }
finally {
  if (verified) {
    await command("Debugger.disable"); await evaluate("if (window.__defaultsSetItem) Storage.prototype.setItem = window.__defaultsSetItem");
    await evaluate("document.querySelector('[aria-label=\"停止生成\"]')?.click()"); await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 300);
    for (const [index, key] of [modelKey, chatKey, generalKey, chatPreferencesKey].entries()) await evaluate(originals[index] === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(originals[index])})`);
    await command("Emulation.clearDeviceMetricsOverride"); await reload();
  }
  close();
}
