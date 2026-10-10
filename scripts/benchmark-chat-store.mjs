// Deterministic synthetic records; byte/write counts matter more than wall-clock timings.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { loadChatState, saveChatState } from "../src/lib/chat-store.ts";

const storage = new Map(); let writes = 0, bytes = 0, recordWrites = 0;
globalThis.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { writes++; bytes += Buffer.byteLength(value); if (key.includes('.conversation.')) recordWrites++; storage.set(key, value); },
  removeItem: key => storage.delete(key), key: index => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
} };
const model = { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O" };
function fixture() { return Array.from({ length: 40 }, (_,i) => ({ id: `c${i}`, title: `fixture${i}`, date: "10/10", model,
  messages: Array.from({ length: i === 0 ? 1000 : 100 }, (_,j) => ({ id: `m${i}-${j}`, role: j % 2 ? "assistant" : "user", content: "x".repeat(160) })) })); }
function measure(save) {
  let conversations = fixture(); save({ conversations, activeConversationId: "c0" });
  writes = bytes = recordWrites = 0;
  const start = performance.now();
  for (let i = 0; i < 50; i++) {
    conversations = [{ ...conversations[0], messages: conversations[0].messages.map((message,j) => j === 999 ? { ...message, content: message.content + "token" } : message) }, ...conversations.slice(1)];
    save({ conversations, activeConversationId: "c0" });
  }
  return { writes, recordWrites, serializedBytes: bytes, timeMs: +(performance.now() - start).toFixed(1) };
}
const before = measure(state => window.localStorage.setItem("modelport.chat.v1", JSON.stringify(state)));
storage.clear(); loadChatState();
const after = measure(saveChatState);
assert.equal(after.recordWrites, 50, "Each update must rewrite only the changed conversation");
assert.ok(after.serializedBytes < before.serializedBytes * 0.3);
assert.equal(storage.size, 41, "Old record versions must be removed after successful commits");
const restored = loadChatState();
assert.equal(restored.conversations.length, 40); assert.equal(restored.conversations[0].messages.length, 1000);
writes = 0; saveChatState(restored); assert.equal(writes, 0, "Unchanged state must not cause a write");
saveChatState({ ...restored, activeConversationId: "c1" }); assert.equal(writes, 1, "Navigation writes only the small index");
console.log(JSON.stringify({ sampleConversations: 40, sampleMessages: 4900, updates: 50, before, after,
  serializedReductionPercent: +(100 * (1 - after.serializedBytes / before.serializedBytes)).toFixed(1) }, null, 2));
