# 设置模块开发接口

设置入口位于应用左下角。“设置”打开原生模态对话框，共 12 个分类；首项显示为“ModelPort账户”，末尾新增“键盘快捷键”和“常规设置”。原生对话框负责背景遮罩、焦点范围和 Escape 关闭；分类栏可滚动，切换后确保选中项在可见区域。

## 文件与入口

- `src/features/settings/sections.ts`：分类顺序、固定 ID、名称、图标、说明和后续配置项。
- `src/features/settings/pages.tsx`：`SettingsPageProps` 页面接口和 `settingsPageComponents` 分类到组件的映射。
- `src/features/settings/SettingsDialog.tsx`：分类切换、弹窗打开/关闭与公共页面布局。
- `src/features/settings/settings.css`：独立的设置界面样式。
- `src/features/settings/ChatSettingsPage.tsx`、`src/lib/chat-settings.ts`：对话偏好表单、保存与输入 / 展示 / 上下文逻辑。
- `src/features/settings/KeyboardShortcutsPage.tsx`、`src/lib/keyboard-shortcuts.ts`：发送方式表单、固定组合和主界面按键判定；沿用对话偏好存储以保留旧发送配置。
- `src/components/ConnectionModal.tsx`：可复用的 `ProviderSettings` 与 `ProviderSettingsProps`，供设置页和原来的模型连接弹窗共同使用。

## 分类 ID

| 固定 ID | 显示名称 | 当前状态 |
| --- | --- | --- |
| `account` | ModelPort账户 | 账户功能预留页 |
| `providers` | 模型提供方 | 已接入现有凭据管理、连接测试和模型发现 |
| `defaults` | 默认模型 | 查看默认本地模型和当前对话模型；修改默认策略待开放 |
| `web-search` | 联网搜索 | 搜索服务与搜索策略预留页 |
| `mcp` | MCP | 服务配置、连接测试与工具授权预留页 |
| `knowledge` | 知识库 | 已接入 TXT / Markdown 导入、分段、检索测试、启用 / 禁用与资料管理 |
| `skills` | Skills | 已接入本地指令技能的新建、导入、GitHub 预览安装、编辑、启用/禁用与删除 |
| `agents` | 智能体 | 角色、模型与工具预留页 |
| `documents` | 文档解析器 | 解析服务、格式与分块预留页 |
| `chat` | 对话设置 | 已接入历史轮数、全局提示词、回复格式、消息字号及本地保存 |

新增固定 ID：`keyboard`（键盘快捷键，实际配置与操作已接入），`general`（常规设置，预留语言与地区、主题与外观、启动行为、数据管理）。

固定 ID 用于组件映射；后续增加持久化配置或路由时可沿用，显示名称可以独立调整。

## 页面参数

每个页面实现 `SettingsPageProps`，从父层接收：

- `section`：当前分类元数据。
- `currentModel`：当前对话或输入框选中的模型。
- `modelChoices`：当前已知的可选模型。
- `providerProps`：现有连接状态与操作回调，包括选择提供方、密钥输入、保存/删除凭据、测试连接。
- `skills`、`skillsLoading`、`skillsError`、`onSkillsChanged`：共享技能库摘要与刷新状态。
- `knowledgeBases`、`knowledgeLoading`、`knowledgeError`、`onKnowledgeChanged`：知识库摘要与刷新状态。
- `chatSettings`、`chatSettingsError`、`onSaveChatSettings`：已保存对话配置、读取警告与保存回调；失败时不改变生效值。
- `onRegisterLeaveGuard`：可选的表单退出确认，用于阻止未保存技能被误关闭。

页面组件在模块顶层声明。开发某一项时，将该项在 `settingsPageComponents` 中的值替换为新组件即可；不需要修改主聊天界面或其他分类。公共导航保持不变，页面自己的表单状态放在对应组件中。

目前“模型提供方”、“Skills”、“知识库”、“对话设置”和“键盘快捷键”执行实际设置操作；用法和接口见 [Skills 使用与开发](./SKILLS.md)、[知识库使用与开发](./KNOWLEDGE.md)、[对话设置](./CHAT_SETTINGS.md) 和 [键盘快捷键](./KEYBOARD_SHORTCUTS.md)。其他未开放分类保留规划说明，不发送未实现的后端命令，不写入虚假的账户或配置状态。

常规设置开发时，新增 `GeneralSettingsPage.tsx` 并替换 `settingsPageComponents.general`；沿用 `sections.ts` 中的固定 ID 与规划项。实际字段和存储仅在对应功能实现时增加，需原生能力时再扩展页面参数和权限；不要提前写入无效开关。

## 后续接入约定

1. 在设置目录增加具体功能页面，并接入上述组件映射。
2. 需要原生服务时，在 `src/lib/` 中封装前端调用，在 `src-tauri/src/` 中实现并注册命令；只为已实现功能增加权限。
3. 持久化配置采用独立且带版本的存储结构，与聊天记录分开；API Key 继续保存在系统安全凭据库。
4. 更新分类状态与本文件，并运行 `scripts/verify-desktop.mjs` 检查导航、弹窗关闭和原有连接流程。
