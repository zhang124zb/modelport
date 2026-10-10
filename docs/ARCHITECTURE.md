# 项目结构与更新约定

```text
modelport/
├─ src/                 React 界面、聊天状态和桌面命令调用
│  ├─ components/        实际接入的界面组件与回复渲染器
│  ├─ features/chat/     聊天持久化、请求生命周期与分页消息列表
│  ├─ features/connections/ 模型配置、发现、凭据操作的界面状态
│  ├─ features/settings/ 设置分类、页面接口与组件映射
│  └─ lib/               模型连接封装与本地会话存储
├─ src-tauri/           Tauri 窗口、Rust 命令和 Windows 凭据访问
│  └─ src/              connection.rs（模型请求）、skills.rs（技能库）
├─ scripts/             构建、便携打包、离线与隔离桌面回归脚本
├─ docs/                产品设计和维护文档
├─ release/             构建出的程序；由脚本生成，不提交到 Git
├─ package.json         前端脚本与依赖声明
├─ package-lock.json    前端依赖的锁定版本
└─ 启动 ModelPort.cmd    启动本机已构建的程序
```

## 数据流

- `providers.rs` 维护内置与自定义提供商的独立配置、模型列表和地址校验；`connection.rs` 按协议发送请求，Claude 使用原生 Messages / SSE，兼容服务复用 Chat Completions。API Key 仍只在系统凭据库中，接口及安全边界见 [模型提供商](./PROVIDERS.md)。
- `src/App.tsx` 负责窗口、输入区、资料选择与发送前检查，组合功能模块；不再直接承载聊天持久化、请求生命周期和提供商配置操作。
- `features/chat/useChatHistory.ts` 管理初始化、保存节流、存储告警与显式数据恢复；`useChatLifecycle.ts` 管理生成、停止、错误及 MCP 授权事件。单次活动请求标识在发送前设置，保留原生安全校验和一次性授权边界。
- `features/connections/useModelConnections.ts` 管理提供商、模型发现、连接测试和凭据操作；前端只读取密钥是否存在，不读取保存后的明文密钥。
- `src/lib/modelport.ts` 统一调用 Tauri 命令。Rust 命令在 `src-tauri/src/connection.rs` 中读取 Windows 安全凭据，并向内置官方地址、用户配置的兼容服务或本机 Ollama 发请求；前端不直接调用这些服务商。
- 文本回复通过 Tauri Channel 从 Rust 向前端逐段传递，`stream-batcher.ts` 约每 40 毫秒合并界面更新；完成、停止、错误及工具事件刷新末尾文本。命令结束返回完整文本和状态，用于核对最后一段。停止或失败时保留部分内容，未收到回复时可将用户问题送回输入框编辑后重试。
- 会话消息记录完成、停止、失败或意外中断状态；重启后仍能区分部分回复，构造下一次模型请求时跳过这些不完整助手回合。
- `src/lib/chat-store.ts` 将对话保存在此应用的本机 WebView 数据中：`modelport.chat.v2` 小索引引用独立会话记录，未改变的会话不重新序列化。先写新记录，最后提交索引，再清理旧版本；旧 v1 仅在保存成功后迁移。聊天未加密、不写进 Git，API Key 不存入该数据。容量与恢复边界见 [常规设置](./GENERAL_SETTINGS.md)。
- `features/chat/ConversationMessages.tsx` 默认渲染最近 80 条消息，按按钮加载更早记录并保留滚动位置；完整聊天仍在内存 / 存储中，模型上下文裁剪仍由对话设置负责。性能检查和低缓存模式见 [性能与构建缓存](./PERFORMANCE.md)。
- `src/components/ai-elements/message.tsx` 只保留使用中的 `MessageResponse`，Markdown 插件保持独立。未接入的分支 / 工具栏和旧 `components/ui/` 组件已移除，界面业务逻辑仍分开审查，第三方许可声明保留。
- 设置模块通过固定分类 ID 与统一页面参数扩展，开发接口见 [设置模块开发文档](./SETTINGS.md)。模型提供方页面复用现有连接组件与回调。
- 发送快捷键在独立页面配置，仍沿用原偏好存储；主界面一个稳定监听器处理固定组合。仅保存与新话题复用会话持久化和历史裁剪，本机搜索直接匹配记录，接口见 [键盘快捷键](./KEYBOARD_SHORTCUTS.md)。
- 常规设置独立保存在 `modelport.preferences.general.v1`，主题复用 `.dark` 约定，启动策略只在初始化时应用。聊天备份格式仍为 v1，导入创建副本，`useChatHistory` 中的数据操作先保存后更新状态；未扩展原生权限或依赖，接口见 [常规设置](./GENERAL_SETTINGS.md)。
- 默认模型独立保存在 `modelport.preferences.models.v1`，只保存提供方和模型 ID。空白启动、新建和清空共用解析函数，已有会话保持自己的模型；默认选择不在列表中时保留引用，不自动跨服务回退，接口见 [默认模型](./DEFAULT_MODELS.md)。
- 指令型技能在应用数据目录中独立保存，通过 UUID 与内容版本引用接入原生请求，接口和安全范围见 [Skills 文档](./SKILLS.md)。
- 聊天附件由 `attachments.rs` 保存独立副本，WebView 只保留元数据引用。原生解析本地副本并按提供方生成图片 / 文字内容；Ollama 实际能力检测、历史及备份边界见 [附件文档](./ATTACHMENTS.md)。文件选择和缩放复用浏览器能力，PNG / Base64 复用已存在的 Rust 依赖版本。
- `mcp.rs` 维护独立服务配置和凭据，提供受限 HTTP 工具发现、离线 Schema 验证和一次性授权；`stream_chat_mcp` 在原生侧持有参数、串行执行并回传完整惰性工具轮次。前端无法通过独立命令直接执行工具，普通聊天管线不授予 MCP 权限。边界与接口见 [MCP 文档](./MCP.md)。

## Git 中保存什么

源码、配置、文档、`package-lock.json` 和 `src-tauri/Cargo.lock` 需要提交，保证之后能复现同一组依赖。`node_modules/`、`dist/`、`src-tauri/target/` 和 `release/` 是生成内容，已被 Git 忽略。密钥通过系统凭据库管理；不要把真实密钥写入源码或配置文件。

建议每项功能从 `main` 建一个短分支，例如 `feature/conversation-search`。更新功能时同时修改相关文档和 `CHANGELOG.md`，运行 README 中的构建检查，再合并回 `main`。发布版由 `scripts/build-portable.ps1` 重建，`release/` 中的旧程序不会替代源码和版本记录。

桌面行为改动同时运行 `npm run test:desktop`，使用独立测试数据，不连接真实云端。打包采用固定白名单，ZIP 中的 `package-info.json` 区分基础 Git 提交与未提交修改，不把未提交工作误标为已有发布提交。操作与边界见 [桌面回归](./DESKTOP_TESTS.md) 和 [发布流程](./GITHUB.md)。
