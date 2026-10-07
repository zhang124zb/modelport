import type { ComponentType } from "react";
import { Icon } from "@/components/Icon";
import { ProviderSettings } from "@/components/ConnectionModal";
import type { ProviderSettingsProps } from "@/components/ConnectionModal";
import type { KnowledgeSettingsProps, ModelOption, SkillSettingsProps } from "@/lib/modelport";
import { SkillsSettingsPage } from "./SkillsSettingsPage";
import { KnowledgeSettingsPage } from "./KnowledgeSettingsPage";
import type { SettingsSection, SettingsSectionId } from "./sections";

export type SettingsPageProps = SkillSettingsProps & KnowledgeSettingsProps & {
  section: SettingsSection;
  currentModel: ModelOption;
  modelChoices: readonly ModelOption[];
  providerProps: ProviderSettingsProps;
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

function DefaultsSettingsPage({ currentModel, modelChoices }: SettingsPageProps) {
  const localModel = modelChoices.find((model) => model.provider === "ollama" && model.id);
  return (
    <div className="settings-page">
      <section className="settings-card">
        <h4>新对话默认模型</h4>
        <dl className="settings-details">
          <div><dt>模型提供方</dt><dd>本机 Ollama</dd></div>
          <div><dt>可用默认模型</dt><dd>{localModel?.name ?? "尚未发现本地模型"}</dd></div>
        </dl>
        <p>空白启动与新对话优先使用本机模型。可在“模型提供方”中获取已安装的模型。</p>
      </section>
      <section className="settings-card">
        <h4>当前对话模型</h4>
        <p className="settings-model-name">{currentModel.name}</p>
        <p>已有对话沿用各自保存的模型，可在聊天输入框旁的模型菜单中切换。</p>
      </section>
      <section className="settings-card">
        <h4>更多默认模型选项</h4>
        <p>后续将在这里开放对话、搜索与文档等功能的默认模型配置。</p>
        <span className="settings-availability">即将开放</span>
      </section>
    </div>
  );
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
  chat: PlannedSettingsPage,
};
