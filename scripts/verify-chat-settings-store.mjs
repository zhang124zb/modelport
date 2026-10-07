// Node.js 24 can run the small TypeScript settings module without adding a test dependency.
import assert from "node:assert/strict";
import { buildRequestHistory, defaultChatSettings, loadChatSettings, saveChatSettings, shouldSendOnKey, validateChatSettings } from "../src/lib/chat-settings.ts";
import { adjacentConversationId, getAppShortcut, matchesSaveOnlyShortcut } from "../src/lib/keyboard-shortcuts.ts";
import { loadChatState, saveChatState } from "../src/lib/chat-store.ts";

const storage = new Map();
const key = "modelport.preferences.chat.v1";
let quotaFailure = false;
globalThis.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (quotaFailure) throw new Error("quota"); storage.set(key, value); },
} };
assert.deepEqual(loadChatSettings(), { settings: defaultChatSettings, error: "" });
const changed = { ...defaultChatSettings, contextTurns: 0, fontSize: 24, systemPrompt: "默认中文回答\n简洁。", sendShortcut: "ctrl-enter", sendWithoutReplyShortcut: "none", renderMarkdown: false };
saveChatSettings(changed); assert.deepEqual(loadChatSettings().settings, changed);
storage.set(key, "broken"); assert.ok(loadChatSettings().error); assert.equal(storage.get(key), "broken");
storage.set(key, JSON.stringify({ fontSize: 18, unknown: "not retained" }));
assert.deepEqual(loadChatSettings().settings, { ...defaultChatSettings, fontSize: 18 });
assert.equal(validateChatSettings({ sendShortcut: "ctrl-enter" }).sendWithoutReplyShortcut, "none");
for (const invalid of [null, [], { contextTurns: null }, { systemPrompt: null }, { contextTurns: -1 }, { contextTurns: 41 }, { contextTurns: 1.5 }, { fontSize: 25 }, { fontSize: "18" }, { renderMarkdown: "false" }, { sendShortcut: "shift" }, { sendWithoutReplyShortcut: "enter" }, { sendShortcut: "ctrl-enter", sendWithoutReplyShortcut: "ctrl-enter" }, { systemPrompt: "x".repeat(4001) }, { systemPrompt: "\0" }]) {
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

const note = { role: "user", content: "local note", savedOnly: true };
const topic = { role: "user", content: "fresh topic", topicStart: true, savedOnly: true };
assert.deepEqual(buildRequestHistory([...history.slice(-2), note], "now", 1), [...history.slice(-2), { role: "user", content: note.content }, { role: "user", content: "now" }]);
assert.deepEqual(buildRequestHistory([...history, note, topic], "now", 20), [{ role: "user", content: "fresh topic" }, { role: "user", content: "now" }]);
assert.deepEqual(buildRequestHistory([note, topic], "now", 0), [{ role: "user", content: "now" }]);
assert.deepEqual(buildRequestHistory([...history, { ...topic, savedOnly: undefined, status: "failed" }], "now", 20), [{ role: "user", content: "now" }]);
assert.deepEqual(buildRequestHistory([note, ...history.slice(-2)], "now", 1), [{ role: "user", content: "local note" }, ...history.slice(-2), { role: "user", content: "now" }]);
assert.ok(buildRequestHistory(Array.from({ length: 120 }, () => note), "now", 40).length <= 100);
console.log("PASS: saved-only notes, new-topic boundaries and the native 100-message cap");

const keyEvent = { ...event, repeat: false, ctrlKey: true };
assert.equal(getAppShortcut({ ...keyEvent, key: "n" }), "new-chat");
assert.equal(getAppShortcut({ ...keyEvent, key: "N", shiftKey: true }), "new-topic");
assert.equal(getAppShortcut({ ...keyEvent, key: "Tab" }), "next-chat");
assert.equal(getAppShortcut({ ...keyEvent, key: "Tab", shiftKey: true }), "previous-chat");
assert.equal(getAppShortcut({ ...keyEvent, key: "k" }), "toggle-search");
assert.equal(getAppShortcut({ ...keyEvent, key: "9" }), 8);
for (const override of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { ctrlKey: false }, { key: "0" }]) assert.equal(getAppShortcut({ ...keyEvent, key: "n", ...override }), undefined);
assert.ok(matchesSaveOnlyShortcut(keyEvent, "ctrl-enter"));
assert.ok(matchesSaveOnlyShortcut({ ...event, repeat: false, altKey: true }, "alt-enter"));
for (const override of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }, { altKey: true }]) assert.ok(!matchesSaveOnlyShortcut({ ...keyEvent, ...override }, "ctrl-enter"));
assert.ok(!matchesSaveOnlyShortcut(keyEvent, "none"));
const list = [{ id: "first" }, { id: "second" }, { id: "last" }];
assert.equal(adjacentConversationId(list, null, 1), "first"); assert.equal(adjacentConversationId(list, null, -1), "last");
assert.equal(adjacentConversationId(list, "last", 1), "first"); assert.equal(adjacentConversationId(list, "first", -1), "last");
assert.equal(adjacentConversationId([], null, 1), undefined);
console.log("PASS: fixed shortcut mappings, modifier/IME guards, save-only bindings and wrapped navigation");

const chat = { id: "flags", title: "Flags", date: "10/07", model: { id: "offline", name: "Offline", provider: "ollama", label: "O", tone: "#333" }, newTopicPending: true,
  messages: [{ id: "user", ...topic }, { id: "assistant", role: "assistant", content: "reply", savedOnly: true, topicStart: true }] };
saveChatState({ conversations: [chat], activeConversationId: chat.id });
const restored = loadChatState().conversations[0];
assert.ok(restored.newTopicPending); assert.ok(restored.messages[0].savedOnly); assert.ok(restored.messages[0].topicStart);
assert.equal(restored.messages[1].savedOnly, undefined); assert.equal(restored.messages[1].topicStart, undefined);
console.log("PASS: saved-only/topic flags persist and are rejected for assistant messages");
