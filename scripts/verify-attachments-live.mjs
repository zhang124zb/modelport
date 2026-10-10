import { desktopChatStateExpression, chatStorageRawExpression, restoreChatStorageExpression } from "./chat-storage-fixture.mjs";
// Real local Ollama only, isolated empty WebView; never writes API keys or downloads models.
// node scripts/verify-attachments-live.mjs <port> [screenshot.png]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connectDesktop } from "./desktop-client.mjs";
const { command, evaluate, waitFor, reload, on, close } = await connectDesktop(Number(process.argv[2] ?? 9370));
const key = "modelport.chat.v1"; let original, verified = false; const ownIds = new Set();
on("Page.javascriptDialogOpening", () => void command("Page.handleJavaScriptDialog", { accept: true }));
await command("Page.enable");
try {
  original = await evaluate(chatStorageRawExpression);
  assert.equal((await evaluate(desktopChatStateExpression)).conversations?.length ?? 0, 0, "Use an empty isolated test WebView"); verified = true;
  const models = await evaluate("window.__TAURI_INTERNALS__.invoke('list_available_models', { provider: 'ollama' })");
  let chosen;
  for (const model of models) {
    const capabilities = await evaluate(`window.__TAURI_INTERNALS__.invoke('get_model_capabilities', { provider: 'ollama', model: ${JSON.stringify(model)} })`);
    if (capabilities.vision) { chosen = model; break; }
  }
  assert.ok(chosen, "Install a vision-capable Ollama model before running this check");
  await evaluate("[...document.querySelectorAll('.utility-nav button')].find(button => button.innerText.includes('模型连接')).click()");
  await evaluate("document.querySelector('.provider-models-heading button').click()"); await waitFor("document.querySelector('.connection-notice')?.innerText.includes('连接成功')");
  await evaluate("document.querySelector('[aria-label=\"关闭设置\"]').click(); document.querySelector('.model-trigger').click()");
  await evaluate(`[...document.querySelectorAll('.model-menu button')].find(button => button.innerText.includes(${JSON.stringify(chosen)})).click()`);
  await evaluate(`{ const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128; canvas.getContext('2d').fillStyle = '#ff0000'; canvas.getContext('2d').fillRect(0, 0, 256, 128);
    const png = canvas.toDataURL('image/png').split(',')[1]; const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], '真实识图测试.png', { type: 'image/png' }));
    transfer.items.add(new File(['附件校验短语：MODELPORT_LOCAL_ATTACHMENT_OK'], '真实文件测试.md', { type: 'text/markdown' }));
    const input = document.querySelector('[aria-label="选择聊天文件附件"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }`);
  await waitFor("document.querySelectorAll('[aria-label=\"待发送附件\"] .attachment-card').length === 2 && !document.querySelector('.attachment-status')");
  for (const id of await evaluate("[...document.querySelectorAll('[aria-label=\"待发送附件\"] .attachment-card')].map(el => el.dataset.attachmentId)")) ownIds.add(id);
  await evaluate("document.querySelector('.composer textarea').focus()");
  await command("Input.insertText", { text: "请用中文报告图片的主要颜色，然后逐字抄出文字附件里的校验短语。不要省略这两个部分。" });
  await evaluate("document.querySelector('[aria-label=\"发送消息\"]').click()");
  await waitFor("document.querySelector('.message.assistant')?.innerText.trim().length > 0 && !document.querySelector('[aria-label=\"停止生成\"]')", 900);
  assert.equal(await evaluate("Boolean(document.querySelector('.chat-error') || document.querySelector('.attachment-dialog'))"), false);
  const reply = await evaluate("document.querySelector('.message.assistant').innerText");
  assert.match(reply, /红|red/i); assert.ok(reply.includes("MODELPORT_LOCAL_ATTACHMENT_OK"), reply);
  if (process.argv[3]) { const { data } = await command("Page.captureScreenshot", { format: "png" }); writeFileSync(process.argv[3], Buffer.from(data, "base64")); }
  console.log(`PASS: real ${chosen} vision recognizes red image, reads exact text-attachment phrase, streams rendered response and preserves local attachment references`);
} finally {
  if (verified) {
    await evaluate("document.querySelector('.attachment-confirm')?.click(); document.querySelector('[aria-label=\"停止生成\"]')?.click()");
    await waitFor("!document.querySelector('[aria-label=\"停止生成\"]')", 900);
    if (ownIds.size) await evaluate(`window.__TAURI_INTERNALS__.invoke('remove_chat_attachments', { ids: ${JSON.stringify([...ownIds])} })`);
    await evaluate(key === "modelport.chat.v1" ? restoreChatStorageExpression(original) : original === null ? `localStorage.removeItem('${key}')` : `localStorage.setItem('${key}', ${JSON.stringify(original)})`); await reload();
  }
  close();
}
