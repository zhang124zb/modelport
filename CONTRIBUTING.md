# 贡献指南

感谢你帮助改进 ModelPort。当前主要验证目标是 Windows 桌面端，技术栈为 Tauri 2、Rust、React 和 TypeScript。开发环境和构建步骤见 [README](./README.md)。

## 提交问题

- 普通缺陷或功能建议使用 GitHub Issues 模板，先检索是否已有相同问题。
- 写明应用版本、Windows 版本、复现步骤、预期和实际结果。
- 日志与截图必须去掉 API Key、MCP 令牌、私人端点、聊天内容、文件内容及个人信息。不要上传真实聊天备份。
- 安全漏洞不要在公开 Issue 中披露，按 [安全政策](./SECURITY.md)私密报告。

## 修改与拉取请求

从最新 `main` 创建一个范围明确的分支，例如 `fix/window-drag` 或 `feature/mcp-status`。保持修改聚焦，优先复用现有接口；不要顺手改动无关文件或引入不必要依赖。

提交前至少执行：

```powershell
npm ci
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
npm run check:repo
git diff --check
```

涉及窗口行为、模型请求、凭据或工具授权时，还需要相应的桌面回归检查。使用独立、空白的测试数据目录和本机模拟服务；任何真实云端请求都必须由测试者明确同意并自行承担费用。缺少测试环境时，在 PR 中写明没有验证的项目，不能把模拟测试描述成真实服务验证。

同步更新受影响的 `docs/` 文档及 `CHANGELOG.md`。版本号、发布和标签由维护者协调，不要求每个 PR 单独升级版本。

提交前审阅暂存区，尤其是新文件。提交源码、文档及锁文件，不提交 `node_modules/`、`dist/`、`src-tauri/target/`、`release/`、本机配置、凭据、用户数据或聊天备份。新增第三方复制代码需要保留来源和许可证声明。

## 不可削弱的安全边界

- 云端 API Key 和 MCP 令牌由原生系统凭据库保存，不放进 WebView 普通配置、日志、备份或源码。
- 保留端点校验、超时、参数验证、结果限额和拒绝路径。MCP 的每次调用都必须经过用户确认，不能用模型输出代替授权。
- 外部工具、技能和资料都是不可信输入；工具描述或“只读”标签不构成权限保证。
- 备份导入和历史恢复不能重放工具操作；停止生成不能声称撤销外部动作。
- 不把前端通用命令执行权限、自动下载安装或真实密钥作为测试捷径。

这些原则的具体实现见 [MCP](./docs/MCP.md)、[模型提供商](./docs/PROVIDERS.md)、[Skills](./docs/SKILLS.md)和[附件](./docs/ATTACHMENTS.md)文档。

通过提交贡献，你确认有权提供这些修改，并同意自有新增代码按项目的 [MIT 许可证](./LICENSE)分发；第三方原有许可证仍须保留。不要求贡献者提供真实 API Key 或私密数据。
