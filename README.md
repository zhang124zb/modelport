# ModelPort

ModelPort（模型港）是一款本地优先的多模型 AI 桌面客户端。软件本身不提供模型能力，用户可以连接自己的云端 API Key，或使用 Ollama 等本地模型服务。

当前版本：**0.12.0**。目前仅在 Windows x64 桌面环境验证；不承诺 macOS / Linux 可用。

[使用与开发](#获取源码与开发) · [GitHub 上传与发布](./docs/GITHUB.md) · [贡献指南](./CONTRIBUTING.md) · [安全政策](./SECURITY.md) · [更新记录](./CHANGELOG.md) · [MIT 许可证](./LICENSE)

![ModelPort 当前界面预览](./ui-current.png)

## 下载与启动

从 [最新发布页](https://github.com/zhang124zb/modelport/releases/latest) 获取 Windows x64 便携包，也可 [直接下载 0.12.0 ZIP](https://github.com/zhang124zb/modelport/releases/download/v0.12.0/ModelPort-0.12.0-windows-x64.zip)。源码仓库不存放可执行文件；程序包通过 Releases 单独分发。

下载后先完整解压，再双击“启动 ModelPort.cmd”或“ModelPort.exe”。无需安装 Node.js 或 Rust，但 Windows 需要 WebView2 运行时。请只从可信发布来源获取程序，核对同一发布页中的 SHA-256；当前没有代码签名或签名安装包保证，不能为了运行程序关闭系统防护。

启动文件支持同目录的 `ModelPort.exe`，也支持源码目录下的 `release/ModelPort.exe`；只克隆源码后不能直接双击启动。自己编译的步骤见下文。

## 当前进度

当前版本是可本地启动的聊天版本，已经包含：

- 分会话保存的本地聊天、会话切换与删除；长对话按需加载更早消息
- 新对话与图像生成入口
- 多模型选择菜单
- 向 OpenAI、DeepSeek、Google Gemini、Anthropic Claude、通义千问、Kimi、本机 Ollama 及自定义 OpenAI 兼容服务发送真实文本对话
- 附件菜单、图片预览与视觉模型识图、TXT / Markdown 文件问答；Ollama 按实际能力拦截不支持识图的模型，视频和未支持格式弹出提示
- 逐段显示模型回复，并可在回复过程中停止生成；停止后保留已收到的内容
- 请求失败时保留已发送的用户问题并显示错误；未收到回复时可点“编辑并重试”修改后再发送
- 模型连接测试和可用模型发现；提供商独立模型列表支持手动新增、移除、重置，重启后保留
- 多个自定义提供商：名称、API 主机 / 路径、独立密钥、地址预览、HTTP/1.1 兼容与确认删除
- 可在“默认模型”选择并保存各提供商的模型，用于空白启动和新对话；未设置时使用本机 Ollama，历史会话沿用自己的模型
- Windows 安全凭据库中的云端 API Key 保存与删除
- AI 回复的 Markdown 渲染
- 自定义桌面标题栏、窗口拖动和窗口控制
- 不同窗口尺寸下的响应式布局
- 两栏设置中心：模型提供方、默认模型、MCP、知识库、Skills、对话设置、键盘快捷键和常规设置；ModelPort 账户、联网搜索、智能体、文档解析器目前为预留入口
- 本地指令型 Skills：新建、单文件导入、从公开 GitHub 仓库预览安装、编辑、启用/禁用、删除，以及会话级技能选择和版本提示
- 本地文本知识库：批量 TXT / Markdown 导入、资料管理、检索预览、聊天选择与来源快照；首版采用关键词检索，不下载额外模型
- 技能与知识库在输入区同排选择，齿轮打开各自管理页；长名称悬停可查看完整名称
- 对话设置：最近完整问答轮数、全局提示词、Markdown / 纯文本和字号；本地保存、恢复默认及未保存退出提醒
- 键盘快捷键：两种发送方式、新对话 / 新话题、循环会话切换、编号跳转与本机会话搜索；发送方式已从对话设置迁入本页，旧配置保持有效
- 常规设置：浅色 / 深色 / 跟随系统、动画、启动会话和侧栏偏好；JSON 聊天备份导出、预览合并导入及确认清空
- MCP HTTP 外部工具：服务与独立令牌管理、只发现工具的连接测试、会话级选择、逐次授权、顺序调用、停止和惰性历史记录

内置服务使用官方 API 地址，自定义服务首版支持 OpenAI Chat Completions 兼容协议（不是任意网页地址）。图像生成、视频、PDF / Word、思考过程展示、重新生成和自动重试尚未接入。Kimi 与自定义服务的视觉能力暂未确认，图片入口会提示；文字附件可正常使用。会话保存在本机 WebView 数据中，重启后保留；停止或中断的部分回复会保留标记，不作为下一次请求的完整助手回复。聊天内容未加密，API Key 单独保存在 Windows 安全凭据库。配置、安全边界和地区选择见 [模型提供商文档](./docs/PROVIDERS.md)。

如果只通过浏览器打开前端预览，可以查看界面，但真实模型请求必须在 Tauri 桌面窗口中运行。

MCP 服务默认停用，新对话默认不选择工具，每次实际调用都先展示服务、完整参数和结果接收方供用户确认。只有支持工具调用的模型可用，Claude 原生工具调用、stdio 和 OAuth 尚未开放。工具可能操作真实数据；逐次确认不是系统沙箱，停止不能保证撤销外部操作。参数和结果可能进入未加密的聊天及备份。发布版禁止远程脚本和远程图片；完整边界见 [MCP 文档](./docs/MCP.md)。

Skills 首版只支持指令内容，不执行脚本或读取关联资源；云端模型会收到当前选中的技能正文。本地技能库未加密，保存在应用数据目录。使用与开发接口见 [Skills 文档](./docs/SKILLS.md)。

知识库资料未加密，保存在独立应用数据目录。只发送命中片段，每次云端知识库请求前确认；未命中且没有附加文件时不调用模型。当前仅支持 UTF-8 的 TXT / Markdown，不支持 PDF / Word 或向量语义检索。用法和接口见 [知识库文档](./docs/KNOWLEDGE.md)。

聊天附件独立保存本地副本，图片不塞进聊天文字存储。每条最多 4 个，云端发送前确认，失败重试保留附件；JSON 聊天备份仅含附件引用，不含原件。常规设置可明确确认后清理闲置副本，原文件不变。用法和限额见 [附件文档](./docs/ATTACHMENTS.md)。

对话设置保存在独立的本机 WebView 配置中。默认携带最近 20 轮完整问答，停止 / 失败的回复不参与历史上下文；数量上限不代表 Token 容量。提示词会随请求发送给选中的模型，用法和生效时机见 [对话设置文档](./docs/CHAT_SETTINGS.md)。

默认 Enter 发送、Shift + Enter 换行、Ctrl + Enter 仅保存而不生成回复。仅保存消息后续可能作为上下文发送；Ctrl + Shift + N 开启新话题，不删除记录但不携带此前聊天。完整组合与开发入口见 [键盘快捷键文档](./docs/KEYBOARD_SHORTCUTS.md)。

常规设置单独保存在本机，默认浅色、恢复上次会话及展开侧栏。外观保存后立即生效，启动偏好用于下次打开软件；备份只包含聊天与历史来源片段，未加密。合并导入不覆盖现有会话，清空不可直接撤销，请先导出；不会删除 API Key、技能或知识库。多语言、开机自启动、托盘和同步尚未开放。用法与数据边界见 [常规设置文档](./docs/GENERAL_SETTINGS.md)。

默认模型保存后应用到当前空白窗口和之后的新对话，不改写历史会话。选择云端模型不等于已配置 API Key；更多可用模型可先在“模型提供方”测试连接获取。不在当前列表中的已保存选择仍保留，不擅自切换服务；用法和存储边界见 [默认模型文档](./docs/DEFAULT_MODELS.md)。

## 技术栈

- Tauri 2
- React 19
- TypeScript
- Vite
- Rust

## 获取源码与开发

已验证的开发环境为 Windows、Node.js 24 和 Rust 1.98.1。先按 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)安装 Rust 的 MSVC 工具链、Microsoft C++ Build Tools（含 Windows SDK）及 WebView2；仓库固定 Rust 工具链版本，更新版本应连同测试一起审查。在 PowerShell 中运行：

```powershell
git clone "https://github.com/zhang124zb/modelport.git" modelport
cd modelport
npm ci
npm run tauri dev
```

`npm ci` 根据已提交的 `package-lock.json` 安装前端依赖；后续依赖未变化时，无需每次启动都重装。仅预览界面可运行 `npm run dev`；检查前端生产构建可运行 `npm run build`。浏览器预览无法发送真实模型请求。

开发 / 测试默认采用低缓存模式：不生成 Rust 调试符号与增量缓存，开发检查仍保留。磁盘占用会降低，但仍有依赖编译产物，下次修改编译可能更慢，原生源码调试的信息较少。发布构建策略不变，普通用户运行发布程序不会产生 Rust 编译缓存。

只查看本项目缓存大小，或明确清理可重新生成的调试产物（先关闭调试程序并结束构建）：

```powershell
pwsh -NoProfile -File .\scripts\manage-build-cache.ps1
pwsh -NoProfile -File .\scripts\manage-build-cache.ps1 -CleanDebug -WhatIf
pwsh -NoProfile -File .\scripts\manage-build-cache.ps1 -CleanDebug
```

清理保留源码、前端依赖、`release/` 发布程序及发布缓存；下次开发需重新编译。低缓存说明、长对话策略与合成样本基准见 [性能与构建缓存](./docs/PERFORMANCE.md)。

## 开发检查

在项目根目录运行：

```powershell
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
npm run check:repo
```

`npm test` 运行不需要云端密钥的本地逻辑检查；`check:repo` 检查源码及已有 Git 历史中的常见敏感内容和不应提交的生成文件，只报告位置，不自动删除或改写历史。它是有限的启发式检查，不等于完整的安全审计。Windows CI 运行类型、逻辑、前端构建与原生单元检查，不代表所有真实提供商和 MCP 服务已验证。需要专用数据目录的桌面检查见下文和各功能文档。

## 构建可双击启动的 Windows 程序

在项目根目录的 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
```

脚本会调用 Tauri 构建，将程序放到 `release/ModelPort.exe`，并生成 `release/ModelPort-<版本>-windows-x64.zip`。便携包只包含程序、启动文件、使用说明、许可证、SHA-256 清单和构建信息，不包含旧版归档、测试产物、缓存或用户数据。解压后双击 [启动 ModelPort.cmd](./启动%20ModelPort.cmd) 即可运行，无需开发服务器。运行电脑需要 WebView2 运行时；没有 Node.js / Rust 也可以使用。发布指南见 [GitHub 文档](./docs/GITHUB.md)。

若 `release/ModelPort.exe` 已存在且内容不同，脚本会停止，保护旧文件。确认更新时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1 -ReplaceExisting
```

脚本会先把旧程序 / 同名旧 ZIP 保留到 `release/archive/`，再放入新文件；若程序相同，不替换 EXE，但仍刷新说明和许可。校验 ZIP 可运行 `pwsh -NoProfile -File scripts/verify-portable-package.ps1 -PackagePath release/ModelPort-0.12.0-windows-x64.zip`。校验值不等于代码签名，目前程序未签名。

## 桌面回归检查

已完成构建且安装 Node.js 24 / PowerShell 7 / WebView2 时，一键运行：

```powershell
npm run test:desktop
```

自动启动独立 WebView 测试窗口，串行检查弹窗遮罩、12 类设置、快捷键 / 搜索、聊天恢复、停止生成、长历史、模型连接、MCP 授权和输入区布局。模型回复采用临时本机 HTTP 服务，无需真实 API Key 或已安装 Ollama 模型。失败停止后续检查，记录存入已忽略的 `release/desktop-regression-*`，最后只关闭本次测试窗口。原生配置中临时创建的提供商 / MCP 服务按 UUID 清理；强制终止测试可能留下临时配置，详见 [桌面回归文档](./docs/DESKTOP_TESTS.md)。

检查调试构建可运行 `npm run test:desktop -- -Executable src-tauri/target/debug/modelport.exe`。只有基础运行要求齐全才能执行，GitHub 现有 CI 仍运行离线逻辑 / 原生测试，不自动启动桌面界面；本机一键回归不代表已验证 GitHub 托管运行器的 GUI 环境。

以下原有检查仍需要真实 Ollama，用于额外集成验证：

本机 Ollama 已运行并安装模型时，可用 Node.js 24 和独立 WebView 数据目录检查默认模型、弹窗遮罩、新建对话和历史模型恢复：

```powershell
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP ('modelport-check-' + [guid]::NewGuid().ToString('N'))
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9342'
Start-Process -FilePath "$PWD\release\ModelPort.exe" -WindowStyle Hidden
Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER, Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
node scripts/verify-desktop.mjs 9342
node scripts/verify-composer-layout.mjs 9342
```

检查脚本只允许空白的测试数据目录，不会在含真实历史记录的窗口中运行。调试端口可控制窗口，仅用于本机临时测试，不能用于日常启动或开放给其他设备；完成后关闭测试窗口，双击正常启动文件即可。

输入区布局检查覆盖默认和最小窗口、两个管理入口的键盘操作，以及长名称与更新标记的同排显示，不修改本地技能或知识库。

## 后续更新

如果你修改过源码，先将改动提交到自己的 Git 分支。拉取新版本后，再安装锁文件指定的依赖并构建：

```powershell
git pull --ff-only
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1 -ReplaceExisting
```

本地聊天记录留在应用的 WebView 数据中，API Key 留在 Windows 安全凭据库；Git 只用于管理源码与构建脚本。首次上传前先审查当前文件和已有提交历史，再连接远程仓库；步骤见 [GitHub 上传与发布](./docs/GITHUB.md)。

## 设计原则

- 本地优先：会话、配置和凭据尽可能留在用户设备上。
- 自带密钥：用户决定接入哪个服务商，并清楚知道请求发送到哪里。
- 模型中立：同一个对话界面可以切换云端模型和本地模型。
- 安全默认：API Key 进入 Windows 安全凭据库，不写入普通配置文件或聊天记录。

源码模块和 Git 更新流程见 [项目结构文档](./docs/ARCHITECTURE.md)；设置扩展接口见 [设置模块开发文档](./docs/SETTINGS.md)；功能范围与后续计划见 [产品设计文档](./docs/PRODUCT_DESIGN.md)。

## 许可证与第三方组件

ModelPort 自有源码采用 [MIT 许可证](./LICENSE)。第三方组件、依赖和字体仍遵循各自许可证；应用许可证不替代其授权要求。已确认的直接复制组件来源见 [第三方声明](./THIRD_PARTY_NOTICES.md)。
