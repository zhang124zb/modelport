// Synthetic in-memory storage only; never reads real user chats.
import assert from "node:assert/strict";
import { loadChatState, parseChatBackup, readRawChatState, recoverChatState, saveChatState } from "../src/lib/chat-store.ts";

const key = "modelport.chat.v1", storage = new Map();
let failRead = false, failWrite = false;
globalThis.window = { localStorage: {
  getItem: name => { if (failRead) throw new Error("SecurityError"); return storage.get(name) ?? null; },
  setItem: (name, value) => { if (failWrite) throw new Error("QuotaExceededError"); storage.set(name, value); },
  removeItem: name => storage.delete(name),
  key: index => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
} };
const empty = { conversations: [], activeConversationId: null };
const conversation = { id: "chat", title: "恢复测试", date: "10/10",
  model: { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O" },
  messages: [{ id: "user", role: "user", content: "必须保留" }] };
const valid = { conversations: [conversation], activeConversationId: "chat" };

assert.deepEqual(loadChatState(), empty);
saveChatState(valid);
assert.equal(loadChatState().conversations[0].messages[0].content, "必须保留");
for (const raw of ["", '{"conversations":', "null", "{}", '{"conversations":{}}',
  JSON.stringify({ ...valid, conversations: [{ ...conversation, messages: [{ role: "system", content: "bad" }] }] }),
  JSON.stringify({ ...valid, conversations: [conversation, { id: "damaged" }] })]) {
  storage.delete("modelport.chat.v2");
  storage.set(key, raw);
  const loaded = loadChatState();
  assert.ok(loaded.error);
  assert.equal(readRawChatState(), raw, "Raw export must preserve every original character");
  assert.throws(() => saveChatState(empty), /暂停保存/);
  assert.throws(() => recoverChatState({ ...empty, conversations: [{}] }), /恢复数据无效/);
  assert.throws(() => recoverChatState({ ...valid, activeConversationId: "missing" }), /恢复数据无效/);
  assert.throws(() => parseChatBackup(raw));
  assert.equal(storage.get(key), raw, "Invalid read/import/reset must never overwrite original data");
  if (raw.includes("damaged")) assert.equal(loaded.conversations.length, 1, "Readable conversations remain available");
  failWrite = true;
  assert.throws(() => recoverChatState(valid), /QuotaExceededError/);
  failWrite = false;
  assert.throws(() => saveChatState(empty), /暂停保存/, "A failed recovery must not clear protection");
  assert.equal(storage.get(key), raw);
  recoverChatState(valid);
  assert.equal(loadChatState().error, undefined);
  saveChatState(valid);
}
storage.delete("modelport.chat.v2"); storage.set(key, "broken"); failRead = true;
assert.ok(loadChatState().error);
assert.throws(readRawChatState, /SecurityError/);
assert.throws(() => saveChatState(empty), /暂停保存/);
failRead = false;
assert.equal(storage.get(key), "broken");
recoverChatState(empty);
assert.deepEqual(loadChatState(), empty);
saveChatState(valid);
// Damaged optional tool metadata still preserves readable message text.
storage.delete("modelport.chat.v2"); storage.set(key, JSON.stringify({ ...valid, conversations: [{ ...conversation,
  messages: [{ id: "assistant", role: "assistant", content: "保留正文", toolRounds: "invalid" }] }] }));
const optional = loadChatState();
assert.equal(optional.error, undefined);
assert.equal(optional.conversations[0].messages[0].content, "保留正文");
assert.equal(optional.conversations[0].messages[0].status, "interrupted");
console.log("PASS: first run, damaged/partial/unreadable chats, exact raw export, blocked writes, invalid/failed recovery and explicit reset");
