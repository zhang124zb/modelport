// Fresh isolated WebView only. Controlled localhost Ollama fixture, never a cloud request or real user history.
// Stop Ollama before running this fixture; it refuses to occupy an in-use port.
// node scripts/verify-attachments.mjs 9370 [screenshot.png]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";
const requests = [];
let failNext = false;
const server = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "modelport-test-vision" }, { name: "modelport-test-text" }] }));
  if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: body.model === "modelport-test-vision" ? ["completion", "vision"] : ["completion"] }));
  if (req.url === "/api/chat") {
    requests.push(body);
    if (failNext) { failNext = false; res.statusCode = 400; return res.end(JSON.stringify({ error: "intentional test failure" })); }
    return res.end(JSON.stringify({ message: { role: "assistant", content: "附件验证回复：图片和文字资料已通过原生接口送达。" }, done: true }) + "\n");
  }
  res.statusCode = 404; res.end("{}");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(11434, "127.0.0.1", resolve); });
console.log("Controlled Ollama fixture listening on localhost only");
let client, originals, verified = false;
const ownIds = new Set(), exceptions = [];
const keys = ["modelport.chat.v1", "modelport.preferences.models.v1", "modelport.preferences.general.v1", "modelport.preferences.chat.v1"];
try {
  client = await connectDesktop(Number(process.argv[2] ?? 9370));
  const { command, evaluate, waitFor, reload, on } = client;
  on("Page.javascriptDialogOpening", () => void command("Page.handleJavaScriptDialog", { accept: true }));
  on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await command("Page.enable"); await command("Runtime.enable");
  originals = await Promise.all(keys.map(key => evaluate(`localStorage.getItem(${JSON.stringify(key)})`)));
  assert.equal(JSON.parse(originals[0] ?? "{}").conversations?.length ?? 0, 0, "Use a fresh isolated WebView, never real chats"); verified = true;
  const chat = () => evaluate("JSON.parse(localStorage.getItem('modelport.chat.v1') ?? '{}')");
  const draftCount = () => evaluate("document.querySelectorAll('[aria-label=\"待发送附件\"] .attachment-card').length");
  const notice = async pattern => { await waitFor("Boolean(document.querySelector('.attachment-dialog:modal'))"); assert.match(await evaluate("document.querySelector('.attachment-dialog').innerText"), pattern); };
  const closeNotice = async () => { await evaluate("document.querySelector('.attachment-confirm').click()"); await waitFor("!document.querySelector('.attachment-dialog')"); };
  const selectModel = async name => {
    await evaluate("document.querySelector('.model-trigger').click()");
    await evaluate(`[...document.querySelectorAll('.model-menu button')].find(button => button.innerText.includes(${JSON.stringify(name)})).click()`);
    await waitFor(`document.querySelector('.model-trigger').innerText.includes(${JSON.stringify(name)})`);
  };
  const fill = async text => { await evaluate("{ const el = document.querySelector('.composer textarea'); el.focus(); el.select(); }"); await command("Input.insertText", { text }); };
  const collectIds = async () => { for (const id of await evaluate("[...document.querySelectorAll('.attachment-card')].map(el => el.dataset.attachmentId)")) ownIds.add(id); };
  const upload = async (files, imageOnly = false) => {
    await evaluate(`{ const transfer = new DataTransfer(); ${files.map(file => `transfer.items.add(${file});`).join(" ")}
      const input = document.querySelector('[aria-label="${imageOnly ? "选择图片附件" : "选择聊天文件附件"}"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await waitFor("!document.querySelector('.attachment-status')"); await collectIds();
  };
  await evaluate("[...document.querySelectorAll('.utility-nav button')].find(button => button.innerText.includes('模型连接')).click()");
  await evaluate("document.querySelector('.provider-models-heading button').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('连接成功')");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await evaluate("document.querySelector('[aria-label=\"添加附件\"]').click()");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.attachment-menu button')].map(button => button.innerText)"), ["添加图片", "选择文件"]);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('.attachment-menu')");
  await evaluate("{ const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; canvas.getContext('2d').fillStyle = '#ff0000'; canvas.getContext('2d').fillRect(0, 0, 16, 16); window.__attachmentPng = canvas.toDataURL('image/png').split(',')[1]; }");
  const pngBase64 = await evaluate("window.__attachmentPng");
  const imageFile = `new File([Uint8Array.from(atob(${JSON.stringify(pngBase64)}), char => char.charCodeAt(0))], '红色图片.png', { type: 'image/png' })`;
  await selectModel("modelport-test-text");
  await upload([imageFile], true); await notice(/不支持图片识别/); assert.equal(await draftCount(), 0); assert.equal(requests.length, 0); await closeNotice();
  await upload(["new File(['video'], 'movie.mp4', { type: 'video/mp4' })"]); await notice(/不支持图片识别.*视频识别/s); await closeNotice();
  await selectModel("modelport-test-vision");
  await upload(["new File(['video'], 'movie.webm', { type: 'video/webm' })"]); await notice(/尚未接入视频识别/); await closeNotice();
  await upload(["new File(['pdf'], 'book.pdf')"]); await notice(/PDF.*暂不支持/); await closeNotice();
  await upload(Array(5).fill("new File(['hello'], 'a.txt')")); await notice(/最多.*4/); await closeNotice();
  console.log("PASS: menu, escape/focus, text-only Ollama image rejection, explicit video/unsupported-format prompts and count limits; no chat request sent");
  await upload([imageFile, "new File(['FILE_FACT_ATTACHMENT_ONLY'], '资料.md', { type: 'text/markdown' })"]);
  assert.equal(await draftCount(), 2); await waitFor("document.querySelector('[aria-label=\"待发送附件\"] img')?.naturalWidth > 0");
  await evaluate("document.querySelector('[aria-label=\"预览附件 资料.md\"]').click()"); await notice(/FILE_FACT_ATTACHMENT_ONLY/); await closeNotice();
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("document.querySelectorAll('.message.assistant').length === 1 && !document.querySelector('[aria-label=\"停止生成\"]')");
  assert.equal(requests.length, 1); assert.equal(requests[0].model, "modelport-test-vision");
  const user = requests[0].messages.find(message => message.role === "user");
  assert.equal(user.images.length, 1); assert.ok(user.content.includes("FILE_FACT_ATTACHMENT_ONLY"));
  const saved = await chat(); assert.equal(saved.conversations[0].messages[0].attachments.length, 2);
  assert.ok(!JSON.stringify(saved).includes("FILE_FACT_ATTACHMENT_ONLY") && !JSON.stringify(saved).includes(await evaluate("window.__attachmentPng")));
  await reload(); await waitFor("document.querySelector('[aria-label=\"消息附件\"] img')?.naturalWidth > 0");
  assert.equal(await evaluate("document.querySelectorAll('[aria-label=\"消息附件\"] .attachment-card').length"), 2);
  console.log("PASS: image/text previews, attachment-only send, native images array and text payload, metadata-only history and persisted attachments after restart");
  await selectModel("modelport-test-text"); await fill("历史图片不能被忽略");
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await notice(/不支持图片识别/);
  assert.equal(requests.length, 1); assert.equal((await chat()).conversations[0].messages.length, 2); assert.equal(await evaluate("document.querySelector('.composer textarea').value"), "历史图片不能被忽略"); await closeNotice();
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "N", code: "KeyN", windowsVirtualKeyCode: 78, modifiers: 10 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "N", code: "KeyN", windowsVirtualKeyCode: 78, modifiers: 10 });
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("document.querySelectorAll('.message.assistant').length === 2 && !document.querySelector('[aria-label=\"停止生成\"]')");
  assert.equal(requests.length, 2); assert.ok(requests[1].messages.every(message => !message.images));
  console.log("PASS: switching to text-only model blocks carried images before mutation; new-topic context safely excludes old attachments");
  await evaluate("document.querySelector('.primary-actions button').click()"); await selectModel("modelport-test-vision");
  await upload([imageFile]); failNext = true; await fill("失败重试保留附件");
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await waitFor("Boolean(document.querySelector('.chat-error button')) && !document.querySelector('[aria-label=\"停止生成\"]')");
  await evaluate("document.querySelector('.chat-error button').click()"); assert.equal(await draftCount(), 1);
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await waitFor("document.querySelectorAll('.message.assistant').length === 1 && !document.querySelector('[aria-label=\"停止生成\"]')");
  assert.equal(requests.at(-1).messages.find(message => message.role === "user").images.length, 1);
  const refs = (await chat()).conversations[0].messages[0].attachments;
  await evaluate(`window.__TAURI_INTERNALS__.invoke('remove_chat_attachments', { ids: [${JSON.stringify(refs[0].id)}] })`);
  const countBeforeMissing = requests.length; await fill("缺失附件不能忽略"); await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()"); await notice(/附件副本缺失/);
  assert.equal(requests.length, countBeforeMissing); await closeNotice();
  console.log("PASS: failed request editing/retry retains attachments; missing local copies block requests with actionable prompt");
  await evaluate("document.querySelector('.utility-nav [aria-label=\"设置\"]').click()");
  await evaluate("[...document.querySelectorAll('.settings-nav button')].find(button => button.innerText === '常规设置').click()");
  await evaluate("{ const el = document.querySelector('#general-theme'); el.value = 'dark'; el.dispatchEvent(new Event('change', { bubbles: true })); }");
  await evaluate("document.querySelector('.general-settings-save').click()"); await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click()");
  await command("Emulation.setDeviceMetricsOverride", { width: 920, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('[aria-label=\"添加附件\"]').click()");
  const layout = await evaluate("(() => { const menu = document.querySelector('.attachment-menu').getBoundingClientRect(), composer = document.querySelector('.composer'); return { menuOnscreen: menu.top >= 0 && menu.left >= 0 && menu.right <= innerWidth, buttonsVisible: [...document.querySelectorAll('.attachment-menu button'), document.querySelector('[aria-label=\"添加附件\"]')].every(button => button.getBoundingClientRect().height > 0), overflow: composer.scrollWidth > composer.clientWidth, theme: document.documentElement.classList.contains('dark') }; })()");
  assert.deepEqual(layout, { menuOnscreen: true, buttonsVisible: true, overflow: false, theme: true }); assert.deepEqual(exceptions, []);
  console.log("PASS: dark/minimum-size layout and no JavaScript runtime exceptions");
} finally {
  if (client && verified) {
    await client.evaluate("document.querySelector('.attachment-confirm')?.click(); document.querySelector('[aria-label=\"停止生成\"]')?.click()");
    await client.waitFor("!document.querySelector('[aria-label=\"停止生成\"]')");
    if (ownIds.size) await client.evaluate(`window.__TAURI_INTERNALS__.invoke('remove_chat_attachments', { ids: ${JSON.stringify([...ownIds])} })`);
    for (const [index, key] of keys.entries()) await client.evaluate(originals[index] === null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(originals[index])})`);
    await client.command("Emulation.clearDeviceMetricsOverride"); await client.reload();
  }
  client?.close(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve));
}
