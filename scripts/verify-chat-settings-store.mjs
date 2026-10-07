// Node.js 24 can run the small TypeScript settings module without adding a test dependency.
import assert from "node:assert/strict";
import { buildRequestHistory, defaultChatSettings, loadChatSettings, saveChatSettings, shouldSendOnKey, validateChatSettings } from "../src/lib/chat-settings.ts";

const storage = new Map();
const key = "modelport.preferences.chat.v1";
let quotaFailure = false;
globalThis.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (quotaFailure) throw new Error("quota"); storage.set(key, value); },
} };
assert.deepEqual(loadChatSettings(), { settings: defaultChatSettings, error: "" });
const changed = { ...defaultChatSettings, contextTurns: 0, fontSize: 24, systemPrompt: "默认中文回答\n简洁。", sendShortcut: "ctrl-enter", renderMarkdown: false };
saveChatSettings(changed); assert.deepEqual(loadChatSettings().settings, changed);
storage.set(key, "broken"); assert.ok(loadChatSettings().error); assert.equal(storage.get(key), "broken");
storage.set(key, JSON.stringify({ fontSize: 18, unknown: "not retained" }));
assert.deepEqual(loadChatSettings().settings, { ...defaultChatSettings, fontSize: 18 });
for (const invalid of [null, [], { contextTurns: null }, { systemPrompt: null }, { contextTurns: -1 }, { contextTurns: 41 }, { contextTurns: 1.5 }, { fontSize: 25 }, { fontSize: "18" }, { renderMarkdown: "false" }, { sendShortcut: "shift" }, { systemPrompt: "x".repeat(4001) }, { systemPrompt: "\0" }]) {
  assert.throws(() => validateChatSettings(invalid));
}
const before = storage.get(key); quotaFailure = true;
assert.throws(() => saveChatSettings(changed), /尚未生效/); assert.equal(storage.get(key), before); quotaFailure = false;
console.log("PASS: settings persistence, migration defaults, corrupt-data preservation, validation and failed-save protection");

const event = { key: "Enter", keyCode: 13, isComposing: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
assert.ok(shouldSendOnKey(event, "enter")); assert.ok(!shouldSendOnKey(event, "ctrl-enter"));
assert.ok(shouldSendOnKey({ ...event, ctrlKey: true }, "ctrl-enter"));
assert.ok(shouldSendOnKey({ ...event, metaKey: true }, "ctrl-enter"));
assert.ok(!shouldSendOnKey({ ...event, ctrlKey: true }, "enter"));
for (const override of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { altKey: true }, { key: "a" }]) {
  for (const shortcut of ["enter", "ctrl-enter"]) assert.ok(!shouldSendOnKey({ ...event, ctrlKey: shortcut === "ctrl-enter", ...override }, shortcut));
}
console.log("PASS: both shortcuts, newline modifiers and Chinese IME composition never sends prematurely");

const history = Array.from({ length: 50 }, (_, i) => [{ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` }]).flat();
assert.deepEqual(buildRequestHistory(history, "now", 0), [{ role: "user", content: "now" }]);
assert.deepEqual(buildRequestHistory(history, "now", 1), [...history.slice(-2), { role: "user", content: "now" }]);
assert.equal(buildRequestHistory(history, "now", 40).length, 81);
assert.deepEqual(buildRequestHistory([
  { role: "assistant", content: "orphan" },
  ...history.slice(-2), { role: "user", content: "failed", status: "failed" },
  { role: "assistant", content: "partial", status: "stopped" },
  { role: "user", content: "unanswered" },
], "now", 40), [...history.slice(-2), { role: "user", content: "now" }]);
console.log("PASS: bounded complete rounds, zero-context questions and exclusion of partial/failed/orphaned history");
