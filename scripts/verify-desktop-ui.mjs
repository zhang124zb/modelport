// An empty isolated desktop profile only; navigation tests make no model requests.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";
import { desktopChatStateExpression } from "./chat-storage-fixture.mjs";

const client = await connectDesktop(Number(process.argv[2]));
const { command, evaluate, waitFor, on } = client;
const exceptions = [];
on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
on("Page.javascriptDialogOpening", () => void command("Page.handleJavaScriptDialog", { accept: false }));
await command("Runtime.enable"); await command("Page.enable");
try {
  await waitFor(`Boolean(document.querySelector('.model-trigger')) && Array.isArray(${desktopChatStateExpression}.conversations)`);
  assert.equal((await evaluate(desktopChatStateExpression)).conversations.length, 0, "Never operate on real chats");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.ok(await evaluate(`document.querySelector('.utility-nav .muted').innerText.includes(${JSON.stringify(version)})`));
  await evaluate("[...document.querySelectorAll('.utility-nav button')].find(button => button.innerText.includes('模型连接')).click()");
  await waitFor("Boolean(document.querySelector('.connection-modal'))");
  await waitFor(`['.brand-mark', '.window-actions'].every(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('modal-backdrop');
  })`);
  assert.ok(await evaluate("getComputedStyle(document.querySelector('.modal-backdrop')).backdropFilter.includes('blur')"));
  assert.equal(await evaluate("document.querySelector('.provider-card.selected').dataset.providerId"), "ollama");
  assert.equal(await evaluate("Boolean(document.querySelector('input[aria-label=\"API 密钥\"]'))"), false);
  await evaluate("document.querySelector('.connection-modal [aria-label=\"关闭设置\"]').click()");
  await waitFor("!document.querySelector('.connection-modal')");
  console.log("PASS: connection dialog covers logo/window controls, blur applies to the whole window, local provider needs no key field");

  await evaluate("{ const button = document.querySelector('.utility-nav [aria-label=\"设置\"]'); button.focus(); button.click(); }");
  await waitFor("Boolean(document.querySelector('.settings-dialog:modal'))");
  const labels = ["ModelPort账户", "模型提供方", "默认模型", "联网搜索", "MCP", "知识库", "Skills", "智能体", "文档解析器", "对话设置", "键盘快捷键", "常规设置"];
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.settings-nav button')].map(button => button.innerText.trim())"), labels);
  assert.ok(await evaluate("Boolean(document.activeElement.closest('.settings-dialog'))"));
  for (const label of labels) {
    await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText.trim() === ${JSON.stringify(label)}).click()`);
    await waitFor(`document.querySelector('#settings-page-title').innerText === ${JSON.stringify(label)}`);
    assert.equal(await evaluate("document.querySelector('.settings-nav [aria-current=\"page\"]').innerText.trim()"), label);
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  assert.ok(await evaluate(`(() => {
    const dialog = document.querySelector('.settings-dialog'), rect = dialog.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
  })()`));
  for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('.settings-dialog')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "设置");
  assert.deepEqual(exceptions, []);
  console.log("PASS: all 12 settings pages navigate, minimum-size dialog fits, Escape restores focus and no page exceptions");
} catch (error) {
  if (process.argv[3]) {
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.argv[3], Buffer.from(data, "base64"));
  }
  throw error;
} finally {
  await command("Emulation.clearDeviceMetricsOverride").catch(() => {});
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]')?.click()").catch(() => {});
  client.close();
}
