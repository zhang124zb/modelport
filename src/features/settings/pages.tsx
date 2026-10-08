import type { ComponentType } from "react";
import { Icon } from "@/components/Icon";
import { ProviderSettings } from "@/components/ConnectionModal";
import type { ProviderSettingsProps } from "@/components/ConnectionModal";
import type { KnowledgeSettingsProps, ModelOption, SkillSettingsProps } from "@/lib/modelport";
import { SkillsSettingsPage } from "./SkillsSettingsPage";
import { KnowledgeSettingsPage } from "./KnowledgeSettingsPage";
import { ChatSettingsPage } from "./ChatSettingsPage";
import { KeyboardShortcutsPage } from "./KeyboardShortcutsPage";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { DefaultsSettingsPage } from "./DefaultsSettingsPage";
import type { ModelDefaults } from "@/lib/model-defaults";
import type { GeneralSettings } from "@/lib/general-settings";
import type { Conversation } from "@/lib/chat-store";
import type { ChatSettings } from "@/lib/chat-settings";
import type { SettingsSection, SettingsSectionId } from "./sections";

export type SettingsPageProps = SkillSettingsProps & KnowledgeSettingsProps & {
  section: SettingsSection;
  currentModel: ModelOption;
  modelChoices: readonly ModelOption[];
  providerProps: ProviderSettingsProps;
  chatSettings: ChatSettings;
  chatSettingsError: string;
  onSaveChatSettings: (settings: ChatSettings) => void;
  generalSettings: GeneralSettings;
  generalSettingsError: string;
  onSaveGeneralSettings: (settings: GeneralSettings) => void;
  modelDefaults: ModelDefaults;
  modelDefaultsError: string;
  onSaveModelDefaults: (settings: ModelDefaults) => void;
  chatData: readonly Conversation[];
  chatBusy: boolean;
  onExportChats: () => void;
  onImportChats: (conversations: readonly Conversation[]) => void;
  onClearChats: () => void;
  onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
};

function PlannedSettingsPage({ section }: SettingsPageProps) {
  return (
    <div className="settings-page">
      <div className="settings-feature-card">
        <div className="settings-feature-icon"><Icon name={section.icon} size={30} /></div>
        <h4>{section.label}</h4>
        <span className="settings-availability">即将开放</span>
        <p>此功能正在规划中，后续版本将在这里提供配置。</p>
      </div>
      <section className="settings-card" aria-label={`${section.label}规划内容`}>
        <h4>后续配置项</h4>
        <dl className="settings-details">
          {section.plannedFields.map((field) => <div key={field}><dt>{field}</dt><dd>待开放</dd></div>)}
        </dl>
      </section>
    </div>
  );
}

function AccountSettingsPage(props: SettingsPageProps) {
  return (
    <div className="settings-page">
      <section className="settings-account-card">
        <div className="settings-feature-icon"><Icon name="spark" size={30} /></div>
        <div><h4>ModelPort账户</h4><p>账户登录与同步功能尚未开放。</p></div>
        <button disabled type="button">登录 · 即将开放</button>
      </section>
      <section className="settings-card">
        <h4>现在就可以开始使用</h4>
        <p>无需登录即可连接本机 Ollama，或使用自己的云端 API Key。当前对话记录保存在本机。</p>
      </section>
      <section className="settings-card">
        <h4>账户功能规划</h4>
        <dl className="settings-details">
          {props.section.plannedFields.map((field) => <div key={field}><dt>{field}</dt><dd>待开放</dd></div>)}
        </dl>
      </section>
    </div>
  );
}

function ProvidersSettingsPage({ providerProps }: SettingsPageProps) {
  return <ProviderSettings {...providerProps} />;
}

// Each section has a stable entry point. Replace only its component when ready.
export const settingsPageComponents: Record<SettingsSectionId, ComponentType<SettingsPageProps>> = {
  account: AccountSettingsPage,
  providers: ProvidersSettingsPage,
  defaults: DefaultsSettingsPage,
  "web-search": PlannedSettingsPage,
  mcp: PlannedSettingsPage,
  knowledge: KnowledgeSettingsPage,
  skills: SkillsSettingsPage,
  agents: PlannedSettingsPage,
  documents: PlannedSettingsPage,
  chat: ChatSettingsPage,
  keyboard: KeyboardShortcutsPage,
  general: GeneralSettingsPage,
};
