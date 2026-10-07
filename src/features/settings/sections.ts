import type { IconName } from "@/components/Icon";

export const settingsSections = [
  { id: "account", label: "ModelPort账户", icon: "spark", description: "管理你的 ModelPort 账户与同步偏好。", plannedFields: ["账户登录", "个人资料", "同步偏好"] },
  { id: "providers", label: "模型提供方", icon: "providers", description: "连接云端 API 或本机 Ollama，管理模型与安全凭据。", plannedFields: [] },
  { id: "defaults", label: "默认模型", icon: "cube", description: "查看新对话使用的默认模型。", plannedFields: [] },
  { id: "web-search", label: "联网搜索", icon: "globe", description: "为对话配置搜索服务与信息来源。", plannedFields: ["搜索服务", "结果数量", "搜索触发方式"] },
  { id: "mcp", label: "MCP", icon: "mcp", description: "连接外部工具与 MCP 服务。", plannedFields: ["服务管理", "连接测试", "工具授权"] },
  { id: "knowledge", label: "知识库", icon: "book", description: "管理可用于对话的本地资料与知识库。", plannedFields: ["资料导入", "索引模型", "检索设置"] },
  { id: "skills", label: "Skills", icon: "wand", description: "管理可复用的任务技能与指令。", plannedFields: ["技能导入", "启用状态", "技能权限"] },
  { id: "agents", label: "智能体", icon: "robot", description: "创建具有独立角色、模型与工具的智能体。", plannedFields: ["角色指令", "智能体模型", "可用工具"] },
  { id: "documents", label: "文档解析器", icon: "document", description: "配置文档读取、文本提取与分块方式。", plannedFields: ["解析服务", "文件格式", "分块策略"] },
  { id: "chat", label: "对话设置", icon: "chat", description: "调整输入方式、历史上下文、基础指令与回复展示。", plannedFields: [] },
] as const satisfies readonly { id: string; label: string; icon: IconName; description: string; plannedFields: readonly string[] }[];

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionId = SettingsSection["id"];
