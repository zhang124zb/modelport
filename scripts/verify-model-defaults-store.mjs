// Node.js 24; no native services, credentials or user data.
import assert from "node:assert/strict";
import { defaultModelSettings, loadModelDefaults, resolveDefaultModel, saveModelDefaults, validateModelDefaults } from "../src/lib/model-defaults.ts";
const storage = new Map(); let fail = false;
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error("quota"); storage.set(key, value); } } };
const key = "modelport.preferences.models.v1";
assert.deepEqual(loadModelDefaults(), { settings: defaultModelSettings, error: "" }); assert.equal(storage.size, 0);
assert.deepEqual(validateModelDefaults({}), defaultModelSettings);
for (const provider of ["ollama", "openai", "deepseek"]) {
  const settings = { chatModel: { provider, id: "model:variant" } }; saveModelDefaults(settings); assert.deepEqual(loadModelDefaults().settings, settings);
}
assert.deepEqual(validateModelDefaults({ chatModel: { provider: "openai", id: "gpt-4.1", apiKey: "not stored" }, extra: true }), { chatModel: { provider: "openai", id: "gpt-4.1" } });
for (const value of [null, [], { chatModel: [] }, { chatModel: "automatic" }, { chatModel: { provider: "other", id: "model" } },
  { chatModel: { provider: "ollama", id: "" } }, { chatModel: { provider: "openai", id: " " } }, { chatModel: { provider: "ollama", id: "x".repeat(241) } }, { chatModel: { provider: "openai", id: "bad\nmodel" } }]) assert.throws(() => validateModelDefaults(value));
storage.set(key, "broken"); assert.ok(loadModelDefaults().error); assert.equal(storage.get(key), "broken");
fail = true; assert.throws(() => saveModelDefaults(defaultModelSettings), /尚未生效/); assert.equal(storage.get(key), "broken"); fail = false;
const choices = [{ provider: "openai", id: "gpt-4.1" }, { provider: "ollama", id: "" }, { provider: "ollama", id: "first:local" }, { provider: "ollama", id: "second:local" }];
assert.deepEqual(resolveDefaultModel(defaultModelSettings, choices), choices[2]); assert.deepEqual(resolveDefaultModel(defaultModelSettings, []), { provider: "ollama", id: "" });
for (const chatModel of [{ provider: "ollama", id: "second:local" }, { provider: "openai", id: "gpt-4.1" }, { provider: "deepseek", id: "not-currently-listed" }]) assert.deepEqual(resolveDefaultModel({ chatModel }, choices), chatModel);
console.log("PASS: default model persistence, missing-field compatibility, strict provider/ID validation, failed-save protection and explicit choices never fall back to another provider");
