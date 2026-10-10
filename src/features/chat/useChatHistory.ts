import { useEffect, useRef, useState } from "react";
import { getChatStorageError, loadChatState, recoverChatState, saveChatState, withoutEmptyAssistantMessages } from "@/lib/chat-store";
import type { ChatState } from "@/lib/chat-store";
import { errorMessage, isDesktop } from "@/lib/modelport";

export function useChatHistory(startup: "last-conversation" | "new-chat", replyingId: string | null) {
  const [initialChatState] = useState(() => {
    const state = loadChatState();
    return { ...state, activeConversationId: startup === "new-chat" ? null : state.activeConversationId,
      conversations: withoutEmptyAssistantMessages(state.conversations) };
  });
  const [conversations, setConversations] = useState(initialChatState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(initialChatState.activeConversationId);
  const [storageError, setStorageError] = useState("");
  const [chatRecoveryError, setChatRecoveryError] = useState(initialChatState.error ?? "");
  const pendingSaveRef = useRef({ conversations, activeConversationId });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousReplyingId = useRef<string | null>(null);

  useEffect(() => {
    pendingSaveRef.current = { conversations, activeConversationId };
    const justStarted = replyingId !== null && previousReplyingId.current !== replyingId;
    previousReplyingId.current = replyingId;
    if (!isDesktop || chatRecoveryError) return;
    const persist = () => {
      saveTimerRef.current = null;
      try {
        saveChatState({ ...pendingSaveRef.current, conversations: withoutEmptyAssistantMessages(pendingSaveRef.current.conversations) });
        setStorageError("");
      } catch (error) {
        setStorageError(`聊天尚未保存：${errorMessage(error)}。请检查存储空间或权限。`);
        setChatRecoveryError(getChatStorageError());
      }
    };
    if (replyingId === null || justStarted) {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      persist();
    } else if (saveTimerRef.current === null) saveTimerRef.current = setTimeout(persist, 400);
  }, [conversations, activeConversationId, replyingId, chatRecoveryError]);

  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current === null) return;
      clearTimeout(saveTimerRef.current); saveTimerRef.current = null;
      try { saveChatState({ ...pendingSaveRef.current, conversations: withoutEmptyAssistantMessages(pendingSaveRef.current.conversations) }); }
      catch { /* Mounted saves show the warning; protected data is never overwritten. */ }
    };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  const storeManagedChats = (state: ChatState) => {
    try {
      if (chatRecoveryError) recoverChatState(state);
      else saveChatState(state);
    } catch { throw new Error("无法保存聊天数据，请检查存储空间或权限；现有会话和原始记录尚未改变。"); }
    if (saveTimerRef.current !== null) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    pendingSaveRef.current = state;
    setConversations(state.conversations); setActiveConversationId(state.activeConversationId);
    setStorageError(""); setChatRecoveryError("");
  };
  return { initialChatState, conversations, setConversations, activeConversationId, setActiveConversationId,
    storageError, chatRecoveryError, storeManagedChats };
}
