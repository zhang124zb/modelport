import assert from "node:assert/strict";
import { pathProblem, scanText, inspectRepository } from "./check-repository.mjs";

for (const path of ["src/App.tsx", "LICENSE", "package-lock.json", "src-tauri/Cargo.lock", ".env.example", "ui-current.png"]) assert.equal(pathProblem(path), "");
for (const path of [".env", ".env.production", "nested/private.key", "release/ModelPort.exe", "src-tauri/target/debug/app", "node_modules/react/package.json", "ModelPort-chats-2026.json", "user-data/chat.json", "credentials.json"]) assert.ok(pathProblem(path), path);
const synthetic = "gh" + "p_" + "a".repeat(36);
const findings = scanText("fixture.txt", `safe\n${synthetic}\n`);
assert.equal(findings.length, 1); assert.ok(findings[0].includes("fixture.txt:2")); assert.ok(!findings[0].includes(synthetic));
assert.equal(scanText("fixture.png", Buffer.from([0, 1, 2, 3])).length, 0);
assert.equal(scanText("safe.ts", "const apiKey = userSuppliedValue;").length, 0);
assert.equal(scanText("private.txt", "-----BEGIN " + "RSA PRIVATE KEY-----").length, 1);
const googleKey = "AI" + "za" + "a".repeat(35);
const googleFindings = scanText("fixture.txt", googleKey);
assert.equal(googleFindings.length, 1); assert.ok(!googleFindings[0].includes(googleKey));
// The real scanner is read-only, and its returned diagnostics never include raw matches.
const result = inspectRepository(true);
assert.ok(result.candidateCount > 0); assert.ok(result.historyBlobs > 0);
console.log("PASS: upload path rules, source allowlist, redacted secret locations, binary handling and read-only source/history inspection");
