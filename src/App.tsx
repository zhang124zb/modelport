import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConnectionModal } from "@/components/ConnectionModal";
import type { ProviderSettingsProps } from "@/components/ConnectionModal";
import { Icon } from "@/components/Icon";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ConversationSearchDialog } from "@/components/ConversationSearchDialog";
import { AttachmentList, AttachmentMenu, AttachmentNotice } from "@/components/ChatAttachments";
import { McpApprovalDialog, McpToolTrace } from "@/components/McpApprovalDialog";
import { mcp } from "@/lib/mcp";
import type { McpApproval, McpEvent, McpServer } from "@/lib/mcp";
import type { McpSelection, ToolRound, ToolTrace } from "@/lib/mcp-history";
import type { AttachmentNoticeData } from "@/components/ChatAttachments";
import { attachmentIds, fileKind, maxAttachments, readAttachment } from "@/lib/attachments";
import type { Attachment } from "@/lib/attachments";
import {
  defaultModels,
  errorMessage,
  isDesktop,
  modelOption,
  modelport,
  providerInfo,
} from "@/lib/modelport";
import type { KnowledgeSummary, ModelOption, ProviderConfig, ProviderId, SelectedKnowledge, SelectedSkill, SkillSummary } from "@/lib/modelport";
import { defaultProviderConfigs, isCustomProvider } from "@/lib/providers";
import { KnowledgeSources } from "@/components/KnowledgeSources";
import type { SettingsSectionId } from "@/features/settings/sections";
import { loadChatState, mergeImportedChats, saveChatState, serializeChatBackup } from "@/lib/chat-store";
import type { ChatState, Conversation, Message } from "@/lib/chat-store";
import { buildRequestHistory, loadChatSettings, saveChatSettings, shouldSendOnKey } from "@/lib/chat-settings";
import { adjacentConversationId, getAppShortcut, matchesSaveOnlyShortcut } from "@/lib/keyboard-shortcuts";
import { loadGeneralSettings, resolveTheme, saveGeneralSettings } from "@/lib/general-settings";
import { loadModelDefaults, resolveDefaultModel, saveModelDefaults } from "@/lib/model-defaults";
import type { ModelDefaults } from "@/lib/model-defaults";
import "./App.css";
import "./theme.css";

const MessageResponse = lazy(() =>
  import("@/components/ai-elements/message").then((module) => ({ default: module.MessageResponse })),
);

type ActiveRequest = {
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
};

function withoutEmptyAssistantMessages(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.filter((message) => message.role !== "assistant" || message.content.length > 0 || message.toolTrace?.length || message.toolRounds?.length),
  }));
}

function pickDefaultModel(settings: ModelDefaults, choices: readonly ModelOption[]): ModelOption {
  const reference = resolveDefaultModel(settings, choices);
  return choices.find(model => model.provider === reference.provider && model.id === reference.id)
    ?? (reference.id ? modelOption(reference.provider, reference.id) : defaultModels[0]);
}

