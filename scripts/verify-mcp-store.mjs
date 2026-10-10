// Pure persistence/history boundaries; never connects or executes tools.
import assert from "node:assert/strict";
import { normalizeMcpSelections, normalizeToolRounds, normalizeToolTrace } from "../src/lib/mcp-history.ts";
import { buildRequestHistory } from "../src/lib/chat-settings.ts";
import { loadChatState, saveChatState, serializeChatBackup, parseChatBackup, mergeImportedChats } from "../src/lib/chat-store.ts";
const storage = new Map();
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const selection = { id: "00000000-0000-4000-8000-000000000001", revision: "a".repeat(64) };
const name = "mcp_" + "b".repeat(32);
const round = { content: "正在查询。", toolCalls: [{ id: "call-1", name, arguments: { query: "hello" } }], toolResults: [{ id: "call-1", name, content: "查询结果", status: "completed" }], reasoningContent: "中间字段" };
assert.deepEqual(normalizeMcpSelections([selection]), [selection]);
for (const invalid of [[selection, selection], [{ ...selection, id: "../../credentials" }], [{ ...selection, revision: "wrong" }], Array(4).fill(selection), null]) assert.throws(() => normalizeMcpSelections(invalid));
assert.deepEqual(normalizeToolRounds([round]), [round]);
for (const invalid of [null, [{ ...round, toolResults: [] }], [{ ...round, toolResults: [{ ...round.toolResults[0], id: "other" }] }], [{ ...round, toolCalls: [{ ...round.toolCalls[0], arguments: "shell" }] }], [{ ...round, toolCalls: [{ ...round.toolCalls[0], name: "run_anything" }] }], [{ ...round, toolCalls: [round.toolCalls[0], round.toolCalls[0]], toolResults: [round.toolResults[0], round.toolResults[0]] }]]) assert.throws(() => normalizeToolRounds(invalid));
assert.equal(normalizeToolRounds([round, round]).length, 2, "IDs in already-completed distinct rounds are not approval IDs");
const trace = { approvalId: "approval-1", serverName: "测试服务", toolName: "search", status: "running", summary: "操作结果未知" };
assert.equal(normalizeToolTrace([trace])[0].status, "interrupted");
const model = { provider: "ollama", id: "fixture", name: "fixture", label: "O", tone: "#333" };
const conversation = { id: "mcp-store-test", title: "test", date: "10/09", model, mcp: [selection], messages: [
  { id: "q", role: "user", content: "查询" },
  { id: "a", role: "assistant", content: "正在查询。答复", toolRounds: [round], toolTrace: [trace], reasoningContent: "最终字段", mcpModel: { provider: model.provider, id: model.id } },
] };
saveChatState({ conversations: [conversation], activeConversationId: conversation.id });
const restored = loadChatState().conversations[0];
assert.deepEqual(restored.mcp, [selection]); assert.deepEqual(restored.messages[1].toolRounds, [round]);
assert.equal(restored.messages[1].toolTrace[0].status, "interrupted");
assert.equal(restored.messages[1].reasoningContent, "最终字段");
const backup = serializeChatBackup({ conversations: [conversation], activeConversationId: conversation.id });
const imported = parseChatBackup(backup)[0];
assert.equal(imported.mcp, undefined); assert.deepEqual(imported.messages[1].toolRounds, [round]);
assert.equal(mergeImportedChats([], [conversation])[0].mcp, undefined);
const malicious = JSON.parse(backup); malicious.conversations[0].messages[1].toolRounds[0].toolResults[0].id = "unpaired";
assert.throws(() => parseChatBackup(JSON.stringify(malicious)));
storage.set("modelport.chat.v1", JSON.stringify({ conversations: malicious.conversations, activeConversationId: conversation.id }));
const recovered = loadChatState().conversations[0];
assert.equal(recovered.messages[1].content, conversation.messages[1].content, "damaged optional tool data must not erase chat text");
assert.equal(recovered.messages[1].status, "interrupted"); assert.equal(recovered.messages[1].toolRounds, undefined);
const largeRounds = Array.from({ length: 5 }, (_, index) => ({ ...round, content: "n".repeat(60000),
  toolCalls: [{ ...round.toolCalls[0], id: `large-${index}` }], toolResults: [{ ...round.toolResults[0], id: `large-${index}`, content: "r".repeat(60000) }] }));
assert.equal(normalizeToolRounds(largeRounds).length, 5);
assert.equal(normalizeToolTrace([{ ...trace, serverName: "😀".repeat(60) }])[0].serverName, "😀".repeat(60));
const history = buildRequestHistory(conversation.messages, "下一问", 1);
assert.deepEqual(history[1].toolRounds, [round]); assert.equal(history[1].reasoningContent, "最终字段");
assert.deepEqual(buildRequestHistory(conversation.messages, "新话题", 0), [{ role: "user", content: "新话题" }]);
const notes = Array.from({ length: 98 }, (_, i) => ({ role: "user", content: `note${i}`, savedOnly: true }));
const trimmed = buildRequestHistory([...conversation.messages, ...notes], "now", 40);
assert.ok(trimmed.length <= 100); assert.ok(!trimmed.some(turn => turn.role === "assistant"), "never trim away the user of a complete tool round");
console.log("PASS: MCP selection bounds, paired inert tool history, interrupted state, backup removes service permissions, malformed import rejection and complete-round trimming");
