import assert from "node:assert/strict";
import { createTextBatcher } from "../src/lib/stream-batcher.ts";
import { getChatStorageError, loadChatState, readRawChatState, recoverChatState, saveChatState, withoutEmptyAssistantMessages } from "../src/lib/chat-store.ts";

const storage = new Map(); let failKey = "", writes = [], concurrentWrite = false;
globalThis.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => {
    if (key === failKey || (failKey === "record" && key.includes('.conversation.'))) throw new Error("quota");
    storage.set(key, value); writes.push(key);
    if (concurrentWrite && key.includes('.conversation.')) { concurrentWrite = false; storage.set("modelport.chat.v2", "other-window"); }
  },
  removeItem: key => storage.delete(key), key: index => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
} };
const key = "modelport.chat.v2", legacy = "modelport.chat.v1";
const model = { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O" };
const conversation = { id: "chat", title: "分会话保护", date: "10/10", model,
  messages: [{ id: "a", role: "assistant", content: "原文" }] };
const original = { conversations: [conversation], activeConversationId: "chat" };
const legacyRaw = JSON.stringify(original);
storage.set(legacy, legacyRaw); const loaded = loadChatState();
assert.equal(storage.get(legacy), legacyRaw, "Read-only load must not migrate data");
failKey = key;
assert.throws(() => saveChatState(loaded), /quota/); assert.equal(storage.get(legacy), legacyRaw); assert.equal(storage.size, 1);
failKey = ""; saveChatState(loaded); assert.equal(storage.get(legacy), undefined);
const originalIndex = storage.get(key), originalRecord = JSON.parse(originalIndex).conversations[0].key;
const update = { ...loaded, conversations: [{ ...loaded.conversations[0], messages: [{ ...conversation.messages[0], content: "新文" }] }] };
for (const failed of [key, "record"]) {
  failKey = failed; assert.throws(() => saveChatState(update), /quota/); failKey = "";
  assert.equal(storage.get(key), originalIndex); assert.equal(JSON.parse(storage.get(originalRecord)).messages[0].content, "原文");
  assert.equal(storage.size, 2, "Failed staging must not consume storage permanently");
}
saveChatState(update); assert.equal(storage.size, 2); assert.equal(storage.get(originalRecord), undefined);
const currentKey = JSON.parse(storage.get(key)).conversations[0].key;
storage.set(currentKey, '{"messages":');
assert.ok(loadChatState().error); assert.throws(() => saveChatState(original), /暂停保存/);
const exported = JSON.parse(readRawChatState()); assert.equal(exported.records[currentKey], '{"messages":'); assert.equal(exported.index, storage.get(key));
const damagedIndex = storage.get(key); failKey = key; assert.throws(() => recoverChatState(original), /quota/); failKey = "";
assert.equal(storage.get(key), damagedIndex); assert.ok(getChatStorageError());
recoverChatState(original); assert.equal(getChatStorageError(), ""); assert.equal(loadChatState().conversations[0].messages[0].content, "原文");
storage.set(legacy, "unreadable-old-record");
assert.ok(loadChatState().error); assert.throws(() => saveChatState(original), /暂停保存/);
assert.equal(JSON.parse(readRawChatState()).legacy, "unreadable-old-record");
recoverChatState(original); loadChatState(); assert.equal(storage.get(legacy), undefined);
const previous = storage.get(key); concurrentWrite = true;
assert.throws(() => saveChatState(update), /其他窗口/); assert.equal(storage.get(key), "other-window"); assert.notEqual(storage.get(key), previous);
assert.ok(loadChatState().error); assert.throws(() => saveChatState(original), /暂停保存/);
recoverChatState({ conversations: [], activeConversationId: null }); assert.deepEqual(loadChatState(), { conversations: [], activeConversationId: null });
assert.equal(withoutEmptyAssistantMessages([conversation])[0], conversation, "Unchanged conversations must keep object identity");
const emptyAssistant = { ...conversation, messages: [{ id: "pending", role: "assistant", content: "" }] };
assert.equal(withoutEmptyAssistantMessages([emptyAssistant])[0].messages.length, 0);

const batches = [], batcher = createTextBatcher(text => batches.push(text));
for (let i = 0; i < 500; i++) batcher.push("字");
assert.equal(batches.length, 0); batcher.flush(); assert.deepEqual(batches, ["字".repeat(500)]);
batcher.push("尾字"); await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(batches.at(-1), "尾字");
batcher.push("不得延迟显示"); batcher.cancel(); await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(batches.length, 2);
console.log("PASS: copy-on-write commits, safe legacy migration, quota/corrupt-record/concurrent-change protection, identity preservation and lossless stream batching");
