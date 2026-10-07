# Skills 使用与开发

ModelPort 0.3.1 支持指令型技能和公开 GitHub 仓库安装。它把选中技能的任务指导交给当前模型，不提供脚本执行或文件操作能力。

## 使用方法

1. 打开“设置 → Skills”，新建技能、从模板创建，或导入单个 `SKILL.md`。
2. 填写显示名称，编辑 YAML 元数据与 Markdown 正文；点击“检查并预览”查看格式检查结果。
3. 保存并审阅内容后启用。新建、首次导入及导入替换的项目默认禁用；启用不会自动应用到所有聊天。
4. 关闭设置，在聊天输入区的“技能”下拉框选择一个技能，再发送消息。选择“无技能”或点击清除按钮可停止使用。

每个会话最多选一个技能，新对话默认无技能。历史消息显示当时选用的名称和内容版本；这不是模型必然遵循所有指令的保证。特别是较小的本地模型可能模仿旧回复，更换技能时建议新建对话。

已绑定技能修改后，发送前会提示确认新版；原消息标记不更改。禁用或删除技能会清除已打开应用中对应会话的选择，不删除聊天记录。其他应用实例的状态可能尚未刷新，但原生层会拒绝过期、已禁用或已删除的引用。编辑后重试使用当前技能配置，不承诺旧版指令的完整重放。

## 从 GitHub 安装

1. 在“设置 → Skills”点击“从 GitHub 安装”。
2. 填写仓库首页地址（`https://github.com/作者/仓库`）或 `作者/仓库`；不要填 `blob` / `tree` 文件链接。
3. 分支可留空使用默认分支，也可填写分支、标签或提交；文件路径填写仓库内相对路径，例如 `skills/translation/SKILL.md`，根目录文件使用 `SKILL.md`。
4. 点击“获取安装预览”，检查原文、兼容要求和来源提交；必要时修改显示名称。安装前原文只读，安装后可本地编辑。
5. 点击“安装技能”。同名项目先确认替换；新装和替换均默认禁用，审阅启用后才能在聊天中选择。

仅支持公开 GitHub.com 仓库，不需要 Git、GitHub 登录或访问令牌。不会克隆整个仓库、下载压缩包、访问关联资源或执行脚本；需要这些能力的上游技能可能只能部分生效。不做自动更新，需要新版本时重新获取预览并确认替换。来源和固定提交保存到本地库，本地编辑会标记“本地已编辑”。

