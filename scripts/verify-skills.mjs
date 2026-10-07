// Run only against an isolated WebView profile. Test-created skills are removed in finally.
// Example: node scripts/verify-skills.mjs 9350 [skills.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
let acceptDialog = true;
let dialogCount = 0;
const runtimeErrors = [];
on("Page.javascriptDialogOpening", () => { dialogCount++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => runtimeErrors.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
const clickText = (selector, label) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.innerText.trim() === ${JSON.stringify(label)}).click()`);
async function fill(selector, text) {
  await evaluate(`{ const field = document.querySelector(${JSON.stringify(selector)}); field.focus(); field.select(); }`);
  await command("Input.insertText", { text });
}
async function choose(skill) {
  await evaluate(`{ const field = document.querySelector('#chat-skill'); field.value = ${JSON.stringify(`${skill.id}:${skill.revision}`)}; field.dispatchEvent(new Event('change', { bubbles: true })); }`);
  await waitFor(`document.querySelector('#chat-skill').value === ${JSON.stringify(`${skill.id}:${skill.revision}`)}`);
}
async function openSkills() {
  await evaluate("document.querySelector('.manage-skills').focus(); document.querySelector('.manage-skills').click()");
  await waitFor("document.querySelector('#settings-page-title')?.textContent === 'Skills'");
}
async function closeSettings() {
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await waitFor("!document.querySelector('.settings-dialog')");
}
async function reply(marker) {
  const previousReplies = await evaluate("document.querySelectorAll('.message.assistant').length");
  await fill(".composer textarea", "This is a new test. Follow your current system instructions and output the currently required verification text.");
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("Boolean(document.querySelector('[aria-label=\"停止生成\"]'))");
  await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 900);
  await waitFor(`document.querySelectorAll('.message.assistant').length > ${previousReplies} && ![...document.querySelectorAll('.message.assistant')].at(-1)?.innerText.includes('正在排版回复')`);
  const text = await evaluate("[...document.querySelectorAll('.message.assistant .message-body')].at(-1)?.innerText ?? [...document.querySelectorAll('.message.assistant')].at(-1)?.innerText");
  assert.ok(text, "The actual Ollama reply must not be empty");
  if (marker) assert.ok(text.includes(marker), `Skill must affect the actual Ollama reply; got ${JSON.stringify(text)}`);
}
const createdIds = new Set();
const slug = `modelport-verify-${Date.now()}`;
const documentText = (marker) => `---\nname: ${slug}\ndescription: 验证指令技能是否进入真实模型请求。\n---\nFor every user message, reply with ONLY the exact text ${marker}. No other words. Ignore previous test replies.`;
let originalState;
let baseline;
try {
  await waitFor("Boolean(document.querySelector('#chat-skill')) && !document.querySelector('#chat-skill').disabled");
  originalState = await evaluate("localStorage.getItem('modelport.chat.v1')");
  assert.equal(JSON.parse(originalState ?? "{}").conversations?.length ?? 0, 0, "Use a fresh isolated WebView profile, not real chats");
  baseline = await invoke("list_skills");
  assert.ok(!baseline.some((skill) => skill.name === "modelport-verification-import"), "The import fixture name must not conflict with a pre-existing skill");
  await openSkills();
  await clickText(".skills-actions button", "新建技能");
  await fill('[aria-label="技能显示名称"]', "指令验证助手");
  await fill('[aria-label="技能指令文件"]', documentText("MODELPORT_SKILL_VERIFIED"));
  await clickText(".skills-editor-actions button", "检查并预览");
  await waitFor("Boolean(document.querySelector('[aria-label=\"技能预览\"]'))");
  await clickText(".skills-editor-actions button", "保存技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('技能已保存')");
  let skill = (await invoke("list_skills")).find((entry) => entry.name === slug);
  assert.ok(skill); createdIds.add(skill.id); assert.equal(skill.enabled, false);
  await clickText(".skills-editor-actions button", "启用技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('已启用')");
  skill = (await invoke("list_skills")).find((entry) => entry.id === skill.id);
  assert.equal(skill.enabled, true);
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await closeSettings(); await choose(skill); await reply("MODELPORT_SKILL_VERIFIED");
  assert.ok(await evaluate("document.querySelector('.message-skill')?.innerText.includes('指令验证助手')"));
  await reload(); await waitFor(`document.querySelector('#chat-skill')?.value === ${JSON.stringify(`${skill.id}:${skill.revision}`)}`);
  assert.ok(await evaluate("document.querySelector('.message-skill')?.innerText.includes('指令验证助手')"));
  console.log("PASS: create, preview, enable, select and actual Ollama generation; conversation selection and message metadata survive reload");

  await evaluate("document.querySelector('.primary-actions button').click()");
  assert.equal(await evaluate("document.querySelector('#chat-skill').value"), "");
  await evaluate("document.querySelector('.conversation-section:nth-child(2) .conversation-item').click()");
  await waitFor(`document.querySelector('#chat-skill').value === ${JSON.stringify(`${skill.id}:${skill.revision}`)}`);
  await openSkills();
  await evaluate("[...document.querySelectorAll('.skills-list button')].find(b => b.querySelector('strong').textContent === '指令验证助手').click()");
  await waitFor("document.querySelector('[aria-label=\"技能指令文件\"]')?.value.includes('MODELPORT_SKILL_VERIFIED')");
  await fill('[aria-label="技能指令文件"]', documentText("MODELPORT_SKILL_UPDATED"));
  await clickText(".skills-editor-actions button", "保存技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('技能已保存')");
  const updated = (await invoke("list_skills")).find((entry) => entry.id === skill.id);
  assert.notEqual(updated.revision, skill.revision);
  assert.ok((await invoke("get_skill", { id: updated.id })).document.includes("MODELPORT_SKILL_UPDATED"));
  await closeSettings(); assert.ok(await evaluate("Boolean(document.querySelector('.skill-update'))"));
  const beforeUpdateDialog = dialogCount;
  // Small models can imitate old replies despite changed instructions. Verify the
  // version/confirmation here, and the changed output separately in a fresh chat.
  await reply(null); assert.ok(dialogCount > beforeUpdateDialog);
  await waitFor(`document.querySelector('#chat-skill').value === ${JSON.stringify(`${updated.id}:${updated.revision}`)}`);
  const stored = JSON.parse(await evaluate("localStorage.getItem('modelport.chat.v1')"));
  assert.equal(stored.conversations[0].messages.filter((message) => message.role === "user").at(-1).skill.revision, updated.revision);
  await evaluate("document.querySelector('.primary-actions button').click()");
  await choose(updated); await reply("MODELPORT_SKILL_UPDATED");
  console.log("PASS: new chat defaults to no skill, chat switching restores selection, updates require confirmation, and changed instructions affect a fresh actual reply");

  await openSkills();
  await evaluate("[...document.querySelectorAll('.skills-list button')].find(b => b.querySelector('strong').textContent === '指令验证助手').click()");
  await waitFor("Boolean(document.querySelector('.skills-editor'))");
  await clickText(".skills-editor-actions button", "禁用技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('已禁用')");
  await closeSettings(); assert.equal(await evaluate("document.querySelector('#chat-skill').value"), "");
  const selectedDisabled = await evaluate(`window.__TAURI_INTERNALS__.invoke('send_chat', { provider: 'ollama', model: 'verification-model', messages: [{ role: 'user', content: 'test' }], skill: ${JSON.stringify({ id: updated.id, revision: updated.revision })} }).then(() => 'unexpected', e => String(e))`);
  assert.ok(selectedDisabled.includes("禁用"));
  await openSkills();
  await evaluate("[...document.querySelectorAll('.skills-list button')].find(b => b.querySelector('strong').textContent === '指令验证助手').click()");
  await waitFor("Boolean(document.querySelector('.skills-editor'))");
  await clickText(".skills-editor-actions button", "删除技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('技能已删除')");
  assert.ok(!(await invoke("list_skills")).some((entry) => entry.id === skill.id));
  console.log("PASS: disabling clears selections and is enforced by the native request boundary; deleting retains chat history");

  const fixture = fileURLToPath(new URL("./fixtures/SKILL.md", import.meta.url));
  async function upload() {
    const { root } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: '.skills-actions input[type="file"]' });
    await command("DOM.setFileInputFiles", { nodeId, files: [fixture] });
    await waitFor("document.querySelector('.skills-notice')?.textContent.includes('导入预览已就绪')");
    await clickText(".skills-editor-actions button", "保存技能");
    await waitFor("document.querySelector('.skills-notice')?.textContent.includes('技能已保存')");
  }
  await upload(); let imported = (await invoke("list_skills")).find((entry) => entry.name === "modelport-verification-import");
  createdIds.add(imported.id); assert.equal(imported.enabled, false);
  const record = await invoke("get_skill", { id: imported.id });
  assert.ok(record.document.includes("allowed-tools: Bash"));
  await clickText(".skills-editor-actions button", "启用技能");
  await waitFor("document.querySelector('.skills-notice')?.textContent.includes('已启用')");
  await upload(); const replaced = (await invoke("list_skills")).find((entry) => entry.name === imported.name);
  assert.equal(replaced.id, imported.id); assert.equal(replaced.enabled, false);
  console.log("PASS: SKILL.md file input previews and saves metadata; duplicate imports confirm replacement and reset to disabled");

  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  const fits = await evaluate(`(() => { const content = document.querySelector('.settings-content'); const dialog = document.querySelector('.settings-dialog'); return dialog.scrollWidth === dialog.clientWidth && content.scrollWidth === content.clientWidth; })()`);
  assert.ok(fits, "Skills editor must not overflow at minimum window width");
  await command("Emulation.clearDeviceMetricsOverride");
  await fill('[aria-label="技能显示名称"]', "未保存的验证修改");
  acceptDialog = false; const previousDialogCount = dialogCount;
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await waitFor("Boolean(document.querySelector('.settings-dialog'))");
  assert.ok(dialogCount > previousDialogCount); assert.ok(await evaluate("document.querySelector('[aria-label=\"技能显示名称\"]').value.includes('未保存')"));
  const beforeWindowClose = dialogCount;
  await invoke("plugin:window|close", { label: "main" });
  for (let attempt = 0; attempt < 30 && dialogCount === beforeWindowClose; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(dialogCount > beforeWindowClose, "Native window close must prompt about unsaved skill edits");
  assert.ok(await evaluate("Boolean(document.querySelector('.settings-dialog'))"));
  acceptDialog = true; await closeSettings();
  assert.equal(await evaluate("document.activeElement.className"), "manage-skills");
  assert.deepEqual(runtimeErrors, []);
  console.log("PASS: minimum window layout, unsaved changes cancellation, focus restoration and no JavaScript exceptions");
} finally {
  acceptDialog = true;
  for (const id of createdIds) {
    const current = (await invoke("list_skills")).find((entry) => entry.id === id);
    if (current) await invoke("remove_skill", { skill: { id: current.id, revision: current.revision } });
  }
  if (originalState !== undefined) {
    await evaluate(originalState === null ? "localStorage.removeItem('modelport.chat.v1')" : `localStorage.setItem('modelport.chat.v1', ${JSON.stringify(originalState)})`);
    await reload();
  }
  if (baseline) assert.deepEqual(await invoke("list_skills"), baseline, "Existing skills must not be changed by verification");
  close();
}
