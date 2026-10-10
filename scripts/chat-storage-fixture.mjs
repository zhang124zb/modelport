// Read the actual v2 index/records; legacy fixtures still exercise migration.
// Mutation helpers are only for scripts that have verified an empty isolated profile.
export const chatStorageRawExpression = "(localStorage.getItem('modelport.chat.v2') ?? localStorage.getItem('modelport.chat.v1'))";
export const desktopChatStateExpression = `(() => {
  const raw = localStorage.getItem('modelport.chat.v2');
  if (raw === null) return JSON.parse(localStorage.getItem('modelport.chat.v1') ?? '{}');
  const index = JSON.parse(raw);
  if (index.format !== 'modelport-chat-store' || index.version !== 2 || !Array.isArray(index.conversations)) throw new Error('Invalid chat fixture index');
  return { activeConversationId: index.activeConversationId, conversations: index.conversations.map(entry => {
    const conversation = JSON.parse(localStorage.getItem(entry.key));
    if (!conversation || conversation.id !== entry.id) throw new Error('Missing chat fixture record');
    return conversation;
  }) };
})()`;

export function legacyChatSeedExpression(raw) {
  return `(() => {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) if (key === 'modelport.chat.v2' || key?.startsWith('modelport.chat.v2.conversation.')) localStorage.removeItem(key);
    ${raw === null ? "localStorage.removeItem('modelport.chat.v1');" : `localStorage.setItem('modelport.chat.v1', ${JSON.stringify(raw)});`}
  })()`;
}

export function restoreChatStorageExpression(raw) {
  if (raw !== null) {
    const parsed = JSON.parse(raw);
    if (parsed.format === 'modelport-chat-store' && parsed.version === 2) {
      if (parsed.conversations.length) throw new Error('Only empty isolated profiles may be reset by a fixture');
      return legacyChatSeedExpression(null) + `; localStorage.setItem('modelport.chat.v2', ${JSON.stringify(raw)})`;
    }
  }
  return legacyChatSeedExpression(raw);
}
