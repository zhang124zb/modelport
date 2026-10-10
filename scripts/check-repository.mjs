// Read-only upload guard. Reports locations, never matched credential values.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const maxBlobBytes = 10 * 1024 * 1024; // Project policy, not GitHub's platform limit.
const maxHistoryBytes = 64 * 1024 * 1024;
const sensitivePath = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials\.json|secrets\.json)$|\.(?:key|pem|p12|pfx)$/i;
const generatedPath = /(?:^|\/)(?:node_modules|target|dist|dist-ssr|release|app-data|user-data|\.test-data)(?:\/|$)|\.(?:exe|dll|msi|msix|pdb|dmp|sqlite3?|db)(?:$|-)|(?:^|\/)modelport-chats-.*\.json$/i;
const secretRules = [
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["provider secret key", /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}\b/g],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ["npm access token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
];

export function pathProblem(path) {
  if (path === ".env.example") return "";
  if (sensitivePath.test(path)) return "sensitive filename";
  return generatedPath.test(path) ? "generated artifact or private runtime data" : "";
}

export function scanText(path, bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.includes(0)) return []; // Binary media is reviewed separately.
  const text = buffer.toString("utf8");
  const findings = [];
  for (const [kind, pattern] of secretRules) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${path}:${line}: ${kind} [value hidden]`);
      if (findings.length >= 50) return findings;
    }
  }
  return findings;
}

function git(args, input) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: root, input, maxBuffer: maxHistoryBytes });
}

export function inspectRepository(includeHistory = true) {
  const findings = [];
  const ignoredTracked = git(["ls-files", "-ci", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean);
  findings.push(...ignoredTracked.map(path => `${path}: tracked despite ignore rules; review before upload`));
  const candidates = [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean))];
  for (const path of candidates) {
    const problem = pathProblem(path);
    if (problem) { findings.push(`${path}: ${problem}`); continue; }
    const absolute = resolve(root, path);
    let stat;
    try { stat = statSync(absolute); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!stat.isFile()) continue;
    if (stat.size > maxBlobBytes) { findings.push(`${path}: exceeds the 10 MiB source-file policy`); continue; }
    findings.push(...scanText(path, readFileSync(absolute)));
  }

  let historyBlobs = 0;
  if (includeHistory) {
    const objects = git(["rev-list", "--objects", "--all"]).toString("utf8").trim().split("\n").filter(Boolean);
    if (objects.length > 10000) throw new Error("Git history is too large for this lightweight check; request a dedicated scan.");
    const names = new Map(objects.map(line => [line.slice(0, 40), line.slice(41) || "(historical object)"]));
    if (objects.length) {
      const metadata = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], objects.map(line => line.slice(0, 40)).join("\n") + "\n").toString("utf8").trim().split("\n");
      const readable = []; let total = 0;
      for (const line of metadata) {
        const [id, type, sizeText] = line.split(" "); const size = Number(sizeText);
        if (type !== "blob") continue;
        historyBlobs++;
        const path = names.get(id); const problem = pathProblem(path);
        if (problem) findings.push(`history ${id.slice(0, 12)} ${path}: ${problem}`);
        if (size > maxBlobBytes) { findings.push(`history ${id.slice(0, 12)} ${path}: exceeds the 10 MiB source-file policy`); continue; }
        total += size;
        if (total > maxHistoryBytes / 2) throw new Error("History exceeds the lightweight scan budget; no files were changed.");
        readable.push(id);
      }
      if (readable.length) {
        const payload = git(["cat-file", "--batch"], readable.join("\n") + "\n");
        let cursor = 0;
        for (const id of readable) {
          const end = payload.indexOf(10, cursor);
          const header = payload.subarray(cursor, end).toString("utf8").split(" ");
          const size = Number(header[2]);
          if (end < 0 || header[0] !== id || header[1] !== "blob" || !Number.isSafeInteger(size) || size < 0 || end + 1 + size >= payload.length) throw new Error("Git returned malformed object data.");
          const content = payload.subarray(end + 1, end + 1 + size);
          findings.push(...scanText(`history ${id.slice(0, 12)} ${names.get(id)}`, content));
          cursor = end + 1 + size + 1;
        }
      }
    }
  }
  return { findings: [...new Set(findings)], candidateCount: candidates.length, historyBlobs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = inspectRepository(!process.argv.includes("--current-only"));
    if (result.findings.length) {
      console.error(result.findings.join("\n")); process.exitCode = 1;
    } else {
      console.log(`PASS: ${result.candidateCount} candidate files and ${result.historyBlobs} history blobs; no known secret patterns or forbidden upload files found.`);
      console.log("This is a heuristic check, not a guarantee; review private content and screenshots before publishing.");
    }
  } catch {
    console.error("Repository check could not complete. No Git state or source files were changed."); process.exitCode = 1;
  }
}
