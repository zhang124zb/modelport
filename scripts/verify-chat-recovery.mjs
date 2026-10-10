import { desktopChatStateExpression, chatStorageRawExpression, legacyChatSeedExpression, restoreChatStorageExpression } from "./chat-storage-fixture.mjs";
// Run only against a fresh isolated WebView profile. Synthetic chats, no model calls.
// node scripts/verify-chat-recovery.mjs <debug-port>
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9362));
const chatKey = "modelport.chat.v1";
let verified = false, original, accept = false, promptText = "", dialogs = 0;
const exceptions = [];
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept, promptText }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const raw = () => evaluate(`${chatStorageRawExpression}`);
const seed = value => evaluate(legacyChatSeedExpression(value));
const button = label => evaluate(`[...document.querySelectorAll('button')].find(button => button.innerText === ${JSON.stringify(label)}).click()`);
async function upload(path) {
  const { root } = await command("DOM.getDocument");
  const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="选择聊天备份"]' });
  await command("DOM.setFileInputFiles", { nodeId, files: [path] });
}
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  original = await raw();
  assert.equal(await evaluate("localStorage.getItem('modelport.preferences.general.v1')"), null);
  assert.equal((await evaluate(desktopChatStateExpression)).conversations?.length ?? 0, 0, "Never run against real chats");
  verified = true;
  const broken = '{"conversations":';
  await seed(broken); await reload();
  await waitFor("document.querySelector('.chat-error')?.innerText.includes('暂停保存')");
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(await raw(), broken);
  await reload(); assert.equal(await raw(), broken);
  // Sending a note must open recovery, not start a request or append a chat.
  await evaluate("document.querySelector('.composer textarea').focus()");
  await command("Input.insertText", { text: "不得写入损坏存储" });
  await evaluate("document.querySelector('.composer').requestSubmit()");
  await waitFor("Boolean(document.querySelector('#general-theme'))");
  assert.equal(await raw(), broken);
  assert.ok(await evaluate("[...document.querySelectorAll('button')].filter(button => ['导出聊天备份', '清理闲置附件'].includes(button.innerText)).every(button => button.disabled)"));
  await button("重置聊天记录"); assert.ok(dialogs > 0); assert.equal(await raw(), broken);
  const directory = mkdtempSync(join(resolve("release"), "chat-recovery-check-"));
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  await button("导出原始记录");
  let downloaded;
  for (let attempt = 0; attempt < 50; attempt++) {
    downloaded = readdirSync(directory).find(name => /^ModelPort-chats-recovery-.*\.json$/.test(name));
    if (downloaded) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(downloaded, "Actual raw download must finish");
  assert.equal(readFileSync(join(directory, downloaded), "utf8"), broken);
  await upload(join(directory, downloaded));
  await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('不是有效')");
  assert.equal(await raw(), broken);
  const model = { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O" };
  const prefix = "// " + "p".repeat(110) + "\n", suffix = "\n// " + "s".repeat(110);
  const first = prefix + 'const auditValue = "A";' + suffix, second = prefix + 'const auditValue = "B";' + suffix;
  const conversation = { id: "fixture", title: "恢复与高亮验证", date: "10/10", model,
    messages: [{ id: "a", role: "assistant", content: '```js\n' + first + '\n```\n\n```js\n' + second + '\n```\n\n| 中文列 | 数值 |\n| --- | --- |\n| 保留 Markdown | 1 |\n\n$$\nx^2 + 1\n$$\n\n```mermaid\ngraph TD\n  A[MARKDOWN_GRAPH_OK] --> B[完成]\n```' }] };
  const backupFile = join(directory, "fixture-backup.json");
  writeFileSync(backupFile, JSON.stringify({ format: "modelport-chat-backup", version: 1, conversations: [conversation] }));
  await upload(backupFile); await waitFor("[...document.querySelectorAll('button')].some(button => button.innerText === '确认从备份恢复')");
  await button("确认从备份恢复"); assert.equal(await raw(), broken, "Cancelled recovery must preserve original");
  accept = true;
  await evaluate(`{ window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === '${chatKey}' || key.startsWith('modelport.chat.v2')) throw new Error('quota'); return window.__originalSetItem.call(this, key, value); }; }`);
  await button("确认从备份恢复");
  await waitFor("document.querySelector('.chat-settings-notice')?.innerText.includes('尚未改变')");
  assert.equal(await raw(), broken);
  assert.ok(await evaluate("document.querySelector('.chat-error').innerText.includes('暂停保存')"));
  await evaluate("Storage.prototype.setItem = window.__originalSetItem");
  await button("确认从备份恢复");
  await waitFor("!document.querySelector('.general-import-preview') && !document.querySelector('.chat-error')");
  assert.equal((await evaluate(desktopChatStateExpression)).conversations.length, 1);
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await evaluate("[...document.querySelectorAll('.conversation-section button')].find(button => button.innerText.includes('恢复与高亮验证')).click()");
  await waitFor("document.querySelectorAll('[data-streamdown=\"code-block\"] pre').length === 2");
  await waitFor("[...document.querySelectorAll('[data-streamdown=\"code-block\"] pre')].every(pre => pre.querySelector('span[style]'))");
  const rendered = await evaluate("[...document.querySelectorAll('[data-streamdown=\"code-block\"] pre')].map(pre => pre.textContent)");
  assert.ok(rendered[0].includes('"A"') && !rendered[0].includes('"B"'));
  assert.ok(rendered[1].includes('"B"') && !rendered[1].includes('"A"'));
  // Mermaid intentionally renders on intersection; test it in the visible viewport.
  await waitFor("Boolean(document.querySelector('[data-streamdown=\"mermaid-block\"]'))");
  await evaluate("document.querySelector('[data-streamdown=\"mermaid-block\"]').scrollIntoView({ block: 'center' })");
  await waitFor("Boolean(document.querySelector('.message-bubble .katex')) && [...document.querySelectorAll('.message-bubble svg')].some(svg => svg.textContent.includes('MARKDOWN_GRAPH_OK'))");
  assert.ok(await evaluate("document.querySelector('.message-bubble table')?.textContent.includes('中文列')"));
  await reload(); assert.equal((await evaluate(desktopChatStateExpression)).conversations.length, 1);
  await evaluate("localStorage.setItem('modelport.preferences.general.v1', JSON.stringify({ theme: 'dark' }))");
  await reload();
  await waitFor("document.documentElement.classList.contains('dark') && document.querySelectorAll('[data-streamdown=\"code-block\"] pre span[style]').length > 0");
  assert.ok(await evaluate("document.querySelectorAll('[data-streamdown=\"code-block\"] pre')[1].textContent.includes('\"B\"')"));
  // Explicit reset is the only way to discard an unreadable original without a backup.
  await seed(broken); await reload(); await button("恢复聊天记录");
  await waitFor("Boolean(document.querySelector('#general-theme'))");
  promptText = "incorrect"; await button("重置聊天记录"); assert.equal(await raw(), broken);
  promptText = "重置对话"; await button("重置聊天记录");
  await waitFor(`${desktopChatStateExpression}.conversations.length === 0 && !document.querySelector('.chat-error')`);
  await upload(backupFile);
  await waitFor("[...document.querySelectorAll('button')].some(button => button.innerText === '确认合并导入')");
  await button("确认合并导入");
  await waitFor(`${desktopChatStateExpression}.conversations.length === 1`);
  await button("导出聊天备份");
  let normalBackup;
  for (let attempt = 0; attempt < 50; attempt++) {
    normalBackup = readdirSync(directory).find(name => /^ModelPort-chats-/.test(name) && !name.includes('recovery-') && name.endsWith('.json'));
    if (normalBackup) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(normalBackup, "Normal export must resume after recovery");
  assert.equal(JSON.parse(readFileSync(join(directory, normalBackup), "utf8")).conversations.length, 1);
  assert.deepEqual(exceptions, []);
  console.log("PASS: startup/reload protection, blocked sending/cleanup, exact downloaded raw data, invalid/cancelled/failed recovery, confirmed restore/reset, resumed normal backups, distinct colored code blocks and Chinese Markdown/math/diagrams");
} catch (error) {
  if (verified) console.error("Recovery verification context:", await evaluate("({ katex: document.querySelectorAll('.message-bubble .katex').length, diagrams: document.querySelectorAll('[data-streamdown=\"mermaid-block\"]').length, svgText: [...document.querySelectorAll('.message-bubble svg')].map(svg => svg.textContent.slice(-300)), text: document.querySelector('.message-bubble')?.innerText.slice(-1200) })").catch(() => null));
  throw error;
} finally {
  if (verified) {
    await evaluate("if (window.__originalSetItem) Storage.prototype.setItem = window.__originalSetItem").catch(() => {});
    await evaluate(restoreChatStorageExpression(original)).catch(() => {});
    await evaluate("localStorage.removeItem('modelport.preferences.general.v1')").catch(() => {});
    await reload().catch(() => {});
  }
  close();
}
