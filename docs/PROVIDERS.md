# 模型提供商

## 使用

设置 → 模型提供方，或主界面 → 模型连接，使用同一配置界面。

- 内置提供商：Ollama、OpenAI、DeepSeek、Google Gemini、Anthropic Claude、通义千问（阿里云百炼北京地域）及 Kimi（Moonshot 中国站）。
- 填写自己的 API Key，点击“保存配置与密钥”，再“检查”或“获取”。检查只访问模型列表，不发送聊天；连接成功不代表账户有余额或某模型的调用权限。
- 获取列表与已有手动模型合并，最多 100 个。支持输入模型 ID 新建、移除与重置；手动改动保存后才进入主界面及默认模型列表。
- 新增服务不写死未经验证的最新模型 ID，以服务端获取结果或用户提供的 ID 为准。
- 自定义提供商可添加多个（最多 32 个），分别设置名称、主机、聊天路径与可选密钥。本地 LM Studio 等兼容服务可不填密钥。
- API 主机包含版本前缀，如 `https://api.example.com/v1`，API 路径填写 `/chat/completions`；获取模型请求主机下的 `/models`。服务不支持模型列表时可以手动填写模型 ID。
- 自定义 API 模式首版只支持 OpenAI Chat Completions 兼容接口；不假装支持 Anthropic / Gemini 原生协议。Claude 内置使用原生协议，Gemini 内置使用官方兼容接口。
- “改善网络兼容性”实际将该连接限制为 HTTP/1.1，仅在连接异常时开启；不关闭 TLS 校验，也不改变代理或上传资料。
- 默认模型页可选择任何已保存模型。删除提供商及密钥前确认；聊天和默认引用保留，不自动换服务。

## 存储与安全

- 原生 `ProviderStore` 在应用数据目录的 `providers/providers.json` 保存非密钥配置，用锁和原子替换保护数据。坏文件不会自动覆盖。
- 每个自定义提供商使用稳定 UUID；同名提供商仍使用不同凭据项。密钥不返回前端、不写入 JSON、不进入聊天备份。
- 已有密钥时，修改 API 主机须先删除旧密钥、保存新地址，再保存新密钥。输入域名确认后才会将请求发往该提供商。
- 远程地址须 HTTPS；HTTP 仅允许 localhost 或回环 IP。禁止 URL 内含用户名、密码、查询参数、片段和控制字符，禁止请求自动重定向。
- 模型列表响应限制 2 MiB，最多保留 100 个模型，模型 ID 限制 128 字节。聊天复用原有消息、附件、流式和停止限制。
- 新提供商的文字、TXT / Markdown、技能与知识库走原有准备管线。Claude 系统指令单独合并到 `system`，图片转为其原生 Base64 格式。
- Gemini、Claude 和受识别的 Qwen-VL 模型可走图片适配；Kimi、自定义及其他未确认视觉能力的模型会拦截图片，不影响文字聊天。视频和思考内容展示未包含在本次范围。
- 新 UUID 格式加入会话和默认模型验证；旧配置及聊天 v1 格式保持兼容。备份不包含提供商配置、密钥或模型下载。

## 开发接口与验证

- `list_provider_configs`、`add_custom_provider`、`save_provider_config`、`remove_custom_provider`。
- 密钥和模型请求仍通过原有 `has_provider_key` / `save_provider_key` / `remove_provider_key` / `list_available_models` / `send_chat` / `stream_chat`。
- `src/lib/providers.ts` 保存纯类型、默认展示配置及提供商 ID 校验；`modelport.ts` 仅作为原生命令桥接，界面不直接发送密钥到远程。
- `node scripts/verify-providers-store.mjs`：纯逻辑 ID、默认模型、聊天 / 备份兼容和地址拼接。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：配置持久化、地址与模型边界、删除后不回退、Claude 系统 / 图片 / 分块 SSE 及既有逻辑。
- `node scripts/verify-providers.mjs <调试端口> [截图]`：全新隔离 WebView；真实原生 IPC + 本地 HTTP 模拟服务，验证创建 / 保存 / 获取 / 默认 / 重载 / 聊天 / 停止 / 错误 / 密钥隔离与删除。测试创建独立 UUID 和虚构密钥并在结束时清理，不调用云端模型、不修改真实密钥或聊天。

官方接口依据：[Gemini 兼容接口](https://ai.google.dev/gemini-api/docs/openai)、[Claude 流式接口](https://platform.claude.com/docs/en/build-with-claude/streaming)、[阿里云百炼](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[Kimi Chat Completions](https://platform.kimi.com/docs/api/chat)。阿里云内置旧北京域名按官方兼容说明仍可使用；其他地域及新的业务空间专属域名请建立自定义连接，密钥必须与地域匹配。