预览通过 [GitHub 提交接口](https://docs.github.com/en/rest/commits/commits#list-commits) 解析默认/指定分支的提交，再通过 [内容接口的原文模式](https://docs.github.com/en/rest/repos/contents#get-repository-content) 获取该提交的单个文本文件；安装再次获取同一提交并核对 SHA-256。网络操作不持有技能库锁。只访问固定 HTTPS `api.github.com` 域名，不跟随重定向、不携带模型 API Key、不跳过证书校验；网络请求有超时，响应逐块限制大小。GitHub 访问受限时明确报错，原数据不动，可下载 `SKILL.md` 后本地导入。

## 格式与边界

采用 `SKILL.md` 的 YAML 元数据头和 Markdown 正文，必填 `name`、`description`。原文保留合法额外元数据；它们不会转换为工具权限。[Agent Skills 格式规范](https://agentskills.io/specification)

- `name`：1–64 个小写英文字母、数字或短横线，不允许首尾短横线或连续短横线。中文名称填写在“显示名称”。
- `description`：非空，不超过 1024 个字符；`compatibility` 若提供，不超过 500 个字符。
- 导入必须为 UTF-8，支持 BOM、Windows 换行和多行描述。YAML 重复键、自定义标签、锚点/别名、合并键和过度复杂结构明确拒绝。
- 单文件最多 128 KiB，指令正文最多 64 KiB，技能库最多 200 项和 8 MiB；超限拒绝，不静默截断。这不保证所有模型都能容纳相同长度的指令。
- 只支持单个文件，不导入目录或压缩包；不执行 `scripts/`，不读取 `references/` / `assets/`，不按 `allowed-tools` 授权。
- 同名导入会要求确认替换，保留内部 ID，替换后重新禁用。原始导入文件不改动。
- 云端模型会收到当前选中技能的正文；其他技能、来源路径和 YAML 元数据不会随技能请求发送。API Key 仍由原生层从 Windows 安全凭据库读取。

## 存储和请求流程

库文件位于 Tauri 解析的应用数据目录下：`skills/skills-state.v1.json`。JSON 同时保存原始 `SKILL.md`、稳定 UUID、显示名称、启用状态和来源。技能内容未加密，不存入 Git 或程序发布目录。

这是相对原规划的实现简化：单一库文件取代“目录内指令文件 + 单独索引”，避免两份数据更新中断时不同步。文件使用进程间锁、同目录临时文件、刷新后原子替换；损坏数据不会被静默清空或覆盖。不缓存整个库，按访问校验受限的库数据。

内容版本是显示名称与原文的 SHA-256 摘要。前端发送可选的 `skill: { id, revision }`，Rust 按登记的 ID 读取正文，检查存在性、启用状态及版本，然后在历史消息前加入本次技能指导。原文在该次请求内固定。没有技能时，不额外访问库，也不改变原有模型请求结构。

历史消息仍只允许 `user` / `assistant`；前端不能提交任意 `system` 消息或磁盘路径。`send_chat` 和 `stream_chat` 共用校验、技能注入和请求正文组装。

## 开发入口

- `src/features/settings/SkillsSettingsPage.tsx`：列表、筛选、编辑、导入预览、确认与未保存提醒。
- `src/features/settings/SettingsDialog.tsx`：页面退出保护；Skills 表单通过 `onRegisterLeaveGuard` 阻止误关闭或误切换分类，并监听原生窗口关闭请求保护未保存编辑。
- `src/features/settings/useSettingsLeaveGuard.ts`：Skills 与知识库共用的设置 / 原生窗口退出保护。
- `src/App.tsx`：技能库摘要、会话选择、聊天入口、版本更新确认和禁用后的选择清理。
- `src/lib/modelport.ts`：数据类型和 Tauri 调用。
- `src/lib/chat-store.ts`：可选会话/消息技能标记，兼容旧记录。
- `src-tauri/src/skills.rs`：受限 YAML 解析、技能库读写、GitHub 来源保存和引用解析。
- `src-tauri/src/local_data.rs`：与知识库共用的路径检查、进程间锁和受限原子 JSON 保存。
- `src-tauri/src/github_skills.rs`：仓库/路径校验、固定域名联网下载、固定提交预览和安装。
- `src/features/settings/GitHubSkillInstaller.tsx`：公开仓库地址、分支及文件路径表单；复用 Skills 页的审阅、确认及退出保护。
- `src-tauri/src/connection.rs`：普通/流式请求共用的技能注入逻辑。

原生命令：

- `preview_skill(document)`：格式检查和指令正文预览，无文件写入。
- `list_skills()`、`get_skill(id)`：摘要列表和原文详情。
- `save_skill(id?, expectedRevision?, document, displayName, imported)`：新建/编辑/导入复用一次受保护保存；更新必须提供预期版本。
- `set_skill_enabled(skill, enabled)`、`remove_skill(skill)`：校验版本后更改状态或删除。
- `preview_github_skill(repository, gitRef, path)`：只读联网预览，返回 `document`、`preview` 和 `origin: { repository, path, commit, documentHash }`。
- `install_github_skill(origin, displayName, id?, expectedRevision?)`：重取固定提交、复核摘要、受保护安装；替换必须提供当前技能版本。前端不能提交待安装原文或任意下载地址。

`SettingsPageProps` 增加 `skills`、`skillsLoading`、`skillsError`、`onSkillsChanged`，用于共享技能摘要和刷新状态。原有分类映射方式保持不变。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：解析、损坏库保护、CRUD、旧版本拒绝、无技能兼容和请求注入。
- `node scripts/verify-skills.mjs <调试端口> [截图路径]`：真实桌面 UI、文件输入、启用/禁用、版本确认、会话恢复、Ollama 实际回复、小窗口和未保存保护。
- `node scripts/verify-desktop.mjs <调试端口>`：原有设置分类、模型连接、遮罩及默认 Ollama 回归。
- `node scripts/verify-github-skills.mjs <调试端口> [截图路径]`：公开 GitHub 实际下载、预览、安装、来源恢复、同名替换、默认禁用、失败不写入及小窗口布局。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib live_public_repository_preview -- --ignored`：显式运行只读的公开仓库联网测试；默认离线测试跳过这一项。

桌面脚本必须针对使用独立 `WEBVIEW2_USER_DATA_FOLDER` 且开启本机调试端口的测试实例运行；它会拒绝已有聊天的配置，结束后移除本次创建的技能并恢复原测试聊天状态，不修改预先存在的技能。调试端口只用于测试，不是普通启动方式。云端付费请求没有自动测试。

后续仍待实现：私有仓库认证、自动更新、自动激活、多技能叠加、关联资源读取、工具执行与技能市场。增加这些能力时应单独设计授权与执行隔离，不放宽本模块的文本边界。
