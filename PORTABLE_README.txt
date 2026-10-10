ModelPort（模型港）Windows 便携版

1. 请先完整解压 ZIP 到一个文件夹，不要在压缩包内直接运行。
2. 双击“启动 ModelPort.cmd”或“ModelPort.exe”。
3. 在“设置 → 模型提供方”配置自己的 API Key，或连接本机已运行的 Ollama。
4. 默认模型可以在“设置 → 默认模型”自行选择。

运行要求：Windows x64、Microsoft Edge WebView2 运行时。
无需安装 Node.js、Rust 或 Visual Studio。若提示缺少 WebView2，请从微软官网安装：
https://developer.microsoft.com/microsoft-edge/webview2/

软件不附带大模型、API Key 或模型额度。没有可用连接时仍可打开界面，但不能生成回复。
技能、知识库、附件和 MCP 的安全提示仍需认真阅读；MCP 逐次确认不是系统沙箱。
聊天及资料保存在应用数据目录，不在此程序包中，默认未加密。
旧 JSON 聊天备份只包含附件引用，不含附件原件。更新前建议在常规设置导出备份。

校验：SHA256SUMS.txt 列出每个程序文件的 SHA-256。
在解压目录使用 PowerShell：Get-FileHash -Algorithm SHA256 -LiteralPath .\ModelPort.exe
比较 Hash 与 SHA256SUMS.txt 中 ModelPort.exe 那一行的值。
校验值不等于代码签名；此包未签名，请仅使用可信来源。不要为了运行程序而关闭系统防护。

程序版本、构建时间与源码状态见 package-info.json；许可见 LICENSE、THIRD_PARTY_NOTICES.md 和 licenses。
项目地址：https://github.com/zhang124zb/modelport
