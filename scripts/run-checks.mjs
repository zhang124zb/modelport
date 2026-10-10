// Only deterministic local data checks; no desktop, model services or credentials.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [
  "verify-maintenance.mjs",
  "verify-chat-settings-store.mjs",
  "verify-general-settings-store.mjs",
  "verify-chat-recovery-store.mjs",
  "verify-chat-performance-store.mjs",
  "benchmark-chat-store.mjs",
  "verify-code-highlighter.mjs",
  "verify-model-defaults-store.mjs",
  "verify-providers-store.mjs",
  "verify-attachments-store.mjs",
  "verify-mcp-store.mjs",
  "verify-mcp-ui.mjs",
  "check-repository.test.mjs",
];
for (const check of checks) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts", check)], { cwd: root, stdio: "inherit" });
  if (result.error) { console.error(`无法启动检查 ${check}。`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS: ${checks.length} local check scripts (no cloud requests or user data).`);
