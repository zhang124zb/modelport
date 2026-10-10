# 聊天附件

输入框左下角“＋”打开“添加图片 / 选择文件”。附件显示为可预览、可移除的卡片；可只添加附件后发送，默认问题为“请分析这些附件。”。

## 支持范围与限制

- PNG / JPEG / WebP 图片，原图最多 8 MiB、2400 万像素；原生 Canvas 统一生成最长边不超过 2048 像素的 PNG 副本，处理后最多 4 MiB，原文件不变。
- UTF-8 TXT / Markdown，每份最多 128 KiB。正文作为不可信资料附在用户消息中，不是系统指令，不执行文件。
- 每条消息最多 4 个附件。每次请求的历史图片合计最多 16 MiB，文字和文件内容合计约 1 MB。超限提示减少附件、携带轮数或创建新话题，不静默截断。
- PDF / Word / 音频和视频尚未接入。视频会弹出明确提示，图片支持不等于视频支持，不用第一帧冒充完整视频。

## 模型能力与隐私

添加图片及发送含图片上下文之前检查能力。Ollama 查询本机 `POST /api/show` 的 `capabilities`，仅当其中有 `vision` 才允许图片，不根据模型名字猜测。能力信息缺失、服务离线、模型不存在时明确提示。即使当前问题没有新图片，历史上下文中的图片仍需通过检查。原生请求层再次验证，不能通过绕过界面向文字模型发送图片。

云端按客户端已确认的视觉系列支持，DeepSeek 当前识图入口为 `deepseek-flash`，不是所有 DeepSeek 模型都支持。每次云端携带附件发送前确认，取消保留草稿。仅读取用户选择的附件副本，不扫描其他文件；API Key 仍在系统凭据库。

官方接口依据：[Ollama 模型能力](https://docs.ollama.com/api-reference/show-model-details)、[Ollama 图片请求](https://docs.ollama.com/capabilities/vision)、[OpenAI 图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[DeepSeek 图片输入](https://api-docs.deepseek.com/guides/vision/)。

## 保存、重试与备份

应用数据目录 `attachments/<UUID>.json` 保存副本，未加密，上限 256 MiB / 2000 个文件。只接受原生生成的 UUID 文件名，拒绝路径穿越、符号链接 / 目录联接、损坏图片及元数据不匹配。`modelport.chat.v1` 仅保存附件元数据引用，不存图片 Base64 和附件全文。

发送后附件随消息保留，重启可预览。“编辑并重试”恢复失败问题的附件。完整上下文携带对应附件，失败 / 停止轮次不作为完整问答；新话题不携带以前的附件。“仅保存，不生成回复”仍适用，后续作为上下文发送时检查能力和云端确认。

JSON 聊天备份 **只含附件引用，不含附件原件**，写入 `attachmentsIncluded: false`。跨电脑恢复或清理副本后需重新添加。若引用缺失则拦截发送，不让模型假装读到文件。

常规设置 → 聊天数据 → 清理闲置附件，保留当前窗口聊天及草稿引用。清理前要求确认其他 ModelPort 窗口已关闭；旧 JSON 备份所引用、但未导回当前窗口的闲置附件也会失效。只删除应用副本，不删除原文件。移除草稿或清空记录不会自动删除附件，可用此按钮统一清理。

若同时选择知识库，空检索且没有附件仍直接返回资料不足；存在明确附加文件时会继续处理附件，检索结果和附件内容分别提供，来源编号不混用。

## 开发入口与验证

- `src/components/ChatAttachments.tsx`：菜单、选择、卡片、可访问弹窗。
- `src/lib/attachments.ts`：格式、Canvas 图片规范化、UTF-8、元数据校验、引用收集。
- `src-tauri/src/attachments.rs`：限额、PNG 解码、原子保存、读取与清理。
- `src-tauri/src/connection.rs`：能力检测、原生引用解析、OpenAI 兼容 `image_url` 内容块 / Ollama `images` 数组。
- `src/lib/chat-settings.ts` / `chat-store.ts`：上下文、历史保存、备份引用兼容。

原生命令：`save_chat_attachment`、`get_chat_attachment`、`remove_chat_attachments`、`clean_unused_attachments`、`get_model_capabilities`、`validate_chat_attachments`。已有 `send_chat` / `stream_chat` 消息新增可选 `attachments` 数组，旧文字调用兼容。

检查：`node scripts/verify-attachments-store.mjs`、`cargo test --manifest-path src-tauri/Cargo.toml`。桌面链路：`node scripts/verify-attachments.mjs <调试端口> [截图路径]`，必须空白隔离 WebView；测试在 11434 使用受控本机服务，端口被占用时停止，不操作真实模型。真实识图单独使用 `verify-attachments-live.mjs`，不调用云端。
