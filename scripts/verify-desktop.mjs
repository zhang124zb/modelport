// Run against a ModelPort WebView with a fresh, isolated user-data folder.
// Example: node scripts/verify-desktop.mjs 9342 [modal.png] [settings.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";

const port = Number(process.argv[2] ?? 9342);
const { command, evaluate, waitFor, reload, close } = await connectDesktop(port);

let originalState;
try {
  await waitFor("Boolean(document.querySelector('.model-trigger'))");
  originalState = await evaluate("localStorage.getItem('modelport.chat.v1')");
  assert.equal(JSON.parse(originalState ?? "{}").conversations?.length ?? 0, 0,
    "Use an isolated WebView profile; verification must not modify real conversations");
  const { models } = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
  assert.ok(models.length, "Install an Ollama model before running this check");
  const localName = models[0].name;
  await waitFor(`document.querySelector('.model-trigger').innerText.includes(${JSON.stringify(localName)})`);
  console.log(`PASS: blank startup discovers Ollama (${localName})`);

  await evaluate("[...document.querySelectorAll('.utility-nav button')].find(b => b.innerText.includes('模型连接')).click()");
  await waitFor("Boolean(document.querySelector('.connection-modal'))");
  await waitFor("getComputedStyle(document.querySelector('.connection-modal')).opacity === '1'");
  await waitFor(`['.brand-mark', '.window-actions'].every(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('modal-backdrop');
  })`);
  const modal = await evaluate(`(() => {
    const covered = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('modal-backdrop');
    };
    return { brandCovered: covered('.brand-mark'), controlsCovered: covered('.window-actions'),
      blur: getComputedStyle(document.querySelector('.modal-backdrop')).backdropFilter,
      provider: document.querySelector('.provider-card.selected strong').textContent,
      keyField: Boolean(document.querySelector('.key-field')) };
  })()`);
  assert.ok(modal.brandCovered && modal.controlsCovered && modal.blur.includes("blur"), JSON.stringify(modal));
  assert.equal(modal.provider, "Ollama");
  assert.equal(modal.keyField, false);
  if (process.argv[3]) {
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.argv[3], Buffer.from(data, "base64"));
  }
  console.log("PASS: modal dims and blurs the logo/titlebar, and defaults to Ollama without an API Key field");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click(); document.querySelector('.model-trigger').click()");
  await evaluate("[...document.querySelectorAll('.model-menu button')].find(b => b.innerText.includes('DeepSeek Flash')).click()");
  await waitFor("document.querySelector('.model-trigger').innerText.includes('DeepSeek Flash')");
  await evaluate("document.querySelector('.primary-actions button').click()");
  await waitFor(`document.querySelector('.model-trigger').innerText.includes(${JSON.stringify(localName)})`);
  await reload();
  await waitFor(`document.querySelector('.model-trigger')?.innerText.includes(${JSON.stringify(localName)})`);
  console.log("PASS: new chat and restart return to the local model after selecting a cloud model");

  await evaluate("{ const button = document.querySelector('.utility-nav [aria-label=\"设置\"]'); button.focus(); button.click(); }");
  await waitFor("Boolean(document.querySelector('.settings-dialog:modal'))");
  const labels = ["ModelPort账户", "模型提供方", "默认模型", "联网搜索", "MCP", "知识库", "Skills", "智能体", "文档解析器", "对话设置"];
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.settings-nav button')].map(b => b.innerText.trim())"), labels);
  assert.equal(await evaluate("document.querySelector('#settings-page-title').textContent"), labels[0]);
  assert.ok(await evaluate("getComputedStyle(document.querySelector('.settings-dialog'), '::backdrop').backdropFilter.includes('blur')"));
  assert.ok(await evaluate("Boolean(document.activeElement.closest('.settings-dialog'))"));
  if (process.argv[4]) {
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.argv[4], Buffer.from(data, "base64"));
  }
  for (const label of labels) {
    await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(b => b.innerText.trim() === ${JSON.stringify(label)}).click()`);
    await waitFor(`document.querySelector('#settings-page-title').textContent === ${JSON.stringify(label)}`);
    assert.equal(await evaluate("document.querySelector('.settings-nav [aria-current=\"page\"]').innerText.trim()"), label);
    if (label === "模型提供方") {
      await evaluate("document.querySelector('.settings-content .connection-actions button').click()");
      await waitFor("document.querySelector('.settings-content .connection-notice')?.textContent.includes('连接成功')");
    }
  }
  console.log("PASS: all 10 settings pages navigate correctly and provider settings connect to Ollama");
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  const compact = await evaluate(`(() => {
    const dialog = document.querySelector('.settings-dialog');
    const nav = document.querySelector('.settings-nav');
    const rect = dialog.getBoundingClientRect();
    return { fits: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      navScrolls: nav.scrollHeight > nav.clientHeight, noHorizontalOverflow: dialog.scrollWidth === dialog.clientWidth };
  })()`);
  assert.ok(compact.fits && compact.navScrolls && compact.noHorizontalOverflow, JSON.stringify(compact));
  await command("Emulation.clearDeviceMetricsOverride");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('.settings-dialog')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "设置");
  console.log("PASS: settings fit the minimum window size, scroll the menu and restore focus after Escape");

  const history = { activeConversationId: "verification-cloud", conversations: [{
    id: "verification-cloud", title: "Verification conversation", date: "10/06",
    model: { id: "deepseek-flash", name: "DeepSeek Flash", provider: "deepseek", tone: "#5368ff", label: "D" },
    messages: [{ id: "verification-message", role: "user", content: "Saved history check" }],
  }] };
  await evaluate(`localStorage.setItem('modelport.chat.v1', ${JSON.stringify(JSON.stringify(history))})`);
  await reload();
  await waitFor("document.querySelector('.model-trigger')?.innerText.includes('DeepSeek Flash')");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('modelport.chat.v1')).conversations[0].model.provider"), "deepseek");
  console.log("PASS: a saved conversation retains its cloud model");
} finally {
  if (originalState !== undefined) {
    await evaluate(originalState === null ? "localStorage.removeItem('modelport.chat.v1')"
      : `localStorage.setItem('modelport.chat.v1', ${JSON.stringify(originalState)})`);
    await reload();
  }
  close();
}
