import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ProviderSettingsProps } from "@/components/ConnectionModal";
import type { Conversation } from "@/lib/chat-store";
import { defaultModels, errorMessage, isDesktop, modelOption, modelport } from "@/lib/modelport";
import type { ModelOption, ProviderConfig, ProviderId } from "@/lib/modelport";
import { defaultProviderConfigs } from "@/lib/providers";

export function useModelConnections(initialConversations: readonly Conversation[], activeId: string | null,
  defaultModel: ModelOption, onError: Dispatch<SetStateAction<string>>) {
  const [selectedModel, setSelectedModel] = useState(() => initialConversations.find(conversation => conversation.id === activeId)?.model ?? defaultModel);
  const [modelChoices, setModelChoices] = useState<ModelOption[]>(() => {
    const choices = [...defaultModels];
    for (const { model } of initialConversations) {
      if (!choices.some(item => item.id === model.id && item.provider === model.provider)) choices.push(model);
    }
    return choices;
  });
  const [connectionCenterOpen, setConnectionCenterOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("ollama");
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>(defaultProviderConfigs);
  const [configuredKeys, setConfiguredKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [keyDraft, setKeyDraft] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  const clearConnectionDraft = () => { setKeyDraft(""); setConnectionNotice(""); };
  const closeConnectionCenter = () => { clearConnectionDraft(); setConnectionCenterOpen(false); };

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
        const retained = current.filter(model => model.provider === "ollama" || initialConversations.some(conversation => conversation.model.provider === model.provider && conversation.model.id === model.id));
        return [...discovered, ...retained.filter(model => !discovered.some(item => item.provider === model.provider && item.id === model.id))];
      });
    }).catch(error => { if (!disposed) onError(errorMessage(error)); });
    return () => { disposed = true; };
  }, [initialConversations, onError]);
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void modelport.listModels("ollama").then(ids => {
      if (cancelled) return;
      const discovered = ids.slice(0, 100).map(id => modelOption("ollama", id));
      if (!discovered.length) return;
      setModelChoices(current => [...discovered, ...current.filter(model => model.provider !== "ollama")]);
      setSelectedModel(current => current.provider === "ollama" && !current.id ? discovered[0] : current);
    }).catch(() => { /* Keep the local choice available when Ollama is offline. */ });
    return () => { cancelled = true; };
  }, []);

  const saveConnection = async () => {
    if (selectedProvider === "ollama") return;
    if (!isDesktop) { setConnectionNotice("请在 ModelPort 桌面应用中配置连接。"); return; }
    setConnectionBusy(true); setConnectionNotice("");
    try {
      await modelport.saveKey(selectedProvider, keyDraft);
      setConfiguredKeys(current => ({ ...current, [selectedProvider]: true })); setKeyDraft("");
      setConnectionNotice("API Key 已保存到系统安全凭据库。可点击“测试连接”获取模型列表。");
    } catch (error) { setConnectionNotice(errorMessage(error)); }
    finally { setConnectionBusy(false); }
  };
  const removeConnection = async () => {
    if (selectedProvider === "ollama" || !isDesktop) return;
    setConnectionBusy(true); setConnectionNotice("");
    try {
      await modelport.removeKey(selectedProvider); setConfiguredKeys(current => ({ ...current, [selectedProvider]: false }));
      setConnectionNotice("已从系统安全凭据库删除该服务的 API Key。");
    } catch (error) { setConnectionNotice(errorMessage(error)); }
    finally { setConnectionBusy(false); }
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
    setProviderConfigs(current => [...current, added]); setSelectedProvider(added.id); clearConnectionDraft();
  };
  const removeProviderConfig = async () => {
    const provider = selectedProvider;
    await modelport.removeProvider(provider);
    setProviderConfigs(current => current.filter(item => item.id !== provider));
    setModelChoices(current => current.filter(model => model.provider !== provider));
    setConfiguredKeys(current => { const updated = { ...current }; delete updated[provider]; return updated; });
    setSelectedProvider("ollama"); setKeyDraft("");
    setConnectionNotice("已删除自定义提供商及其密钥；聊天记录和原来的默认模型选择保留，需手动重新选择连接。");
  };
  const testConnection = async () => {
    if (!isDesktop) { setConnectionNotice("请在 ModelPort 桌面应用中测试连接。"); return; }
    setConnectionBusy(true); setConnectionNotice("");
    try {
      const ids = await modelport.listModels(selectedProvider);
      const filtered = selectedProvider === "openai" ? ids.filter(id => /^(gpt-|o\d|chatgpt-)/.test(id)) : ids;
      const validIds = filtered.filter(id => id.trim() && new TextEncoder().encode(id).length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(id));
      const config = providerConfigs.find(item => item.id === selectedProvider);
      if (!config) throw new Error("提供商已删除，请重新选择。");
      await saveProviderConfig({ ...config, models: [...new Set([...config.models, ...validIds])].slice(0, 100) });
      if (selectedProvider === "ollama" && validIds.length) setSelectedModel(current => current.provider === "ollama" && !current.id ? modelOption("ollama", validIds[0]) : current);
      setConnectionNotice(validIds.length === 0 ? "连接成功，但没有发现可用模型。" : `连接成功，发现 ${validIds.length} 个模型。`);
    } catch (error) { setConnectionNotice(errorMessage(error)); }
    finally { setConnectionBusy(false); }
  };
  const providerSettingsProps: ProviderSettingsProps = {
    configs: providerConfigs, onSaveConfig: saveProviderConfig, onAddProvider: addProviderConfig, onDeleteProvider: removeProviderConfig,
    busy: connectionBusy, configuredKeys, keyDraft, notice: connectionNotice, onKeyDraftChange: setKeyDraft,
    onRemove: removeConnection, onSave: saveConnection, onTest: testConnection, selectedProvider,
    onSelectProvider: provider => { setSelectedProvider(provider); clearConnectionDraft(); },
  };
  return { selectedModel, setSelectedModel, modelChoices, providerConfigs, configuredKeys, setSelectedProvider,
    connectionCenterOpen, setConnectionCenterOpen, closeConnectionCenter, clearConnectionDraft, providerSettingsProps };
}
