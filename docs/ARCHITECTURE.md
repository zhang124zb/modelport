# 项目结构与更新约定

```text
modelport/
├─ src/                 React 界面、聊天状态和桌面命令调用
│  ├─ components/        可复用的界面组件
│  └─ lib/               模型连接封装与本地会话存储
├─ src-tauri/           Tauri 窗口、Rust 命令和 Windows 凭据访问
│  └─ src/connection.rs 云端及本地模型请求
├─ scripts/             可重复执行的构建脚本
├─ docs/                产品设计和维护文档
├─ release/             构建出的程序；由脚本生成，不提交到 Git
├─ package.json         前端脚本与依赖声明
├─ package-lock.json    前端依赖的锁定版本
└─ 启动 ModelPort.cmd    启动本机已构建的程序
```

## 数据流

- `src/App.tsx` 管理当前窗口中的对话、模型选择和连接设置。
- `src/lib/modelport.ts` 统一调用 Tauri 命令。Rust 命令在 `src-tauri/src/connection.rs` 中读取 Windows 安全凭据，并向固定的 OpenAI、DeepSeek 或本机 Ollama 地址发请求。
- `src/lib/chat-store.ts` 将对话保存在此应用的本机 WebView 数据中。聊天内容未加密，不写进 Git；API Key 不存入该数据。
- `src/components/ai-elements/` 和 `src/components/ui/` 是界面组件代码，修改时与业务逻辑分开审查。

## Git 中保存什么

源码、配置、文档、`package-lock.json` 和 `src-tauri/Cargo.lock` 需要提交，保证之后能复现同一组依赖。`node_modules/`、`dist/`、`src-tauri/target/` 和 `release/` 是生成内容，已被 Git 忽略。密钥通过系统凭据库管理；不要把真实密钥写入源码或配置文件。

建议每项功能从 `main` 建一个短分支，例如 `feature/conversation-search`。更新功能时同时修改相关文档和 `CHANGELOG.md`，运行 README 中的构建检查，再合并回 `main`。发布版由 `scripts/build-portable.ps1` 重建，`release/` 中的旧程序不会替代源码和版本记录。
