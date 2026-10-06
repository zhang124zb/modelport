# ModelPort

ModelPort（模型港）是一款本地优先的多模型 AI 桌面客户端。软件本身不提供模型能力，用户可以连接自己的云端 API Key，或使用 Ollama 等本地模型服务。

![ModelPort 当前界面预览](./ui-current.png)

## 当前进度

当前版本是可本地启动的文本对话版本，已经包含：

- 自动保存的本地会话、会话切换与删除
- 新对话与图像生成入口
- 多模型选择菜单
- 向 OpenAI、DeepSeek 和本机 Ollama 发送真实文本对话
- 逐段显示模型回复，并可在回复过程中停止生成；停止后保留已收到的内容
- 请求失败时保留已发送的用户问题并显示错误；未收到回复时可点“编辑并重试”修改后再发送
- 模型连接测试和可用模型发现
- 空白新对话默认连接本机 Ollama，并在启动时自动读取已安装模型；打开历史对话时沿用该对话的模型
- Windows 安全凭据库中的云端 API Key 保存与删除
- AI 回复的 Markdown 渲染
- 自定义桌面标题栏、窗口拖动和窗口控制
- 不同窗口尺寸下的响应式布局
- 两栏设置中心：ModelPort账户、模型提供方、默认模型、联网搜索、MCP、知识库、Skills、智能体、文档解析器和对话设置；后续功能带独立开发入口

当前只支持固定的 OpenAI、DeepSeek 官方 API 地址和本机 Ollama（`127.0.0.1:11434`）。Anthropic、图像生成、附件、重新生成和自动重试尚未接入；界面会明确标识尚不可用的入口。会话保存在本机 WebView 数据中，重启后保留；停止或中断的部分回复会保留标记，不作为下一次请求的完整助手回复。聊天内容未加密，API Key 仍单独保存在 Windows 安全凭据库。

如果只通过浏览器打开前端预览，可以查看界面，但真实模型请求必须在 Tauri 桌面窗口中运行。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust

## 获取源码与开发

在 Windows 上，先按 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)安装 Node.js、Rust 的 MSVC 工具链、Microsoft C++ Build Tools（含 Windows SDK）及 WebView2。克隆仓库后，在 PowerShell 中运行：

```powershell
git clone <仓库地址> modelport
cd modelport
npm ci
npm run tauri dev
```

`npm ci` 根据已提交的 `package-lock.json` 安装前端依赖；后续依赖未变化时，无需每次启动都重装。仅预览界面可运行 `npm run dev`；检查前端生产构建可运行 `npm run build`。浏览器预览无法发送真实模型请求。

## 构建可双击启动的 Windows 程序

在项目根目录的 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
```

脚本会调用 Tauri 构建，并将程序放到 `release/ModelPort.exe`。之后双击 [启动 ModelPort.cmd](./启动%20ModelPort.cmd) 即可运行，无需开发服务器。`release/` 中的程序和 `src-tauri/target/` 中的编译缓存不属于源码，Git 会忽略它们。运行该程序的 Windows 电脑需要 WebView2 运行时。

若 `release/ModelPort.exe` 已存在且内容不同，脚本会停止，保护旧文件。确认更新时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1 -ReplaceExisting
```

脚本会先把旧程序移入 `release/archive/`，再放入新程序；若新旧文件相同，则直接结束。

## 桌面回归检查

本机 Ollama 已运行并安装模型时，可用 Node.js 24 和独立 WebView 数据目录检查默认模型、弹窗遮罩、新建对话和历史模型恢复：

```powershell
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP ('modelport-check-' + [guid]::NewGuid().ToString('N'))
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9342 --remote-allow-origins=*'
Start-Process -FilePath "$PWD\release\ModelPort.exe"
Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER, Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
node scripts/verify-desktop.mjs 9342
```

检查脚本只允许空白的测试数据目录，不会在含真实历史记录的窗口中运行。完成后关闭测试窗口，双击正常启动文件即可。

## 后续更新

如果你修改过源码，先将改动提交到自己的 Git 分支。拉取新版本后，再安装锁文件指定的依赖并构建：

```powershell
git pull --ff-only
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1 -ReplaceExisting
```

本地聊天记录留在应用的 WebView 数据中，API Key 留在 Windows 安全凭据库；Git 只用于管理源码与构建脚本。当前仓库没有远程地址时，先完成初始提交并设置远程仓库，再使用上面的克隆和拉取流程。

## 设计原则

- 本地优先：会话、配置和凭据尽可能留在用户设备上。
- 自带密钥：用户决定接入哪个服务商，并清楚知道请求发送到哪里。
- 模型中立：同一个对话界面可以切换云端模型和本地模型。
- 安全默认：API Key 进入 Windows 安全凭据库，不写入普通配置文件或聊天记录。

源码模块和 Git 更新流程见 [项目结构文档](./docs/ARCHITECTURE.md)；设置扩展接口见 [设置模块开发文档](./docs/SETTINGS.md)；功能范围与后续计划见 [产品设计文档](./docs/PRODUCT_DESIGN.md)。
