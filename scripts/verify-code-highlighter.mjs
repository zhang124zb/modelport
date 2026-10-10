// Real installed Shiki; no cloud requests or user data.
import assert from "node:assert/strict";
import { code } from "../src/lib/code-highlighter.ts";

function highlight(source, language = "js") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Highlighter callback timed out")), 10000);
    const immediate = code.highlight({ code: source, language, themes: code.getThemes() }, result => {
      clearTimeout(timer); resolve(result);
    });
    if (immediate) { clearTimeout(timer); resolve(immediate); }
  });
}
const text = result => result.tokens.map(line => line.map(token => token.content).join("")).join("\n");
const prefix = "// " + "p".repeat(110) + "\n", suffix = "\n// " + "s".repeat(110);
const first = prefix + 'const auditValue = "A";' + suffix;
const second = prefix + 'const auditValue = "B";' + suffix;
assert.equal(first.length, second.length);
assert.equal(first.slice(0, 100), second.slice(0, 100));
assert.equal(first.slice(-100), second.slice(-100));
assert.equal(text(await highlight(first)), first);
const result = await highlight(second);
assert.equal(text(result), second, "Same prefix/suffix/length must never return another block's middle");
assert.ok(result.tokens.some(line => line.some(token => token.htmlStyle?.color)), "Syntax colors must remain");
const concurrent = await Promise.all([first, second, first, second].map(source => highlight(source)));
assert.deepEqual(concurrent.map(text), [first, second, first, second]);
assert.equal(text(await highlight("中文原文 <script> & untouched", "not-a-language")), "中文原文 <script> & untouched");
assert.ok(code.supportsLanguage("JS") && code.supportsLanguage("typescript"));
assert.ok(!code.supportsLanguage("not-a-language"));
assert.deepEqual(code.getThemes(), ["github-light", "github-dark"]);
console.log("PASS: formerly colliding code blocks, concurrent updates, original unknown-language text, aliases and syntax colors");
