import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
for (const name of ["ai", "class-variance-authority", "lucide-react", "radix-ui"]) {
  assert.equal(pkg.dependencies[name], undefined, `Unused direct dependency ${name} must stay removed`);
  assert.equal(lock.packages[""].dependencies[name], undefined);
}
for (const file of ["button", "button-group", "separator", "tooltip"]) assert.equal(existsSync(new URL(`src/components/ui/${file}.tsx`, root)), false);
const renderer = read("src/components/ai-elements/message.tsx");
assert.ok(renderer.includes("SPDX-License-Identifier: Apache-2.0") && renderer.includes("MessageResponse"));
assert.doesNotMatch(renderer, /MessageBranch|MessageToolbar|MessageActions|components\/ui\//);
for (const plugin of ["cjk", "code", "math", "mermaid"]) assert.ok(renderer.includes(plugin));
assert.equal(lock.version, pkg.version); assert.equal(lock.packages[""].version, pkg.version);
assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, pkg.version);
assert.equal(read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)[1], pkg.version);
assert.equal(read("src-tauri/Cargo.lock").match(/name = "modelport"\s+version = "([^"]+)"/)[1], pkg.version);
assert.ok(read("src/App.tsx").includes(`关于（${pkg.version}）`));
assert.ok(read("scripts/test-desktop.ps1").includes("WEBVIEW2_USER_DATA_FOLDER"));
assert.ok(read("scripts/test-desktop.ps1").includes("--remote-debugging-address=127.0.0.1"));
assert.ok(read("scripts/package-portable.ps1").includes("verify-portable-package.ps1"));
console.log("PASS: unused exports/declarations stay removed, Markdown plugins/licenses remain, versions align and regression/package safety entry points exist");