function App() {
  const [modelPreferences, setModelPreferences] = useState(loadModelDefaults);
  const [generalPreferences, setGeneralPreferences] = useState(loadGeneralSettings);
  const generalSettings = generalPreferences.settings;
  const [chatPreferences, setChatPreferences] = useState(loadChatSettings);
  const chatSettings = chatPreferences.settings;
  const [initialChatState] = useState(() => {
    const state = loadChatState();
    return { ...state, activeConversationId: generalSettings.startup === "new-chat" ? null : state.activeConversationId,
      conversations: withoutEmptyAssistantMessages(state.conversations) };
  });
  const [conversations, setConversations] = useState<Conversation[]>(initialChatState.conversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialChatState.activeConversationId);
  const [draft, setDraft] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<AttachmentNoticeData | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() =>
    initialChatState.conversations.find((conversation) => conversation.id === initialChatState.activeConversationId)?.model ?? pickDefaultModel(modelPreferences.settings, defaultModels),
  );
  const [modelChoices, setModelChoices] = useState<ModelOption[]>(() => {
    const choices = [...defaultModels];
    for (const conversation of initialChatState.conversations) {
      if (!choices.some((model) => model.id === conversation.model.id && model.provider === conversation.model.provider)) {
        choices.push(conversation.model);
      }
    }
    return choices;
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [connectionCenterOpen, setConnectionCenterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("account");
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(isDesktop);
  const [skillsError, setSkillsError] = useState("");
  const [draftSkill, setDraftSkill] = useState<SelectedSkill | undefined>();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeSummary[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(isDesktop);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [draftKnowledge, setDraftKnowledge] = useState<SelectedKnowledge | undefined>();
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(isDesktop);
  const [mcpError, setMcpError] = useState("");
  const [draftMcp, setDraftMcp] = useState<McpSelection[]>([]);
  const [pendingMcp, setPendingMcp] = useState<{ approval: McpApproval; modelName: string; providerName: string; cloudModel: boolean } | null>(null);
  const [mcpDecisionBusy, setMcpDecisionBusy] = useState(false);
  const [mcpDecisionError, setMcpDecisionError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("ollama");
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>(defaultProviderConfigs);
  const [configuredKeys, setConfiguredKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [keyDraft, setKeyDraft] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [chatError, setChatError] = useState("");
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(generalSettings.sidebar === "expanded");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [stoppingRequestId, setStoppingRequestId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "image">("chat");

  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const preparingAttachmentsRef = useRef(false);
  const canvasRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const keyboardHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const followBottomRef = useRef(true);
  const pendingSaveRef = useRef({ conversations, activeConversationId });
  const saveTimerRef = useRef<number | null>(null);
  const persistedReplyingIdRef = useRef<string | null>(null);
  const skillsLoadRef = useRef(0);
  const knowledgeLoadRef = useRef(0);
  const mcpLoadRef = useRef(0);
  const mcpDecisionRef = useRef(false);

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const messages = activeConversation?.messages ?? [];
  const selectedSkill = activeConversation ? activeConversation.skill : draftSkill;
  const currentSkill = skills.find((skill) => skill.id === selectedSkill?.id && skill.enabled);
  const skillChanged = Boolean(selectedSkill && currentSkill && currentSkill.revision !== selectedSkill.revision);
  const selectedKnowledge = activeConversation ? activeConversation.knowledge : draftKnowledge;
  const currentKnowledge = knowledgeBases.find(base => base.id === selectedKnowledge?.id && base.enabled);
  const knowledgeChanged = Boolean(selectedKnowledge && currentKnowledge && currentKnowledge.revision !== selectedKnowledge.revision);
  const selectedMcp = activeConversation?.mcp ?? (activeConversation ? [] : draftMcp);
  const replying = replyingId !== null;
  const conversationError = activeConversationId ? conversationErrors[activeConversationId] : "";
  const lastMessage = messages[messages.length - 1];
  const editableFailedMessage = !replying && lastMessage?.role === "user"
    && (lastMessage.status === "stopped" || lastMessage.status === "failed" || lastMessage.status === "interrupted")
    ? lastMessage
    : null;
  const recoveryNotice = editableFailedMessage?.status === "stopped"
    ? "回复已停止，可编辑问题后重试。"
    : editableFailedMessage?.status === "interrupted"
      ? "上次回复已中断，可编辑问题后重试。"
      : editableFailedMessage?.status === "failed"
        ? "回复失败，可编辑问题后重试。"
        : "";
  const visibleError = chatError || conversationError || recoveryNotice || chatPreferences.error || modelPreferences.error || generalPreferences.error || storageError;

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle("dark", resolveTheme(generalSettings.theme, media.matches) === "dark");
      document.documentElement.dataset.animations = String(generalSettings.animations);
    };
    apply();
    if (generalSettings.theme === "system") media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [generalSettings.theme, generalSettings.animations]);

  const refreshSkills = useCallback(async () => {
    if (!isDesktop) return;
    const loadId = ++skillsLoadRef.current; setSkillsLoading(true);
    try {
      const loaded = await modelport.listSkills();
      if (loadId !== skillsLoadRef.current) return;
      setSkills(loaded); setSkillsError("");
      const enabledIds = new Set(loaded.filter((skill) => skill.enabled).map((skill) => skill.id));
      setDraftSkill((current) => current && !enabledIds.has(current.id) ? undefined : current);
      setConversations((current) => current.map((conversation) => conversation.skill && !enabledIds.has(conversation.skill.id)
        ? { ...conversation, skill: undefined } : conversation));
    } catch (error) { if (loadId === skillsLoadRef.current) setSkillsError(errorMessage(error)); }
    finally { if (loadId === skillsLoadRef.current) setSkillsLoading(false); }
  }, []);
  useEffect(() => { void refreshSkills(); return () => { ++skillsLoadRef.current; }; }, [refreshSkills]);

  const selectSkill = (skill: SkillSummary | undefined) => {
    const selection = skill ? { id: skill.id, revision: skill.revision, name: skill.displayName } : undefined;
    if (activeConversationId) setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
      ? { ...conversation, skill: selection } : conversation));
    else setDraftSkill(selection);
    setChatError("");
  };

  const refreshKnowledge = useCallback(async () => {
    if (!isDesktop) return;
    const loadId = ++knowledgeLoadRef.current; setKnowledgeLoading(true);
    try {
      const loaded = await modelport.listKnowledgeBases();
      if (loadId !== knowledgeLoadRef.current) return;
      setKnowledgeBases(loaded); setKnowledgeError("");
      const enabledIds = new Set(loaded.filter(base => base.enabled).map(base => base.id));
      setDraftKnowledge(current => current && !enabledIds.has(current.id) ? undefined : current);
      setConversations(current => current.map(conversation => conversation.knowledge && !enabledIds.has(conversation.knowledge.id)
        ? { ...conversation, knowledge: undefined } : conversation));
    } catch (error) { if (loadId === knowledgeLoadRef.current) setKnowledgeError(errorMessage(error)); }
    finally { if (loadId === knowledgeLoadRef.current) setKnowledgeLoading(false); }
  }, []);
  useEffect(() => { void refreshKnowledge(); return () => { ++knowledgeLoadRef.current; }; }, [refreshKnowledge]);
  const selectKnowledge = (base: KnowledgeSummary | undefined) => {
    const selection = base ? { id: base.id, revision: base.revision, name: base.name } : undefined;
    if (activeConversationId) setConversations(current => current.map(conversation => conversation.id === activeConversationId ? { ...conversation, knowledge: selection } : conversation));
    else setDraftKnowledge(selection);
    setChatError("");
  };

  const refreshMcp = useCallback(async () => {
    if (!isDesktop) return;
    const loadId = ++mcpLoadRef.current; setMcpLoading(true);
    try {
      const loaded = await mcp.listServers();
      if (loadId !== mcpLoadRef.current) return;
      setMcpServers(loaded); setMcpError("");
      const enabled = new Set(loaded.filter(server => server.enabled).map(server => server.id));
      setDraftMcp(current => current.filter(selection => enabled.has(selection.id)));
      setConversations(current => current.map(conversation => ({ ...conversation, mcp: conversation.mcp?.filter(selection => enabled.has(selection.id)) })));
    } catch (error) { if (loadId === mcpLoadRef.current) setMcpError(errorMessage(error)); }
    finally { if (loadId === mcpLoadRef.current) setMcpLoading(false); }
  }, []);
  useEffect(() => { void refreshMcp(); return () => { ++mcpLoadRef.current; }; }, [refreshMcp]);
  const toggleMcp = (server: McpServer) => {
    if (activeRequestRef.current || attachmentBusy) return;
    const removing = selectedMcp.some(selection => selection.id === server.id);
    if (!removing && selectedMcp.length >= 3) { setChatError("每个对话最多选择 3 个 MCP 服务。"); return; }
    if (!removing && !window.confirm(`将“${server.name}”的工具开放给本次对话？工具说明会发送给所选模型；每次实际执行仍需单独确认。服务返回内容可能含有恶意指令，请仅选择可信服务。`)) return;
    const next = removing ? selectedMcp.filter(selection => selection.id !== server.id) : [...selectedMcp, { id: server.id, revision: server.revision }];
    if (activeConversationId) setConversations(current => current.map(conversation => conversation.id === activeConversationId ? { ...conversation, mcp: next } : conversation));
    else setDraftMcp(next);
    setChatError("");
  };
  const decideMcp = async (allow: boolean) => {
    if (!pendingMcp || mcpDecisionRef.current) return;
    const approval = pendingMcp.approval;
    if (activeRequestRef.current?.requestId !== approval.requestId) { setPendingMcp(null); return; }
    mcpDecisionRef.current = true; setMcpDecisionBusy(true); setMcpDecisionError("");
    try {
      await mcp.decideTool(approval.requestId, approval.approvalId, allow);
      setPendingMcp(current => current?.approval.approvalId === approval.approvalId ? null : current);
    } catch (error) { setMcpDecisionError(`${errorMessage(error)} 未确认执行；可以关闭提示以拒绝，或等待超时。`); }
    finally { mcpDecisionRef.current = false; setMcpDecisionBusy(false); }
  };

  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    void modelport.listProviders().then(async configs => {
      const keys = await Promise.all(configs.filter(config => config.id !== "ollama").map(async config => [config.id, await modelport.hasKey(config.id)] as const));
      if (disposed) return;
      setProviderConfigs(configs); setConfiguredKeys(Object.fromEntries(keys));
      setModelChoices(current => {
        const local = current.filter(model => model.provider === "ollama" && model.id);
        const discovered = [...local, ...configs.flatMap(config => config.models.filter(id => config.id !== "ollama" || !local.some(model => model.id === id)).map(id => modelOption(config.id, id)))];
        const retained = current.filter(model => model.provider === "ollama" || initialChatState.conversations.some(conversation => conversation.model.provider === model.provider && conversation.model.id === model.id));
        return [...discovered, ...retained.filter(model => !discovered.some(item => item.provider === model.provider && item.id === model.id))];
      });
    }).catch(error => { if (!disposed) setChatError(errorMessage(error)); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void modelport.listModels("ollama").then((ids) => {
      if (cancelled) return;
      const discovered = ids.slice(0, 100).map((id) => modelOption("ollama", id));
      if (!discovered.length) return;
      setModelChoices((current) => [...discovered, ...current.filter((model) => model.provider !== "ollama")]);
      setSelectedModel((current) => current.provider === "ollama" && !current.id ? discovered[0] : current);
    }).catch(() => { /* Keep the local-model choice available when Ollama is offline. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    pendingSaveRef.current = { conversations, activeConversationId };
    const streamJustStarted = replyingId !== null && persistedReplyingIdRef.current !== replyingId;
    persistedReplyingIdRef.current = replyingId;
    if (!isDesktop) return;

    const persist = () => {
      saveTimerRef.current = null;
      try {
        saveChatState({
          ...pendingSaveRef.current,
          conversations: withoutEmptyAssistantMessages(pendingSaveRef.current.conversations),
        });
        setStorageError("");
      } catch {
        setStorageError("本地存储空间不足，当前对话可能无法保存。请删除不需要的对话。");
      }
    };

    if (replyingId === null || streamJustStarted) {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      persist();
    } else if (saveTimerRef.current === null) {
      saveTimerRef.current = window.setTimeout(persist, 400);
    }
  }, [conversations, activeConversationId, replyingId]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      try {
        saveChatState({
          ...pendingSaveRef.current,
          conversations: withoutEmptyAssistantMessages(pendingSaveRef.current.conversations),
        });
      } catch { /* The visible storage warning is set while mounted. */ }
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && replyingId === activeConversationId && followBottomRef.current) {
      canvas.scrollTop = canvas.scrollHeight;
    }
  }, [messages, replyingId, activeConversationId]);

  const runWindowAction = async (action: "minimize" | "maximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "maximize") await appWindow.toggleMaximize();
    if (action === "close") await appWindow.close();
  };

  const beginWindowDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isDesktop || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };

  const selectConversation = (id: string) => {
    if (preparingAttachmentsRef.current) return;
    if (draftAttachments.length && !window.confirm("有未发送附件，切换会话会移除草稿附件，确定继续？")) return;
    setDraftAttachments([]);
    const conversation = conversations.find((item) => item.id === id);
    if (conversation) setSelectedModel(conversation.model.provider === "ollama" && !conversation.model.id
      ? modelChoices.find(model => model.provider === "ollama" && model.id) ?? conversation.model : conversation.model);
    followBottomRef.current = true;
    setActiveConversationId(id);
    setChatError("");
    setMode("chat");
  };

  const startNewChat = () => {
    if (preparingAttachmentsRef.current) return;
    if ((draft.trim() || draftAttachments.length) && !window.confirm("输入框有未发送内容或附件，确定放弃并创建新对话吗？")) return;
    followBottomRef.current = true;
    setActiveConversationId(null);
    setSelectedModel(pickDefaultModel(modelPreferences.settings, modelChoices));
    setDraft("");
    setDraftAttachments([]);
    setDraftSkill(undefined);
    setDraftKnowledge(undefined);
    setDraftMcp([]);
    setChatError("");
    setMode("chat");
  };

  const startImageChat = () => {
    if (preparingAttachmentsRef.current) return;
    if ((draft.trim() || draftAttachments.length) && !window.confirm("图像生成尚未开放，切换会丢弃草稿和附件，确定继续？")) return;
    followBottomRef.current = true;
    setActiveConversationId(null);
    setDraft("");
    setDraftAttachments([]);
    setDraftSkill(undefined);
    setDraftKnowledge(undefined);
    setDraftMcp([]);
    setChatError("图像生成接口尚未接入；目前先完成文本对话连接。");
    setMode("image");
  };

  const closeConnectionCenter = () => {
    setKeyDraft("");
    setConnectionNotice("");
    setConnectionCenterOpen(false);
  };

  const storeManagedChats = (state: ChatState) => {
    if (activeRequestRef.current || preparingAttachmentsRef.current) throw new Error("请结束生成或附件处理后再管理聊天数据。");
    try { saveChatState(state); } catch { throw new Error("无法保存聊天数据，请检查存储空间；现有会话尚未改变。"); }
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    pendingSaveRef.current = state;
    setConversations(state.conversations); setActiveConversationId(state.activeConversationId);
    setStorageError("");
  };
  const exportChats = () => {
    if (activeRequestRef.current || preparingAttachmentsRef.current) throw new Error("请结束生成或附件处理后再导出聊天。");
    const content = serializeChatBackup({ conversations, activeConversationId });
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `ModelPort-chats-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
  };
  const importChats = (imported: readonly Conversation[]) => {
    const copies = mergeImportedChats([], imported).map(conversation => ({ ...conversation,
      skill: skills.some(skill => skill.enabled && skill.id === conversation.skill?.id) ? conversation.skill : undefined,
      knowledge: knowledgeBases.some(base => base.enabled && base.id === conversation.knowledge?.id) ? conversation.knowledge : undefined }));
    storeManagedChats({ conversations: withoutEmptyAssistantMessages([...copies, ...conversations]), activeConversationId });
  };
  const clearChats = () => {
    storeManagedChats({ conversations: [], activeConversationId: null });
    setSelectedModel(pickDefaultModel(modelPreferences.settings, modelChoices));
    setDraft(""); setDraftSkill(undefined); setDraftKnowledge(undefined); setMode("chat");
    setDraftMcp([]);
    setDraftAttachments([]);
    setConversationErrors({}); setChatError("");
  };

  const openSettings = (section: SettingsSectionId = "account") => {
    if (preparingAttachmentsRef.current) return;
    setSearchOpen(false);
    closeConnectionCenter();
    setModelMenuOpen(false);
    setSettingsOpen(true);
    setSettingsSection(section);
    void refreshSkills();
    void refreshKnowledge();
    void refreshMcp();
  };

  const closeSettings = () => {
    setKeyDraft("");
    setConnectionNotice("");
    setSettingsOpen(false);
  };

  const saveConnection = async () => {
    if (selectedProvider === "ollama") return;
    if (!isDesktop) {
      setConnectionNotice("请在 ModelPort 桌面应用中配置连接。");
      return;
    }
    setConnectionBusy(true);
    setConnectionNotice("");
    try {
      await modelport.saveKey(selectedProvider, keyDraft);
      setConfiguredKeys((current) => ({ ...current, [selectedProvider]: true }));
      setKeyDraft("");
      setConnectionNotice("API Key 已保存到系统安全凭据库。可点击“测试连接”获取模型列表。");
    } catch (error) {
      setConnectionNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const removeConnection = async () => {
    if (selectedProvider === "ollama" || !isDesktop) return;
    setConnectionBusy(true);
    setConnectionNotice("");
    try {
      await modelport.removeKey(selectedProvider);
      setConfiguredKeys((current) => ({ ...current, [selectedProvider]: false }));
      setConnectionNotice("已从系统安全凭据库删除该服务的 API Key。");
    } catch (error) {
      setConnectionNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const saveProviderConfig = async (config: ProviderConfig) => {
    const saved = await modelport.saveProvider(config);
    setProviderConfigs(current => current.map(item => item.id === saved.id ? saved : item));
    setModelChoices(current => [...current.filter(model => model.provider !== saved.id), ...saved.models.map(id => modelOption(saved.id, id)),
      ...(saved.id === "ollama" && !saved.models.length ? [defaultModels[0]] : [])]);
    return saved;
  };
  const addProviderConfig = async () => {
    const added = await modelport.addProvider();
    setProviderConfigs(current => [...current, added]); setSelectedProvider(added.id); setKeyDraft(""); setConnectionNotice("");
  };
  const removeProviderConfig = async () => {
    const provider = selectedProvider;
    await modelport.removeProvider(provider);
    setProviderConfigs(current => current.filter(item => item.id !== provider));
    setModelChoices(current => current.filter(model => model.provider !== provider));
    setConfiguredKeys(current => { const updated = { ...current }; delete updated[provider]; return updated; });
    setSelectedProvider("ollama"); setKeyDraft(""); setConnectionNotice("已删除自定义提供商及其密钥；聊天记录和原来的默认模型选择保留，需手动重新选择连接。");
  };

  const testConnection = async () => {
    if (!isDesktop) {
      setConnectionNotice("请在 ModelPort 桌面应用中测试连接。");
      return;
    }
    setConnectionBusy(true);
    setConnectionNotice("");
    try {
      const ids = await modelport.listModels(selectedProvider);
      const filtered = selectedProvider === "openai"
        ? ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id))
        : ids;
      const validIds = filtered.filter(id => id.trim() && new TextEncoder().encode(id).length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(id));
      const config = providerConfigs.find(item => item.id === selectedProvider);
      if (!config) throw new Error("提供商已删除，请重新选择。");
      const models = [...new Set([...config.models, ...validIds])].slice(0, 100);
      await saveProviderConfig({ ...config, models });
      const discovered = validIds.slice(0, 100).map((id) => modelOption(selectedProvider, id));
      if (selectedProvider === "ollama" && discovered.length > 0) setSelectedModel(current => current.provider === "ollama" && !current.id ? discovered[0] : current);
      setConnectionNotice(discovered.length === 0 ? "连接成功，但没有发现可用模型。" : `连接成功，发现 ${discovered.length} 个模型。`);
    } catch (error) {
      setConnectionNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const addAttachments = async (files: File[]) => {
    if (!files.length || preparingAttachmentsRef.current || activeRequestRef.current || mode === "image") return;
    if (!isDesktop) { setAttachmentNotice({ title: "请使用桌面应用", message: "附件保存和模型请求仅能在 ModelPort 桌面应用中使用。" }); return; }
    if (files.length + draftAttachments.length > maxAttachments) { setAttachmentNotice({ title: "附件数量超出限制", message: "每条消息最多添加 4 个附件，请先移除部分附件。" }); return; }
    preparingAttachmentsRef.current = true; setAttachmentBusy(true);
    const saved: Attachment[] = [];
    try {
      const hasVideo = files.some(file => fileKind(file) === "video");
      const hasImage = files.some(file => fileKind(file) === "image");
      if (hasVideo || hasImage) {
        if (!selectedModel.id) throw new Error("请先选择模型，再添加图片或视频；当前版本尚未接入视频识别。");
        const capabilities = await modelport.modelCapabilities(selectedModel.provider, selectedModel.id);
        if (hasVideo) throw new Error(selectedModel.provider === "ollama" && !capabilities.vision
          ? `本地模型“${selectedModel.name}”不支持图片识别，也不能在本客户端用于视频识别。当前版本暂不支持视频，请改用截图并选择视觉模型。`
          : "当前版本尚未接入视频识别；支持图片识别不等于已支持视频。请改用截图，视频未保存或发送。");
        if (!capabilities.vision) throw new Error(`所选模型“${selectedModel.name}”不支持图片识别（或尚未确认其视觉能力）。请选择支持视觉的模型，或改为文字附件；不会自动切换模型。`);
      }
      for (const file of files) {
        const input = await readAttachment(file);
        saved.push(await modelport.saveAttachment(input.filename, input.kind, input.data));
      }
      setDraftAttachments(current => [...current, ...saved]); setChatError("");
    } catch (error) {
      if (saved.length) {
        try { await modelport.removeAttachments(saved.map(item => item.id)); }
        catch { /* Bounded store; explicit unused-attachment cleanup can recover abandoned imports. */ }
      }
      setAttachmentNotice({ title: "无法添加附件", message: errorMessage(error) });
    } finally { preparingAttachmentsRef.current = false; setAttachmentBusy(false); }
  };

  const cleanAttachments = async (): Promise<string> => {
    if (preparingAttachmentsRef.current || activeRequestRef.current) throw new Error("请结束生成或附件处理后再清理。");
    preparingAttachmentsRef.current = true; setAttachmentBusy(true);
    try {
      const removed = await modelport.cleanUnusedAttachments(attachmentIds(conversations, draftAttachments));
      return `已清理 ${removed} 个闲置附件副本，当前聊天和草稿引用的附件保留。原文件未修改。`;
    } finally { preparingAttachmentsRef.current = false; setAttachmentBusy(false); }
  };

  const sendMessage = async (event?: FormEvent, generateReply = true) => {
    event?.preventDefault();
    const content = draft.trim() || (draftAttachments.length ? "请分析这些附件。" : "");
    if (!content || activeRequestRef.current || preparingAttachmentsRef.current || mode === "image" || attachmentNotice) return;
    if (!isDesktop) {
      setChatError("真实模型请求仅能在 ModelPort 桌面应用中使用。");
      return;
    }
    if (generateReply && modelPreferences.error && !activeConversationId) { openSettings("defaults"); return; }
    if (generateReply && chatPreferences.error) { openSettings("chat"); return; }
    if (generateReply && selectedModel.provider === "ollama" && !selectedModel.id) {
      setSelectedProvider("ollama");
      setConnectionCenterOpen(true);
      setChatError("请启动本机 Ollama 并安装模型，然后在模型连接中获取模型列表。");
      return;
    }
    if (generateReply && selectedModel.provider !== "ollama" && !isCustomProvider(selectedModel.provider) && !configuredKeys[selectedModel.provider]) {
      setSelectedProvider(selectedModel.provider);
      setConnectionCenterOpen(true);
      setChatError(`请先配置 ${providerInfo(selectedModel.provider, providerConfigs).name} 的 API Key。`);
      return;
    }

    let history = buildRequestHistory(activeConversation?.newTopicPending ? [] : messages.map(message => message.mcpModel
      && (message.mcpModel.provider !== selectedModel.provider || message.mcpModel.id !== selectedModel.id)
      ? { ...message, toolRounds: undefined, reasoningContent: undefined, thinking: undefined } : message), content, chatSettings.contextTurns, draftAttachments);
    const requestMcp = [...selectedMcp];
    if (generateReply && requestMcp.length) {
      if (mcpLoading || mcpError) { setChatError(mcpError || "MCP 服务正在读取，请稍后发送。"); return; }
      if (selectedModel.provider === "anthropic") { setChatError("MCP 首版尚未适配 Claude 原生工具调用，请关闭工具或选择支持工具调用的 Ollama / OpenAI 兼容模型。"); return; }
      if (requestMcp.some(selection => !mcpServers.some(server => server.enabled && server.id === selection.id && server.revision === selection.revision))) {
        setChatError("MCP 服务配置或凭据已改变，请取消勾选后重新选择确认；本次尚未发送。"); return;
      }
    }
    // With tools off, preserve prior answers without forwarding the raw tool data.
    if (!requestMcp.length) history = history.map(({ role, content, attachments }) => ({ role, content, attachments }));
    if (generateReply && selectedModel.provider !== "ollama" && history.some(message => message.toolRounds?.length)
      && !window.confirm(`历史工具结果将作为上下文发送给 ${providerInfo(selectedModel.provider, providerConfigs).name}。这些结果可能包含私人资料；不会重新执行历史工具。确认继续？`)) return;
    let requestSkill = selectedSkill;
    if (generateReply && requestSkill) {
      if (skillsLoading || skillsError) { setChatError(skillsError || "技能库正在读取，请稍后发送。"); return; }
      if (!currentSkill) { selectSkill(undefined); setChatError("技能已禁用或删除，已清除选择。请确认后重新发送。"); return; }
      if (skillChanged) {
        if (!window.confirm(`“${currentSkill.displayName}”的内容已更新。确认使用新版？可先到设置中审阅。旧回复仍可能影响模型，建议更换技能后新建对话。`)) return;
        requestSkill = { id: currentSkill.id, revision: currentSkill.revision, name: currentSkill.displayName };
        selectSkill(currentSkill);
      }
    }

    let requestKnowledge = selectedKnowledge;
    if (generateReply && requestKnowledge) {
      if (knowledgeLoading || knowledgeError) { setChatError(knowledgeError || "知识库正在读取，请稍后发送。"); return; }
      if (!currentKnowledge) { selectKnowledge(undefined); setChatError("知识库已禁用或删除，已清除选择。请确认后重新发送。"); return; }
      if (knowledgeChanged) {
        if (!window.confirm(`“${currentKnowledge.name}”已更新，确认使用新版资料？可先到知识库设置审阅。`)) return;
        requestKnowledge = { id: currentKnowledge.id, revision: currentKnowledge.revision, name: currentKnowledge.name }; selectKnowledge(currentKnowledge);
      }
      if (selectedModel.provider !== "ollama" && !window.confirm(`本次将把“${requestKnowledge.name}”命中的最多 4 个资料片段发送给 ${providerInfo(selectedModel.provider, providerConfigs).name}。确认继续？${history.some(message => message.attachments?.length) ? "未命中时仍会处理已附加文件。" : "未命中时不会发送模型请求。"}`)) return;
    }

    if (generateReply && history.some(message => message.attachments?.length)) {
      preparingAttachmentsRef.current = true; setAttachmentBusy(true);
      try {
        await modelport.validateAttachments(selectedModel.provider, selectedModel.id, history);
        if (selectedModel.provider !== "ollama" && !window.confirm(`本次会把所选附件及携带上下文中的附件内容发送给 ${providerInfo(selectedModel.provider, providerConfigs).name}，云端服务可能产生额外费用。确认发送？未选择的本地文件不会上传。`)) return;
      } catch (error) {
        setAttachmentNotice({ title: "附件未发送", message: errorMessage(error) }); return;
      } finally { preparingAttachmentsRef.current = false; setAttachmentBusy(false); }
    }

    const conversationId = activeConversationId ?? crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const nextMessage: Message = { id: crypto.randomUUID(), role: "user", content, attachments: draftAttachments.length ? draftAttachments : undefined, status: generateReply ? "streaming" : undefined, savedOnly: generateReply ? undefined : true, topicStart: activeConversation?.newTopicPending, skill: requestSkill, knowledge: requestKnowledge };
    const pendingReply: Message = { id: assistantMessageId, role: "assistant", content: "", status: "streaming" };
    const newMessages = generateReply ? [nextMessage, pendingReply] : [nextMessage];
    if (generateReply) activeRequestRef.current = { requestId, conversationId, assistantMessageId };
    followBottomRef.current = true;
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      if (existing) {
        return current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, model: selectedModel, skill: requestSkill, knowledge: requestKnowledge, mcp: requestMcp, newTopicPending: undefined, messages: [...conversation.messages, ...newMessages] }
          : conversation);
      }
      return [{ id: conversationId, title: content.slice(0, 24), date: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }), model: selectedModel, skill: requestSkill, knowledge: requestKnowledge, mcp: requestMcp, messages: newMessages }, ...current];
    });
    setActiveConversationId(conversationId);
    setDraft("");
    setDraftAttachments([]);
    setChatError("");
    setConversationErrors((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    if (!generateReply) return;
    setReplyingId(conversationId);
    setStreamingMessageId(assistantMessageId);
    let receivedText = "";
    let toolRounds: ToolRound[] | undefined;
    let reasoningContent: string | undefined;
    let thinking: string | undefined;
    const settleMessages = (status: Message["status"], assistantContent: string) => {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: conversation.messages.flatMap((message): Message[] => {
          if (message.id === nextMessage.id) return [{ ...message, status }];
          if (message.id === assistantMessageId) {
            return assistantContent || message.toolTrace?.length || toolRounds?.length
              ? [{ ...message, content: assistantContent, status, toolRounds, reasoningContent, thinking,
                mcpModel: requestMcp.length ? { provider: selectedModel.provider, id: selectedModel.id } : undefined,
                toolTrace: message.toolTrace?.map(trace => ["pending", "running"].includes(trace.status) ? { ...trace, status: "interrupted" } : trace) }] : [];
          }
          return [message];
        }) }
        : conversation));
    };
    try {
      const onDelta = (delta: string) => {
        if (activeRequestRef.current?.requestId !== requestId || !delta) return;
        receivedText += delta;
        setConversations((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, messages: conversation.messages.map((message) => message.id === assistantMessageId
            ? { ...message, content: message.content + delta }
            : message) }
          : conversation));
      };
      const onSources = (retrieval: import("@/lib/modelport").KnowledgeContext) => {
        setConversations(current => current.map(conversation => conversation.id === conversationId
          ? { ...conversation, messages: conversation.messages.map(message => message.id === assistantMessageId ? { ...message, retrieval } : message) } : conversation));
      };
      const onMcpEvent = (event: McpEvent) => {
        if (event.requestId !== requestId || activeRequestRef.current?.requestId !== requestId) return;
        if (event.type === "approval") {
          setMcpDecisionError("");
          setPendingMcp({ approval: event, modelName: selectedModel.name,
            providerName: providerInfo(selectedModel.provider, providerConfigs).name, cloudModel: selectedModel.provider !== "ollama" });
        } else {
          if (event.status !== "pending") setPendingMcp(current => current?.approval.approvalId === event.approvalId ? null : current);
          const trace: ToolTrace = { approvalId: event.approvalId, serverName: event.serverName, toolName: event.toolName, status: event.status, summary: event.summary };
          setConversations(current => current.map(conversation => conversation.id === conversationId
            ? { ...conversation, messages: conversation.messages.map(message => message.id === assistantMessageId
              ? { ...message, toolTrace: [...(message.toolTrace ?? []).filter(item => item.approvalId !== trace.approvalId), trace] } : message) } : conversation));
        }
      };
      const result = requestMcp.length
        ? await modelport.streamMcpChat(selectedModel.provider, selectedModel.id, history, requestId, onDelta, requestMcp, onMcpEvent,
          requestSkill ?? null, requestKnowledge ?? null, onSources, chatSettings.systemPrompt)
        : await modelport.streamChat(selectedModel.provider, selectedModel.id, history, requestId, onDelta,
          requestSkill ?? null, requestKnowledge ?? null, onSources, chatSettings.systemPrompt);
      toolRounds = result.toolRounds; reasoningContent = result.reasoningContent; thinking = result.thinking;
      settleMessages(result.status === "completed" && result.content
        ? undefined
        : result.status === "cancelled" ? "stopped" : "failed", result.content);
      if (result.status === "completed" && !result.content) {
        setConversationErrors((current) => ({ ...current, [conversationId]: "模型返回了空内容，请重试。" }));
      }
      if (result.status === "failed") {
        setConversationErrors((current) => ({ ...current, [conversationId]: result.error || "生成失败，请重试。" }));
      }
    } catch (error) {
      settleMessages("failed", receivedText);
      if (history.some(message => message.attachments?.length)) setAttachmentNotice({ title: "附件请求未完成", message: errorMessage(error) });
      if (requestSkill) void refreshSkills();
      if (requestKnowledge) void refreshKnowledge();
      setConversationErrors((current) => ({ ...current, [conversationId]: errorMessage(error) }));
    } finally {
      setPendingMcp(current => current?.approval.requestId === requestId ? null : current);
      if (activeRequestRef.current?.requestId === requestId) activeRequestRef.current = null;
      setReplyingId(null);
      setStreamingMessageId(null);
      setStoppingRequestId(null);
    }
  };

  const stopChat = async () => {
    const request = activeRequestRef.current;
    if (!request || stoppingRequestId === request.requestId) return;
    setStoppingRequestId(request.requestId);
    try {
      await modelport.cancelChat(request.requestId);
      setPendingMcp(current => current?.approval.requestId === request.requestId ? null : current);
    } catch (error) {
      if (activeRequestRef.current?.requestId === request.requestId) {
        setStoppingRequestId(null);
        setConversationErrors((current) => ({ ...current, [request.conversationId]: `停止失败：${errorMessage(error)}` }));
      }
    }
  };

  const editAndRetry = () => {
    const conversationId = activeConversationId;
    const failedMessage = editableFailedMessage;
    if (!conversationId || !failedMessage || activeRequestRef.current || preparingAttachmentsRef.current) return;
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation?.messages[conversation.messages.length - 1]?.id !== failedMessage.id) return;
    if ((draftAttachments.length || draft.trim() && draft !== failedMessage.content)
      && !window.confirm("输入框已有未发送内容，确定改为编辑失败的问题吗？")) return;

    setDraft(failedMessage.content);
    setDraftAttachments(failedMessage.attachments ?? []);
    setConversations((current) => current.flatMap((item) => {
      if (item.id !== conversationId) return [item];
      const remaining = item.messages.filter((message) => message.id !== failedMessage.id);
      return remaining.length ? [{ ...item, newTopicPending: failedMessage.topicStart || item.newTopicPending || undefined, messages: remaining }] : [];
    }));
    if (conversation.messages.length === 1) { setDraftSkill(conversation.skill); setDraftKnowledge(conversation.knowledge); setActiveConversationId(null); }
    setConversationErrors((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setChatError("");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const focusComposer = () => window.requestAnimationFrame(() => textareaRef.current?.focus());
  const startNewTopic = () => {
    if (activeRequestRef.current || preparingAttachmentsRef.current || mode === "image") return;
    if (activeConversation?.messages.length) {
      setConversations(current => current.map(conversation => conversation.id === activeConversationId
        ? { ...conversation, newTopicPending: true } : conversation));
      setChatError("");
    }
  };
  // A single listener reads the latest committed actions; settings modals keep their own keyboard behavior.
  useEffect(() => {
    keyboardHandlerRef.current = event => {
      if (settingsOpen || connectionCenterOpen || attachmentNotice || preparingAttachmentsRef.current) return;
      const action = getAppShortcut(event);
      if (action === undefined || (searchOpen && action !== "toggle-search")) return;
      event.preventDefault();
      setModelMenuOpen(false);
      if (action === "toggle-search") { setSearchOpen(current => !current); return; }
      if (action === "new-chat") startNewChat();
      else if (action === "new-topic") startNewTopic();
      else {
        const id = typeof action === "number" ? conversations[action]?.id
          : adjacentConversationId(conversations, activeConversationId, action === "next-chat" ? 1 : -1);
        if (id) selectConversation(id);
      }
      focusComposer();
    };
  });
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => keyboardHandlerRef.current(event);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const renderConversation = (conversation: Conversation) => {
    const isActive = activeConversationId === conversation.id;
    return (
      <button className={`conversation-item${isActive ? " is-active" : ""}`} key={conversation.id} onClick={() => selectConversation(conversation.id)} type="button">
        <span className="conversation-icon"><Icon name="chat" size={24} /></span>
        <span className="conversation-title">{conversation.title}</span>
        {isActive && <Icon name="pin" size={18} />}
        <span className="conversation-date">{conversation.date}</span>
      </button>
    );
  };

  const providerSettingsProps: ProviderSettingsProps = {
    configs: providerConfigs,
    onSaveConfig: saveProviderConfig,
    onAddProvider: addProviderConfig,
    onDeleteProvider: removeProviderConfig,
    busy: connectionBusy,
    configuredKeys,
    keyDraft,
    notice: connectionNotice,
    onKeyDraftChange: setKeyDraft,
    onRemove: removeConnection,
    onSave: saveConnection,
    onSelectProvider: (providerId) => {
      setSelectedProvider(providerId);
      setKeyDraft("");
      setConnectionNotice("");
    },
    onTest: testConnection,
    selectedProvider,
  };

  return (
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <div
        aria-hidden="true"
        className="window-drag-strip"
        data-tauri-drag-region
        onMouseDown={beginWindowDrag}
      />
      <div aria-label="窗口控制" className="window-actions" role="toolbar">
        <button aria-label="最小化窗口" onClick={() => void runWindowAction("minimize")} type="button"><Icon name="minimize" size={18} /></button>
        <button aria-label="最大化或还原窗口" onClick={() => void runWindowAction("maximize")} type="button"><Icon name="maximize" size={17} /></button>
        <button aria-label="关闭窗口" className="close-button" onClick={() => void runWindowAction("close")} type="button"><Icon name="close" size={18} /></button>
      </div>

      <header className="brand-row" data-tauri-drag-region onMouseDown={beginWindowDrag}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /></div>
          <strong>ModelPort</strong>
        </div>
        <div className="brand-actions">
          <button aria-label="搜索会话" className="icon-button" onClick={() => setSearchOpen(true)} title="搜索会话（Ctrl + K）" type="button"><Icon name="search" /></button>
          <button aria-label="会话归档" className="icon-button" disabled title="归档功能正在开发" type="button"><Icon name="archive" /></button>
          <button
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            className="icon-button"
            onClick={() => setSidebarOpen((open) => !open)}
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            type="button"
          ><Icon name="panel" /></button>
        </div>
      </header>

      <aside className="sidebar">

        <div className="sidebar-scroll">
          <section className="conversation-section">
            <h2>置顶</h2>
            <div className="conversation-list">
              <button className="conversation-item" onClick={startNewChat} type="button">
                <span className="conversation-icon"><Icon name="chat" size={24} /></span>
                <span className="conversation-title">快速开始</span>
              </button>
            </div>
          </section>
          <section className="conversation-section">
            <h2>对话</h2>
            <div className="conversation-list">
              {conversations.length ? conversations.map(renderConversation) : <p className="no-conversations">新对话会显示在这里</p>}
            </div>
          </section>
        </div>

        <footer className="sidebar-footer">
          <div className="primary-actions">
            <button onClick={startNewChat} type="button"><Icon name="plus" size={21} /><span>新对话</span></button>
            <button onClick={startImageChat} type="button"><Icon name="image" size={21} /><span>生成图片</span></button>
          </div>
          <nav aria-label="应用菜单" className="utility-nav">
            <button onClick={() => openSettings("knowledge")} type="button"><Icon name="library" /><span>我的资料</span></button>
            <button aria-label="设置" onClick={() => openSettings()} type="button"><Icon name="settings" /><span>设置</span></button>
            <button onClick={() => setConnectionCenterOpen(true)} type="button"><Icon name="providers" /><span>模型连接</span>{!Object.values(configuredKeys).some(Boolean) && <span className="status-dot" />}</button>
            <button disabled title="帮助中心正在开发" type="button"><Icon name="help" /><span>帮助</span></button>
            <button className="muted" disabled type="button"><Icon name="info" /><span>关于（0.11.0）</span></button>
          </nav>
        </footer>
      </aside>

      <main className="workspace">
        <div className="workspace-topbar" data-tauri-drag-region onMouseDown={beginWindowDrag}>
          {activeConversation && (
            <button
              aria-label="关闭当前对话"
              className="conversation-close-button"
              disabled={replyingId === activeConversationId}
              onClick={startNewChat}
              title="关闭当前对话"
              type="button"
            ><Icon name="close" size={17} /></button>
          )}
        </div>

        <section
          className="conversation-canvas"
          onScroll={() => {
            const canvas = canvasRef.current;
            if (canvas) followBottomRef.current = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight < 120;
          }}
          ref={canvasRef}
        >
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-chat-icon"><Icon name={mode === "image" ? "image" : "chat"} size={53} /></div>
              <h1>{mode === "image" ? "想象一下，接下来画什么？" : "今天我能为你提供什么帮助？"}</h1>
              <p>{mode === "image" ? "图像生成即将开放。" : "选择模型并开始对话，你的数据由你掌控。"}</p>
            </div>
          ) : (
            <div className="message-stream">
              <div className="chat-heading">
                <span>{activeConversation?.title ?? "新对话"}</span>
              </div>
              {messages.map((message) => (
                <Fragment key={message.id}>
                {message.topicStart && <div className="topic-divider">新话题 · 不携带之前的聊天上下文</div>}
                <article className={`message ${message.role}`}>
                  {message.role === "assistant" && <div className="assistant-avatar"><Icon name="spark" size={18} /></div>}
                  <div className="message-bubble" style={{ fontSize: chatSettings.fontSize }}>
                    {message.role === "assistant"
                      ? message.content
                        ? chatSettings.renderMarkdown
                          ? <Suspense fallback={<span>正在排版回复…</span>}><MessageResponse key={message.id === streamingMessageId ? "streaming" : "static"} mode={message.id === streamingMessageId ? "streaming" : "static"}>{message.content}</MessageResponse></Suspense>
                          : <div className="message-plain-text">{message.content}</div>
                        : message.id === streamingMessageId && <div aria-label="正在生成回复" className="typing"><span /><span /><span /></div>
                      : message.content}
                    {message.attachments?.length ? <AttachmentList attachments={message.attachments} onNotice={setAttachmentNotice} /> : null}
                    {message.skill && <span className="message-skill">选用技能：{message.skill.name} · {message.skill.revision.slice(0, 8)}</span>}
                    {message.knowledge && <span className="message-knowledge">选用知识库：{message.knowledge.name} · {message.knowledge.revision.slice(0, 8)}</span>}
                    {message.savedOnly && <span className="stream-note">仅保存，未生成回复</span>}
                    {message.role === "assistant" && message.retrieval && <KnowledgeSources context={message.retrieval} />}
                    {message.toolTrace?.length ? <details className="mcp-chat-trace"><summary>工具记录 · {message.toolTrace.length} 次（不会自动重放）</summary>
                      <McpToolTrace events={message.toolTrace} />
                    </details> : null}
                    {message.role === "assistant" && message.status === "stopped" && <span className="stream-note">已停止生成</span>}
                    {message.role === "assistant" && message.status === "failed" && <span className="stream-note">生成失败</span>}
                    {message.role === "assistant" && message.status === "interrupted" && <span className="stream-note">生成中断</span>}
                    {message.id === editableFailedMessage?.id && <span className="stream-note">{message.status === "stopped" ? "回复已停止" : message.status === "failed" ? "回复失败" : "回复中断"}</span>}
                  </div>
                </article>
                </Fragment>
              ))}
              {activeConversation?.newTopicPending && <div className="topic-divider" role="status">新话题 · 下一条消息将重新开始上下文</div>}
            </div>
          )}
        </section>

        <div className="composer-area">
          {visibleError && (
            <div className="chat-error" role="alert">
              <span>{visibleError}</span>
              {editableFailedMessage && <button onClick={editAndRetry} type="button">编辑并重试</button>}
            </div>
          )}
          <form className="composer" onSubmit={sendMessage}>
            {draftAttachments.length > 0 && <AttachmentList attachments={draftAttachments} disabled={replying || attachmentBusy} onNotice={setAttachmentNotice} onRemove={id => setDraftAttachments(current => current.filter(item => item.id !== id))} />}
            {attachmentBusy && <p className="attachment-status" role="status">正在处理附件并检查模型能力…</p>}
            <textarea
              aria-label="消息输入框"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.repeat) return;
                if (shouldSendOnKey(event.nativeEvent, chatSettings.sendShortcut)) {
                  event.preventDefault();
                  void sendMessage();
                } else if (matchesSaveOnlyShortcut(event.nativeEvent, chatSettings.sendWithoutReplyShortcut)) {
                  event.preventDefault();
                  void sendMessage(undefined, false);
                }
              }}
              disabled={mode === "image" || attachmentBusy}
              placeholder={mode === "image" ? "图像生成即将开放" : "在这里输入你的问题..."}
              ref={textareaRef}
              rows={2}
              value={draft}
            />
            <div className="composer-context">
              <div className="skill-bar">
                <Icon name="wand" size={17} /><label htmlFor="chat-skill">技能</label>
                <select aria-label="选择技能" disabled={replying || skillsLoading || Boolean(skillsError) || mode === "image"} id="chat-skill"
                  onChange={(event) => selectSkill(skills.find((skill) => `${skill.id}:${skill.revision}` === event.target.value && skill.enabled))}
                  title={`${selectedSkill ? `${selectedSkill.name}。` : ""}仅使用选中技能的指令；云端模型会收到正文，不执行脚本。`}
                  value={selectedSkill ? `${selectedSkill.id}:${selectedSkill.revision}` : ""}>
                  <option value="">无技能</option>
                  {selectedSkill && (!currentSkill || skillChanged) && <option disabled value={`${selectedSkill.id}:${selectedSkill.revision}`}>{selectedSkill.name}（待确认更新）</option>}
                  {skills.filter((skill) => skill.enabled).map((skill) => <option key={skill.id} value={`${skill.id}:${skill.revision}`}>{skill.displayName}</option>)}
                </select>
                {selectedSkill && <button aria-label="清除技能" disabled={replying} onClick={() => selectSkill(undefined)} type="button"><Icon name="close" size={14} /></button>}
                {skillChanged && <span aria-label="技能内容已更新" className="skill-update" title="技能内容已更新，请重新选择确认新版本">已更新</span>}
                <button aria-label={skillsError ? "管理技能（读取异常）" : "管理技能"} className="manage-skills" data-error={skillsError ? true : undefined} onClick={() => openSettings("skills")} title={skillsError ? "管理技能 · 读取异常" : "管理技能"} type="button"><Icon name="settings" size={16} /></button>
              </div>
              <div className="knowledge-bar">
                <Icon name="book" size={17} /><label htmlFor="chat-knowledge">知识库</label>
                <select aria-label="选择知识库" disabled={replying || knowledgeLoading || Boolean(knowledgeError) || mode === "image"} id="chat-knowledge"
                  onChange={event => selectKnowledge(knowledgeBases.find(base => `${base.id}:${base.revision}` === event.target.value && base.enabled))}
                  title={`${selectedKnowledge ? `${selectedKnowledge.name}。` : ""}本地检索，仅发送命中片段；每次云端请求前会确认。`} value={selectedKnowledge ? `${selectedKnowledge.id}:${selectedKnowledge.revision}` : ""}>
                  <option value="">无知识库</option>
                  {selectedKnowledge && (!currentKnowledge || knowledgeChanged) && <option disabled value={`${selectedKnowledge.id}:${selectedKnowledge.revision}`}>{selectedKnowledge.name}（待确认更新）</option>}
                  {knowledgeBases.filter(base => base.enabled).map(base => <option key={base.id} value={`${base.id}:${base.revision}`}>{base.name}</option>)}
                </select>
                {selectedKnowledge && <button aria-label="清除知识库" disabled={replying} onClick={() => selectKnowledge(undefined)} type="button"><Icon name="close" size={14} /></button>}
                {knowledgeChanged && <span aria-label="知识库资料已更新" className="skill-update" title="知识库资料已更新，请重新选择确认新版本">已更新</span>}
                <button aria-label={knowledgeError ? "管理知识库（读取异常）" : "管理知识库"} className="manage-knowledge" data-error={knowledgeError ? true : undefined} onClick={() => openSettings("knowledge")} title={knowledgeError ? "管理知识库 · 读取异常" : "管理知识库"} type="button"><Icon name="settings" size={16} /></button>
              </div>
            </div>
            <div className="composer-toolbar">
              <div className="composer-tools">
                <AttachmentMenu disabled={replying || attachmentBusy || mode === "image"} onFiles={files => void addAttachments(files)} />
                <button aria-label="深度思考" disabled title="深度思考选项正在开发" type="button"><Icon name="brain" size={23} /></button>
                <button className="mode-button" disabled type="button"><Icon name="robot" size={22} /><span>{mode === "image" ? "绘图模式" : "对话模式"}</span></button>
                <button aria-label="对话设置" onClick={() => openSettings("chat")} title="打开对话设置" type="button"><Icon name="sliders" size={22} /></button>
                <details className="mcp-chat-picker">
                  <summary aria-label="选择 MCP 工具服务" aria-disabled={replying || attachmentBusy || mode === "image"}><Icon name="mcp" size={22} /><span>工具{selectedMcp.length ? ` · ${selectedMcp.length}` : ""}</span></summary>
                  <div className="mcp-chat-menu">
                    <strong>当前对话的 MCP 工具</strong><p>默认不选服务；每次执行都需要确认。关闭所有服务后，只沿用之前的文字回答，不携带原始工具结果。</p>
                    {mcpError && <p role="alert">{mcpError}</p>}
                    {mcpLoading ? <p>正在读取…</p> : mcpServers.filter(server => server.enabled).map(server => {
                      const selection = selectedMcp.find(item => item.id === server.id);
                      return <label key={server.id}><input checked={!!selection} disabled={replying || attachmentBusy || mode === "image"} onChange={() => toggleMcp(server)} type="checkbox" />
                        <span>{server.name}{selection && selection.revision !== server.revision ? "（已更新，需重新选择）" : ""}<small>{server.url}</small></span></label>;
                    })}
                    {!mcpLoading && !mcpServers.some(server => server.enabled) && <p>暂无启用服务，请到设置中添加并审阅。</p>}
                    <button disabled={replying || attachmentBusy} onClick={() => openSettings("mcp")} type="button">管理 MCP 服务</button>
                  </div>
                </details>
              </div>

              <div className="composer-meta">
                <span className="context-count">{messages.length ? `${messages.length} 条消息` : "新对话"}</span>
                <div className="model-picker">
                  {modelMenuOpen && (
                    <div className="model-menu">
                      <div className="model-menu-title">选择模型</div>
                      {modelChoices.map((model) => (
                        <button disabled={attachmentBusy} className={selectedModel.id === model.id && selectedModel.provider === model.provider ? "selected" : ""} key={`${model.provider}:${model.id}`} onClick={() => { setSelectedModel(model); if (activeConversationId) setConversations((current) => current.map((conversation) => conversation.id === activeConversationId ? { ...conversation, model } : conversation)); setModelMenuOpen(false); setMode("chat"); setChatError(""); }} type="button">
                          <span className="model-logo" style={{ background: model.tone }}>{model.label}</span>
                          <span><strong>{model.name}</strong><small>{providerInfo(model.provider, providerConfigs).name}</small></span>
                        </button>
                      ))}
                      <button className="manage-models" onClick={() => { setModelMenuOpen(false); setConnectionCenterOpen(true); }} type="button">管理模型连接</button>
                    </div>
                  )}
                  <button className="model-trigger" disabled={attachmentBusy} onClick={() => setModelMenuOpen((open) => !open)} title={selectedModel.name} type="button">
                    <span className="model-logo" style={{ background: selectedModel.tone }}>{selectedModel.label}</span>
                    <span>{selectedModel.name}</span>
                    <Icon name="chevron" size={18} />
                  </button>
                </div>
                {replying ? (
                  <button aria-label={stoppingRequestId ? "正在停止生成" : "停止生成"} className="send-button stop-button" disabled={stoppingRequestId !== null} onClick={() => void stopChat()} type="button"><span className="stop-symbol" /></button>
                ) : (
                  <button aria-label="发送消息" className="send-button" disabled={(!draft.trim() && !draftAttachments.length) || mode === "image" || attachmentBusy} type="submit"><Icon name="send" size={21} /></button>
                )}
              </div>
            </div>
          </form>
          <p className="disclaimer">AI 可能出错，请核实重要信息。对话记录仅保存在本机。</p>
        </div>
      </main>

      {connectionCenterOpen && (
        <ConnectionModal {...providerSettingsProps} onClose={closeConnectionCenter} />
      )}
      {settingsOpen && (
        <SettingsDialog
          currentModel={selectedModel}
          modelChoices={modelChoices}
          onClose={closeSettings}
          providerProps={providerSettingsProps}
          initialSectionId={settingsSection}
          skills={skills}
          skillsLoading={skillsLoading}
          skillsError={skillsError}
          onSkillsChanged={refreshSkills}
          knowledgeBases={knowledgeBases}
          knowledgeLoading={knowledgeLoading}
          knowledgeError={knowledgeError}
          onKnowledgeChanged={refreshKnowledge}
          mcpServers={mcpServers}
          mcpLoading={mcpLoading}
          mcpError={mcpError}
          onMcpChanged={refreshMcp}
          chatSettings={chatSettings}
          chatSettingsError={chatPreferences.error}
          onSaveChatSettings={settings => setChatPreferences({ settings: saveChatSettings(settings), error: "" })}
          generalSettings={generalSettings}
          generalSettingsError={generalPreferences.error}
          onSaveGeneralSettings={settings => setGeneralPreferences({ settings: saveGeneralSettings(settings), error: "" })}
          modelDefaults={modelPreferences.settings}
          modelDefaultsError={modelPreferences.error}
          onSaveModelDefaults={settings => {
            const saved = saveModelDefaults(settings);
            setModelPreferences({ settings: saved, error: "" });
            if (!activeConversationId && mode === "chat" && !activeRequestRef.current) {
              setSelectedModel(pickDefaultModel(saved, modelChoices)); setChatError("");
            }
          }}
          chatData={conversations}
          chatBusy={replying || attachmentBusy}
          onCleanAttachments={cleanAttachments}
          onExportChats={exportChats}
          onImportChats={importChats}
          onClearChats={clearChats}
        />
      )}
      {searchOpen && <ConversationSearchDialog conversations={conversations} onClose={() => setSearchOpen(false)} onSelect={id => {
        selectConversation(id); setSearchOpen(false); focusComposer();
      }} />}
      {attachmentNotice && <AttachmentNotice notice={attachmentNotice} onClose={() => { setAttachmentNotice(null); focusComposer(); }} />}
      {pendingMcp && <McpApprovalDialog approval={pendingMcp.approval} modelName={pendingMcp.modelName}
        providerName={pendingMcp.providerName} cloudModel={pendingMcp.cloudModel} busy={mcpDecisionBusy}
        error={mcpDecisionError} onDecision={allow => void decideMcp(allow)} />}
    </div>
  );
}

export default App;
