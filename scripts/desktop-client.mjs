import assert from "node:assert/strict";

export async function connectDesktop(port) {
  let page;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = pages.find((entry) => entry.url === "http://tauri.localhost/" && entry.title === "ModelPort");
      if (page) break;
    } catch { /* The isolated WebView may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(page, "ModelPort WebView must be running");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method) { listeners.get(message.method)?.(message.params); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  }
  async function waitFor(expression, attempts = 50) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.fail(`Condition not reached: ${expression}`);
  }
  async function reload() {
    await evaluate("window.__verificationReloadMarker = true"); await command("Page.reload");
    await waitFor("!window.__verificationReloadMarker && Boolean(document.querySelector('.model-trigger'))");
  }
  return { command, evaluate, waitFor, reload, on: (method, listener) => listeners.set(method, listener), close: () => socket.close() };
}
