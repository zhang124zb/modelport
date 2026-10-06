import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConnectionModal } from "@/components/ConnectionModal";
import { Icon } from "@/components/Icon";
import {
  defaultModels,
  errorMessage,
  isDesktop,
  modelOption,
  modelport,
  providerDetails,
} from "@/lib/modelport";
import type { ModelOption, ProviderId } from "@/lib/modelport";
import { loadChatState, saveChatState } from "@/lib/chat-store";
import type { Conversation, Message } from "@/lib/chat-store";
import "./App.css";

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
    messages: conversation.messages.filter((message) => message.role !== "assistant" || message.content.length > 0),
  }));
}

function App() {
  const [initialChatState] = useState(() => {
    const state = loadChatState();
    return { ...state, conversations: withoutEmptyAssistantMessages(state.conversations) };
  });
  const [conversations, setConversations] = useState<Conversation[]>(initialChatState.conversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialChatState.activeConversationId);
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(
    initialChatState.conversations.find((conversation) => conversation.id === initialChatState.activeConversationId)?.model ?? defaultModels[0],
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
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("ollama");
  const [configuredKeys, setConfiguredKeys] = useState<Record<"openai" | "deepseek", boolean>>({ openai: false, deepseek: false });
  const [keyDraft, setKeyDraft] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [chatError, setChatError] = useState("");
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [stoppingRequestId, setStoppingRequestId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "image">("chat");

  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const followBottomRef = useRef(true);
  const pendingSaveRef = useRef({ conversations, activeConversationId });
  const saveTimerRef = useRef<number | null>(null);
  const persistedReplyingIdRef = useRef<string | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const messages = activeConversation?.messages ?? [];
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
  const visibleError = chatError || conversationError || recoveryNotice || storageError;

  useEffect(() => {
    if (!isDesktop) return;
    void Promise.all([
      modelport.hasKey("openai"),
      modelport.hasKey("deepseek"),
    ]).then(([openai, deepseek]) => setConfiguredKeys({ openai, deepseek }))
      .catch(() => setChatError("无法读取系统安全凭据库，请检查桌面应用权限。"));
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
    const conversation = conversations.find((item) => item.id === id);
    if (conversation) setSelectedModel(conversation.model);
    followBottomRef.current = true;
    setActiveConversationId(id);
    setChatError("");
    setMode("chat");
  };

  const startNewChat = () => {
    followBottomRef.current = true;
    setActiveConversationId(null);
    setSelectedModel(modelChoices.find((model) => model.provider === "ollama" && model.id) ?? defaultModels[0]);
    setDraft("");
    setChatError("");
    setMode("chat");
  };

  const startImageChat = () => {
    followBottomRef.current = true;
    setActiveConversationId(null);
    setDraft("");
    setChatError("图像生成接口尚未接入；目前先完成文本对话连接。");
    setMode("image");
  };

  const closeConnectionCenter = () => {
    setKeyDraft("");
    setConnectionNotice("");
    setConnectionCenterOpen(false);
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
      setModelChoices((current) => current.filter((model) => model.provider !== selectedProvider || defaultModels.some((item) => item.id === model.id)));
      setConnectionNotice("已从系统安全凭据库删除该服务的 API Key。");
    } catch (error) {
      setConnectionNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
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
      const discovered = filtered.slice(0, 100).map((id) => modelOption(selectedProvider, id));
      setModelChoices((current) => [...current.filter((model) => model.provider !== selectedProvider), ...discovered]);
      if (selectedProvider === "ollama" && discovered.length > 0) setSelectedModel(discovered[0]);
      setConnectionNotice(discovered.length === 0 ? "连接成功，但没有发现可用模型。" : `连接成功，发现 ${discovered.length} 个模型。`);
    } catch (error) {
      setConnectionNotice(errorMessage(error));
    } finally {
      setConnectionBusy(false);
    }
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || activeRequestRef.current || mode === "image") return;
    if (!isDesktop) {
      setChatError("真实模型请求仅能在 ModelPort 桌面应用中使用。");
      return;
    }
    if (selectedModel.provider === "ollama" && !selectedModel.id) {
      setSelectedProvider("ollama");
      setConnectionCenterOpen(true);
      setChatError("请启动本机 Ollama 并安装模型，然后在模型连接中获取模型列表。");
      return;
    }
    if (selectedModel.provider !== "ollama" && !configuredKeys[selectedModel.provider]) {
      setSelectedProvider(selectedModel.provider);
      setConnectionCenterOpen(true);
      setChatError(`请先配置 ${providerDetails[selectedModel.provider].name} 的 API Key。`);
      return;
    }

    const conversationId = activeConversationId ?? crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const nextMessage: Message = { id: crypto.randomUUID(), role: "user", content, status: "streaming" };
    const pendingReply: Message = { id: assistantMessageId, role: "assistant", content: "", status: "streaming" };
    const history = [
      ...messages.filter((message) => message.content.trim().length > 0 && !message.status)
        .map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content },
    ];
    activeRequestRef.current = { requestId, conversationId, assistantMessageId };
    followBottomRef.current = true;
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      if (existing) {
        return current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, nextMessage, pendingReply] }
          : conversation);
      }
      return [{ id: conversationId, title: content.slice(0, 24), date: new Date().toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }), model: selectedModel, messages: [nextMessage, pendingReply] }, ...current];
    });
    setActiveConversationId(conversationId);
    setDraft("");
    setChatError("");
    setConversationErrors((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setReplyingId(conversationId);
    setStreamingMessageId(assistantMessageId);
    let receivedText = "";
    const settleMessages = (status: Message["status"], assistantContent: string) => {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: conversation.messages.flatMap((message): Message[] => {
          if (message.id === nextMessage.id) return [{ ...message, status }];
          if (message.id === assistantMessageId) {
            return assistantContent ? [{ ...message, content: assistantContent, status }] : [];
          }
          return [message];
        }) }
        : conversation));
    };
    try {
      const result = await modelport.streamChat(selectedModel.provider, selectedModel.id, history, requestId, (delta) => {
        if (activeRequestRef.current?.requestId !== requestId || !delta) return;
        receivedText += delta;
        setConversations((current) => current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, messages: conversation.messages.map((message) => message.id === assistantMessageId
            ? { ...message, content: message.content + delta }
            : message) }
          : conversation));
      });
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
      setConversationErrors((current) => ({ ...current, [conversationId]: errorMessage(error) }));
    } finally {
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
    if (!conversationId || !failedMessage || activeRequestRef.current) return;
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation?.messages[conversation.messages.length - 1]?.id !== failedMessage.id) return;
    if (draft.trim() && draft !== failedMessage.content
      && !window.confirm("输入框已有未发送内容，确定改为编辑失败的问题吗？")) return;

    setDraft(failedMessage.content);
    setConversations((current) => current.flatMap((item) => {
      if (item.id !== conversationId) return [item];
      const remaining = item.messages.filter((message) => message.id !== failedMessage.id);
      return remaining.length ? [{ ...item, messages: remaining }] : [];
    }));
    if (conversation.messages.length === 1) setActiveConversationId(null);
    setConversationErrors((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setChatError("");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

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
          <button aria-label="搜索会话" className="icon-button" disabled title="搜索功能正在开发" type="button"><Icon name="search" /></button>
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
            <button disabled title="资料库正在开发" type="button"><Icon name="library" /><span>我的资料</span></button>
            <button onClick={() => setConnectionCenterOpen(true)} type="button"><Icon name="settings" /><span>模型连接</span>{!configuredKeys.openai && !configuredKeys.deepseek && <span className="status-dot" />}</button>
            <button disabled title="帮助中心正在开发" type="button"><Icon name="help" /><span>帮助</span></button>
            <button className="muted" disabled type="button"><Icon name="info" /><span>关于（0.2.5）</span></button>
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
                <article className={`message ${message.role}`} key={message.id}>
                  {message.role === "assistant" && <div className="assistant-avatar"><Icon name="spark" size={18} /></div>}
                  <div className="message-bubble">
                    {message.role === "assistant"
                      ? message.content
                        ? <Suspense fallback={<span>正在排版回复…</span>}><MessageResponse key={message.id === streamingMessageId ? "streaming" : "static"} mode={message.id === streamingMessageId ? "streaming" : "static"}>{message.content}</MessageResponse></Suspense>
                        : message.id === streamingMessageId && <div aria-label="正在生成回复" className="typing"><span /><span /><span /></div>
                      : message.content}
                    {message.role === "assistant" && message.status === "stopped" && <span className="stream-note">已停止生成</span>}
                    {message.role === "assistant" && message.status === "failed" && <span className="stream-note">生成失败</span>}
                    {message.role === "assistant" && message.status === "interrupted" && <span className="stream-note">生成中断</span>}
                    {message.id === editableFailedMessage?.id && <span className="stream-note">{message.status === "stopped" ? "回复已停止" : message.status === "failed" ? "回复失败" : "回复中断"}</span>}
                  </div>
                </article>
              ))}
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
            <textarea
              aria-label="消息输入框"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              disabled={mode === "image"}
              placeholder={mode === "image" ? "图像生成即将开放" : "在这里输入你的问题..."}
              ref={textareaRef}
              rows={2}
              value={draft}
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button aria-label="添加附件" disabled title="附件功能正在开发" type="button"><Icon name="plus" size={21} /></button>
                <button aria-label="深度思考" disabled title="深度思考选项正在开发" type="button"><Icon name="brain" size={23} /></button>
                <button className="mode-button" disabled type="button"><Icon name="robot" size={22} /><span>{mode === "image" ? "绘图模式" : "对话模式"}</span></button>
                <button aria-label="添加文档" disabled title="文档功能正在开发" type="button"><Icon name="file" size={21} /></button>
                <button aria-label="对话参数" disabled title="参数设置正在开发" type="button"><Icon name="sliders" size={22} /></button>
              </div>

              <div className="composer-meta">
                <span className="context-count">{messages.length ? `${messages.length} 条消息` : "新对话"}</span>
                <div className="model-picker">
                  {modelMenuOpen && (
                    <div className="model-menu">
                      <div className="model-menu-title">选择模型</div>
                      {modelChoices.map((model) => (
                        <button className={selectedModel.id === model.id && selectedModel.provider === model.provider ? "selected" : ""} key={`${model.provider}:${model.id}`} onClick={() => { setSelectedModel(model); if (activeConversationId) setConversations((current) => current.map((conversation) => conversation.id === activeConversationId ? { ...conversation, model } : conversation)); setModelMenuOpen(false); setMode("chat"); setChatError(""); }} type="button">
                          <span className="model-logo" style={{ background: model.tone }}>{model.label}</span>
                          <span><strong>{model.name}</strong><small>{providerDetails[model.provider].name}</small></span>
                        </button>
                      ))}
                      <button className="manage-models" onClick={() => { setModelMenuOpen(false); setConnectionCenterOpen(true); }} type="button">管理模型连接</button>
                    </div>
                  )}
                  <button className="model-trigger" onClick={() => setModelMenuOpen((open) => !open)} type="button">
                    <span className="model-logo" style={{ background: selectedModel.tone }}>{selectedModel.label}</span>
                    <span>{selectedModel.name}</span>
                    <Icon name="chevron" size={18} />
                  </button>
                </div>
                {replying ? (
                  <button aria-label={stoppingRequestId ? "正在停止生成" : "停止生成"} className="send-button stop-button" disabled={stoppingRequestId !== null} onClick={() => void stopChat()} type="button"><span className="stop-symbol" /></button>
                ) : (
                  <button aria-label="发送消息" className="send-button" disabled={!draft.trim() || mode === "image"} type="submit"><Icon name="send" size={21} /></button>
                )}
              </div>
            </div>
          </form>
          <p className="disclaimer">AI 可能出错，请核实重要信息。对话记录仅保存在本机。</p>
        </div>
      </main>

      {connectionCenterOpen && (
        <ConnectionModal
          busy={connectionBusy}
          configuredKeys={configuredKeys}
          keyDraft={keyDraft}
          notice={connectionNotice}
          onClose={closeConnectionCenter}
          onKeyDraftChange={setKeyDraft}
          onRemove={() => void removeConnection()}
          onSave={() => void saveConnection()}
          onSelectProvider={(providerId) => {
            setSelectedProvider(providerId);
            setKeyDraft("");
            setConnectionNotice("");
          }}
          onTest={() => void testConnection()}
          selectedProvider={selectedProvider}
        />
      )}
    </div>
  );
}

export default App;
