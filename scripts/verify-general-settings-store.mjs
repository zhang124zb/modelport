// Node.js 24, no dependencies or real user data.
import assert from "node:assert/strict";
import { defaultGeneralSettings, loadGeneralSettings, resolveTheme, saveGeneralSettings, validateGeneralSettings } from "../src/lib/general-settings.ts";
import { maxChatBackupBytes, mergeImportedChats, parseChatBackup, serializeChatBackup } from "../src/lib/chat-store.ts";
const storage = new Map(); let fail = false;
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error("quota"); storage.set(key, value); } } };
const key = "modelport.preferences.general.v1";
assert.deepEqual(loadGeneralSettings(), { settings: defaultGeneralSettings, error: "" }); assert.equal(storage.size, 0);
const settings = { theme: "system", animations: false, startup: "new-chat", sidebar: "collapsed" };
saveGeneralSettings(settings); assert.deepEqual(loadGeneralSettings().settings, settings);
assert.deepEqual(validateGeneralSettings({ theme: "dark", ignored: "secret" }), { ...defaultGeneralSettings, theme: "dark" });
for (const value of [null, [], { theme: null }, { theme: "auto" }, { startup: "minimized" }, { animations: "false" }, { sidebar: true }]) assert.throws(() => validateGeneralSettings(value));
storage.set(key, "broken"); assert.ok(loadGeneralSettings().error); assert.equal(storage.get(key), "broken");
fail = true; assert.throws(() => saveGeneralSettings(settings), /尚未生效/); assert.equal(storage.get(key), "broken"); fail = false;
assert.equal(resolveTheme("system", true), "dark"); assert.equal(resolveTheme("system", false), "light"); assert.equal(resolveTheme("light", true), "light"); assert.equal(resolveTheme("dark", false), "dark");
console.log("PASS: general settings defaults, schema, persistence, corrupt-data/failed-save protection and system theme resolution");

const revision = "a".repeat(64);
const conversation = { id: "chat", title: "中文备份", date: "10/07", apiKey: "SECRET_MUST_NOT_EXPORT", model: { id: "offline", name: "Offline", provider: "ollama", tone: "#111827", label: "O", apiKey: "SECRET_MUST_NOT_EXPORT" }, newTopicPending: true,
  skill: { id: "skill", name: "Skill", revision }, knowledge: { id: "knowledge", name: "Knowledge", revision },
  messages: [{ id: "user", role: "user", content: "<script>literal only</script>", savedOnly: true, topicStart: true },
    { id: "assistant", role: "assistant", content: "partial", status: "streaming", apiKey: "SECRET_MUST_NOT_EXPORT", retrieval: { base: { id: "knowledge", name: "Knowledge", revision }, sources: [] } }] };
const exported = serializeChatBackup({ conversations: [conversation], activeConversationId: conversation.id });
assert.ok(!exported.includes("SECRET_MUST_NOT_EXPORT"));
const parsed = parseChatBackup("\uFEFF" + exported); assert.equal(parsed[0].messages[1].status, "interrupted");
assert.ok(parsed[0].newTopicPending && parsed[0].messages[0].topicStart && parsed[0].messages[0].savedOnly);
assert.equal(parsed[0].messages[0].content, "<script>literal only</script>"); assert.equal(parsed[0].messages[1].retrieval.base.id, "knowledge");
const merged = mergeImportedChats([conversation], parsed); assert.equal(merged.length, 2); assert.notEqual(merged[0].id, conversation.id); assert.notEqual(merged[0].messages[0].id, conversation.messages[0].id);
assert.equal(merged[1], conversation); assert.equal(merged[0].title, conversation.title);
const copies = mergeImportedChats(merged, parsed); assert.equal(new Set(copies.map(chat => chat.id)).size, 3);
for (const mutate of [backup => { backup.version = 2; }, backup => { backup.format = "other"; }, backup => { backup.conversations[0].model.provider = "untrusted"; },
  backup => { backup.conversations[0].messages[0].role = "system"; }, backup => { backup.conversations[0].messages[0].status = "unexpected"; },
  backup => { backup.conversations.push(backup.conversations[0]); }, backup => { backup.conversations[0].messages.push(backup.conversations[0].messages[0]); },
  backup => { backup.conversations[0].messages[0].content = "x".repeat(200001); }, backup => { backup.conversations[0].model.tone = "url(https://example.com)"; }]) {
  const backup = JSON.parse(exported); mutate(backup); assert.throws(() => parseChatBackup(JSON.stringify(backup)));
}
assert.throws(() => parseChatBackup("broken")); assert.throws(() => parseChatBackup("x".repeat(maxChatBackupBytes + 1)));
assert.throws(() => parseChatBackup(JSON.stringify({ format: "modelport-chat-backup", version: 1, conversations: Array.from({ length: 5001 }, (_, i) => ({ ...conversation, id: String(i) })) })));
console.log("PASS: versioned backups, literal content/source preservation, secret stripping, safe copy merging and bounded import validation");
