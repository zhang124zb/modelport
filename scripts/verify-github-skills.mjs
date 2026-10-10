import { desktopChatStateExpression } from "./chat-storage-fixture.mjs";
// Run against a fresh isolated WebView profile with internet access. Never replaces existing skills.
// Example: node scripts/verify-github-skills.mjs 9350 [github-skills.png]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9350));
let acceptDialog = true;
let dialogCount = 0;
const errors = [];
on("Page.javascriptDialogOpening", () => { dialogCount++; void command("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
on("Runtime.exceptionThrown", ({ exceptionDetails }) => errors.push(exceptionDetails.text));
await command("Page.enable"); await command("Runtime.enable");
const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
async function invokeLong(name, args) {
  await evaluate(`window.__githubVerificationResult = null; void window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)}).then(value => { window.__githubVerificationResult = { value }; }, error => { window.__githubVerificationResult = { error: String(error) }; });`);
  await waitFor("window.__githubVerificationResult !== null", 350);
  return evaluate("window.__githubVerificationResult");
}
const click = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(button => button.innerText.trim() === ${JSON.stringify(text)}).click()`);
async function fill(selector, text) {
  await evaluate(`{ const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); }`);
  await command("Input.insertText", { text });
}
async function openInstaller() {
  await evaluate("document.querySelector('.manage-skills').click()");
  await waitFor("document.querySelector('#settings-page-title')?.textContent === 'Skills'");
  await click(".skills-actions button", "从 GitHub 安装");
  await fill('[aria-label="GitHub 仓库地址"]', "https://github.com/anthropics/skills");
  await fill('[aria-label="GitHub 技能文件路径"]', "skills/webapp-testing/SKILL.md");
}
async function fetchPreview() {
  await click(".skills-github button", "获取安装预览");
  await waitFor("document.querySelector('.skills-github button')?.innerText === '获取安装预览' && Boolean(document.querySelector('.skills-notice'))", 350);
  const notice = await evaluate("document.querySelector('.skills-notice').innerText");
  assert.ok(notice.includes("GitHub 预览已就绪"), `Live GitHub preview failed: ${notice}`);
}

let baseline;
const createdIds = new Set();
try {
  await waitFor("Boolean(document.querySelector('.manage-skills'))");
  const state = await evaluate(desktopChatStateExpression);
  assert.equal(state.conversations?.length ?? 0, 0, "Use a fresh isolated profile, not real chats");
  baseline = await invoke("list_skills");
  assert.ok(!baseline.some(skill => skill.name === "webapp-testing"), "Do not replace an existing webapp-testing skill");
  for (const args of [
    { repository: "https://github.com.evil.test/owner/repo", gitRef: "", path: "SKILL.md" },
    { repository: "owner/repo", gitRef: "", path: "../SKILL.md" },
  ]) {
    const result = await invokeLong("preview_github_skill", args);
    assert.ok(result.error);
    assert.deepEqual(await invoke("list_skills"), baseline);
  }
  await openInstaller();
  await fetchPreview();
  assert.equal(await evaluate("document.querySelector('[aria-label=\"技能指令文件\"]').readOnly"), true);
  const document = await evaluate("document.querySelector('[aria-label=\"技能指令文件\"]').value");
  const commit = await evaluate("document.querySelector('.skills-github-origin code').innerText.replace('提交：', '')");
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(document.startsWith("---"));
  assert.deepEqual(await invoke("list_skills"), baseline, "Preview must not install automatically");
  await fill('[aria-label="技能显示名称"]', "GitHub 安装验证");
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await click(".skills-editor-actions button", "安装技能");
  await waitFor("document.querySelector('.skills-notice')?.innerText.includes('技能已安装')", 350);
  let skill = (await invoke("list_skills")).find(skill => skill.name === "webapp-testing");
  assert.ok(skill); createdIds.add(skill.id);
  assert.equal(skill.enabled, false);
  const record = await invoke("get_skill", { id: skill.id });
  assert.equal(record.document, document);
  assert.equal(skill.github.repository, "anthropics/skills");
  assert.equal(skill.github.path, "skills/webapp-testing/SKILL.md");
  assert.equal(skill.github.commit, commit);
  assert.equal(skill.github.documentHash, createHash("sha256").update(document).digest("hex"));
  assert.equal(await evaluate("document.querySelector('[aria-label=\"技能指令文件\"]').readOnly"), false);
  console.log("PASS: actual public GitHub download, read-only preview, pinned commit installation and disabled-by-default provenance");

  await reload();
  assert.deepEqual((await invoke("get_skill", { id: skill.id })).summary.github, skill.github);
  await openInstaller();
  await evaluate("[...document.querySelectorAll('.skills-list button')].find(b => b.querySelector('strong').innerText === 'GitHub 安装验证').click()");
  await waitFor("Boolean(document.querySelector('.skills-editor'))");
  await click(".skills-editor-actions button", "启用技能");
  await waitFor("document.querySelector('.skills-notice')?.innerText.includes('已启用')");
  skill = (await invoke("list_skills")).find(entry => entry.id === skill.id);
  assert.equal(skill.enabled, true);
  await fill('[aria-label="GitHub 分支或版本"]', commit);
  await fetchPreview();
  acceptDialog = false; const before = dialogCount;
  await click(".skills-editor-actions button", "安装技能");
  await waitFor("!document.querySelector('.skills-editor-actions button')?.disabled");
  assert.ok(dialogCount > before);
  assert.deepEqual((await invoke("get_skill", { id: skill.id })).summary, skill, "Cancel must not replace or disable an existing skill");
  acceptDialog = true;
  await click(".skills-editor-actions button", "安装技能");
  await waitFor("document.querySelector('.skills-notice')?.innerText.includes('技能已安装')", 350);
  const replaced = (await invoke("list_skills")).find(entry => entry.id === skill.id);
  assert.equal(replaced.enabled, false);
  assert.equal(replaced.github.commit, commit);
  console.log("PASS: installed provenance survives reload; explicit commit works; duplicate cancellation preserves data and confirmed replacement disables the same ID");

  const beforeFailure = await invoke("list_skills");
  const mismatch = await invokeLong("install_github_skill", { origin: { ...replaced.github, documentHash: "0".repeat(64) }, displayName: "Do not install", id: null, expectedRevision: null });
  assert.ok(mismatch.error?.includes("不一致"), JSON.stringify(mismatch));
  assert.deepEqual(await invoke("list_skills"), beforeFailure);
  await fill('[aria-label="GitHub 技能文件路径"]', "modelport-nonexistent-test/SKILL.md");
  await click(".skills-github button", "获取安装预览");
  await waitFor("document.querySelector('.skills-notice')?.innerText.includes('未找到')", 350);
  assert.deepEqual(await invoke("list_skills"), beforeFailure);
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate("['.settings-dialog', '.settings-content', '.skills-github'].every(selector => { const el = document.querySelector(selector); return el.scrollWidth === el.clientWidth; })"));
  await command("Emulation.clearDeviceMetricsOverride");
  assert.deepEqual(errors, []);
  console.log("PASS: invalid hosts/paths, content mismatch and nonexistent file leave the library intact; minimum window layout and runtime exceptions checked");
} finally {
  acceptDialog = true;
  for (const id of createdIds) {
    const skill = (await invoke("list_skills")).find(entry => entry.id === id);
    if (skill) await invoke("remove_skill", { skill: { id, revision: skill.revision } });
  }
  if (baseline) assert.deepEqual(await invoke("list_skills"), baseline, "Verification must preserve existing skills");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]')?.click()");
  close();
}
