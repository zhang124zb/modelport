// Pure data checks; no native services, credentials or user data.
import assert from "node:assert/strict";
import { defaultProviderConfigs, isCustomProvider, isProviderId, endpointPreview, providerInfo } from "../src/lib/providers.ts";
import { loadChatState, saveChatState, serializeChatBackup, parseChatBackup } from "../src/lib/chat-store.ts";
import { validateModelDefaults, resolveDefaultModel } from "../src/lib/model-defaults.ts";
const storage = new Map();
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const custom = "custom-00000000-0000-4000-8000-000000000001";
assert.equal(defaultProviderConfigs.length, 7);
assert.equal(endpointPreview({ baseUrl: "https://test.example/v1/", chatPath: "/chat/completions" }), "https://test.example/v1/chat/completions");
for (const id of [...defaultProviderConfigs.map(config => config.id), custom]) {
  assert.ok(isProviderId(id));
  const settings = validateModelDefaults({ chatModel: { provider: id, id: "test-model" } });
  assert.equal(resolveDefaultModel(settings, []).provider, id);
  const conversation = { id: `chat-${id}`, title: "test", date: "10/08", model: { provider: id, id: "test-model", name: "test", label: "T", tone: "#000" }, messages: [{ id: "msg", role: "user", content: "hello" }] };
  const state = { conversations: [conversation], activeConversationId: conversation.id };
  saveChatState(state); assert.equal(loadChatState().conversations[0].model.provider, id);
  assert.equal(parseChatBackup(serializeChatBackup(state))[0].model.provider, id);
}
for (const id of ["custom-bad", "custom-../../secret", "other", null]) { assert.equal(isProviderId(id), false); assert.throws(() => validateModelDefaults({ chatModel: { provider: id, id: "test-model" } })); }
assert.ok(isCustomProvider(custom));
assert.equal(providerInfo(custom, [{ id: custom, name: "Local studio" }]).name, "Local studio");
console.log("PASS: all seven built-ins and custom IDs survive defaults, chat persistence and backup; invalid providers rejected; endpoint joining and custom labels correct");
