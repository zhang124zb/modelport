// Use only a fresh isolated WebView profile. Only the uniquely named test knowledge base is changed.
// Example: node scripts/verify-knowledge.mjs 9350 [knowledge.png] [reply.png]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
let acceptDialog = true, dialogs = 0;
const errors = [];
on("Page.javascriptDialogOpening", () => { dialogs++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
const ref = base => ({ id: base.id, revision: base.revision });
const click = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(button => button.innerText.trim() === ${JSON.stringify(text)}).click()`);
async function fill(selector, text) { await evaluate(`{ const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); }`); await command("Input.insertText", { text }); }
async function openKnowledge() {
  await evaluate("document.querySelector('.manage-knowledge').focus(); document.querySelector('.manage-knowledge').click()");
  await waitFor("document.querySelector('#settings-page-title')?.textContent === '知识库'");
  await waitFor("document.querySelector('.knowledge-page > .knowledge-actions button')?.disabled === false");
}
async function closeSettings() { await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); await waitFor("!document.querySelector('.settings-dialog')"); }
async function openBase(name, revision) {
  await waitFor(`[...document.querySelectorAll('.knowledge-list button')].some(button => button.querySelector('strong').innerText === ${JSON.stringify(name)} && !button.disabled)`);
  await evaluate(`[...document.querySelectorAll('.knowledge-list button')].find(button => button.querySelector('strong').innerText === ${JSON.stringify(name)}).click()`);
  await waitFor(`document.querySelector('.knowledge-name input')?.value === ${JSON.stringify(name)} && document.querySelector('.knowledge-name button')?.disabled === false`);
  if (revision) await waitFor(`document.querySelector('.knowledge-main .knowledge-actions small')?.innerText.includes(${JSON.stringify(revision.slice(0, 8))})`);
}
async function choose(base) { await evaluate(`{ const select = document.querySelector('#chat-knowledge'); select.value = ${JSON.stringify(`${base.id}:${base.revision}`)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`); await waitFor(`document.querySelector('#chat-knowledge').value === ${JSON.stringify(`${base.id}:${base.revision}`)}`); }
async function reply(question, marker) {
  const previous = await evaluate("document.querySelectorAll('.message.assistant').length");
  await fill(".composer textarea", question); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor(`document.querySelectorAll('.message.assistant').length > ${previous} && !document.querySelector('[aria-label="停止生成"]') && ![...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('正在排版回复')`, 900);
  if (marker) assert.ok((await evaluate("[...document.querySelectorAll('.message.assistant')].at(-1).innerText")).includes(marker));
}
const fixturePaths = ["refund.md", "warranty.txt"].map(filename => fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url)));
const fixtureContents = fixturePaths.map(path => readFileSync(path, "utf8"));
async function upload() { const { root } = await command("DOM.getDocument"); const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: '[aria-label="导入知识库资料"]' }); await command("DOM.setFileInputFiles", { nodeId, files: fixturePaths }); }
const baseName = `资料验证-${Date.now()}`;
let originalState, baseline, baseId;
try {
  await waitFor("Boolean(document.querySelector('#chat-knowledge')) && !document.querySelector('#chat-knowledge').disabled");
  originalState = await evaluate("localStorage.getItem('modelport.chat.v1')");
  assert.equal(JSON.parse(originalState ?? "{}").conversations?.length ?? 0, 0, "Use a fresh isolated profile, not real chats");
  baseline = await invoke("list_knowledge_bases");
  await openKnowledge(); await click(".knowledge-page > .knowledge-actions button", "新建知识库");
  await fill('[aria-label="知识库名称"]', baseName); await click(".knowledge-name button", "保存知识库");
  await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('知识库已保存')");
  let base = (await invoke("list_knowledge_bases")).find(base => base.name === baseName); assert.ok(base); baseId = base.id;
  assert.equal(base.enabled, false); assert.equal(base.documentCount, 0);
  const initial = ref(base);
  await upload(); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('资料已导入')");
  base = (await invoke("get_knowledge_base", { id: baseId })).summary;
  assert.equal(base.documentCount, 2); assert.notEqual(base.revision, initial.revision); assert.equal(base.enabled, false);
  await evaluate("[...document.querySelectorAll('.knowledge-documents > div > button:first-child')].find(button => button.innerText.includes('refund.md')).click()");
  await waitFor("document.querySelector('.knowledge-document pre')?.textContent.includes('<script>')");
  assert.equal(await evaluate("window.__unsafeKnowledgeDocument"), undefined);
  await fill('[aria-label="知识库检索问题"]', "申请退款"); await click(".knowledge-search button", "测试检索");
  await waitFor("document.querySelector('.knowledge-results h4')?.innerText.includes('命中')");
  assert.ok(await evaluate("[...document.querySelectorAll('.knowledge-results article')].some(article => article.innerText.includes('refund.md') && article.innerText.includes('7 天'))"));
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await click(".knowledge-actions button", "启用知识库"); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('已启用')");
  await closeSettings(); await choose(base);
  await reply("What is the refund verification code in these documents? Give the exact code and cite its source.", "MODELPORT_KNOWLEDGE_VERIFIED_74291");
  await waitFor("Boolean(document.querySelector('.message-sources'))");
  assert.ok(await evaluate("document.querySelector('.message-knowledge')?.innerText.includes('资料验证')"));
  let state = JSON.parse(await evaluate("localStorage.getItem('modelport.chat.v1')"));
  const matchedId = state.activeConversationId;
  const firstSource = state.conversations[0].messages.find(message => message.role === "assistant").retrieval.sources[0];
  assert.equal(firstSource.filename, "refund.md"); assert.ok(firstSource.text.includes("_74291"));
  await evaluate("document.querySelector('.message-sources').open = true; document.querySelector('.message-sources details').open = true");
  if (process.argv[4]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[4], Buffer.from(data, "base64")); }
  await reload(); await waitFor(`document.querySelector('#chat-knowledge').value === ${JSON.stringify(`${base.id}:${base.revision}`)}`);
  assert.ok(await evaluate("Boolean(document.querySelector('.message-sources'))"));
  console.log("PASS: actual TXT/Markdown file upload, safe literal preview, Chinese retrieval, enable/select and real Ollama evidence-based answer with persisted source snapshots");

  await evaluate("document.querySelector('.primary-actions button').click()"); assert.equal(await evaluate("document.querySelector('#chat-knowledge').value"), "");
  await choose(base); await reply("quasar xenolith 99999", "没有在当前知识库中检索到");
  await waitFor("Boolean(document.querySelector('.knowledge-no-match'))");
  const renamed = await invoke("save_knowledge_base", { base: ref(base), name: `${baseName}-改名` });
  await openKnowledge(); await closeSettings(); await waitFor("document.querySelector('.knowledge-bar .skill-update')?.innerText.includes('更新')");
  const beforeUpdate = dialogs; await reply("quasar xenolith 99999", "没有在当前知识库中检索到"); assert.ok(dialogs > beforeUpdate);
  base = renamed.summary;
  state = JSON.parse(await evaluate("localStorage.getItem('modelport.chat.v1')"));
  assert.equal(state.conversations.find(conversation => conversation.id === matchedId).messages.find(message => message.role === "assistant").retrieval.base.name, baseName);
  assert.equal(state.conversations[0].messages.filter(message => message.role === "assistant").at(-1).retrieval.sources.length, 0);
  console.log("PASS: new conversations start without knowledge; no-match answers and metadata are deterministic; version changes require confirmation without rewriting historical sources");

  await openKnowledge(); await openBase(base.name);
  acceptDialog = false; const beforeDuplicate = dialogs; await upload();
  for (let attempt = 0; attempt < 30 && dialogs === beforeDuplicate; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(dialogs > beforeDuplicate); assert.deepEqual((await invoke("get_knowledge_base", { id: baseId })).summary, base);
  acceptDialog = true; await upload(); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('资料已导入')");
  let record = await invoke("get_knowledge_base", { id: baseId }); assert.equal(record.summary.enabled, false);
  const updated = await invoke("import_knowledge_documents", { base: ref(record.summary), documents: [{ filename: "refund.md", text: "Refund policy: 14 days.\nRefund verification code: MODELPORT_KNOWLEDGE_UPDATED_84302." }], replace: true });
  assert.notEqual(updated.summary.revision, record.summary.revision);
  const stale = await evaluate(`window.__TAURI_INTERNALS__.invoke('search_knowledge_base', { base: ${JSON.stringify(ref(record.summary))}, query: 'refund' }).then(() => 'unexpected', error => String(error))`);
  assert.ok(stale.includes("已更新"));
  await openBase(base.name, updated.summary.revision); await click(".knowledge-actions button", "启用知识库"); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('已启用')");
  await closeSettings(); await evaluate("document.querySelector('.primary-actions button').click()"); await choose(updated.summary);
  await reply("What is the refund verification code? Give the exact code from the documents.", "MODELPORT_KNOWLEDGE_UPDATED_84302");
  console.log("PASS: duplicate cancellation preserves the library, confirmed import disables it, content replacement changes revisions and refreshed evidence affects an actual new Ollama reply");

  await openKnowledge(); await openBase(base.name);
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.knowledge-main'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
  await command("Emulation.clearDeviceMetricsOverride");
  await fill('[aria-label="知识库名称"]', "未保存知识库名称"); acceptDialog = false; const beforeClose = dialogs;
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()"); assert.ok(dialogs > beforeClose); assert.ok(await evaluate("Boolean(document.querySelector('.settings-dialog'))"));
  acceptDialog = true; await closeSettings(); await openKnowledge(); await openBase(base.name);
  await evaluate("document.querySelector('[aria-label=\"删除资料 refund.md\"]').click()"); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('已删除')");
  record = await invoke("get_knowledge_base", { id: baseId }); assert.equal(record.documents.length, 1); assert.equal(record.summary.enabled, false);
  await click(".knowledge-actions button", "删除知识库"); await waitFor("document.querySelector('.knowledge-notice')?.innerText.includes('已删除')");
  await closeSettings(); assert.equal(await evaluate("document.querySelector('#chat-knowledge').value"), "");
  state = JSON.parse(await evaluate("localStorage.getItem('modelport.chat.v1')"));
  assert.ok(state.conversations.find(conversation => conversation.id === matchedId).messages.find(message => message.role === "assistant").retrieval.sources[0].text.includes("_74291"));
  for (let index = 0; index < fixturePaths.length; index++) assert.equal(readFileSync(fixturePaths[index], "utf8"), fixtureContents[index]);
  assert.deepEqual(errors, []);
  console.log("PASS: minimum window size, unsaved-name cancellation, document/base deletion clears selections while retaining source snapshots and original files; no JavaScript exceptions");
} catch (error) {
  console.error("Knowledge UI failure:", await evaluate("({ title: document.querySelector('#settings-page-title')?.innerText, name: document.querySelector('.knowledge-name input')?.value, notice: document.querySelector('.knowledge-notice')?.innerText, editorButtons: [...document.querySelectorAll('.knowledge-main button')].map(button => ({ text: button.innerText, disabled: button.disabled })) })"));
  throw error;
} finally {
  acceptDialog = true;
  if (baseId) { const current = (await invoke("list_knowledge_bases")).find(base => base.id === baseId); if (current) await invoke("remove_knowledge_base", { base: ref(current) }); }
  if (originalState !== undefined) { await evaluate(originalState === null ? "localStorage.removeItem('modelport.chat.v1')" : `localStorage.setItem('modelport.chat.v1', ${JSON.stringify(originalState)})`); await reload(); }
  if (baseline) assert.deepEqual(await invoke("list_knowledge_bases"), baseline, "Existing knowledge bases must not change");
  close();
}
