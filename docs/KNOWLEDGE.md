# 知识库使用与开发

ModelPort v0.4.0 提供本地文本知识库。资料导入与检索不联网、不需要 API Key，也不下载额外模型。聊天仍使用用户选择的现有模型；云端知识库请求发送前会询问确认。

## 使用

1. 打开“设置 → 知识库”或左下角“我的资料”，新建并保存一个知识库。
2. 导入 UTF-8 的 `.txt`、`.md` 或 `.markdown` 文件，可以一次选择多个。文件复制为本地文本，不修改原文件。
3. 点击文件名查看原文，用“检索测试”检查实际命中的片段。中文问题可使用关键短语；英文按词匹配。
4. 审阅并启用知识库，在聊天输入区选择它。新对话默认“无知识库”，每个会话最多选择一个。
5. 回复下方展开“本次检索片段”核对文件名、行号、正文和内容版本。这里列出提供给请求的检索结果，不保证模型引用了所有结果，答案仍需核实。

没有命中资料且没有聊天附件时，直接提示资料不足，不发送模型请求，不让模型猜测知识库事实。此时可补充资料、改变关键词，或关闭知识库普通聊天。若同时提供聊天附件，仍可分析附件，附件内容与知识库来源分别标明，见 [附件文档](./ATTACHMENTS.md)。

知识库名称修改会更新版本，旧会话下次使用需确认。资料增删或同名替换会重新禁用知识库，清除当前应用中的对应选择；重新审阅启用后再选择。替换同名文件需确认，内部资料 ID 保持不变。删除仅移除本地副本，聊天、历史来源快照和原文件保留。其他应用实例没有自动刷新时，原生层仍拒绝过期、已禁用或已删除的引用。

## 首版范围与限制

- 文本格式：UTF-8，支持 BOM 与 Windows 换行。PDF、Word、网页抓取、目录及压缩包不支持；GBK 文件需要先转换编码。
- 单文件最多 512 KiB，每批 1–20 个文件 / 2 MiB；每库最多 200 份资料，全局最多 20 个知识库，库文件最多 16 MiB。整批验证、一次保存，错误时不部分导入。
- 分段上限 1000 个 Unicode 字符，重叠 100 字符，尽量在后半段的换行处切分；保留原文行号。
- 本地关键词检索：中文等 CJK 相邻双字匹配，英文按词匹配，结合匹配频次、词项稀有程度与片段长度排序；最多 32 个问题词项、4 个去重片段。检索问题最多 8 KiB。
- 这是轻量文本检索，不是向量语义检索；同义词、改写问题、跨段复杂推理可能漏检。请先用检索测试检查结果，不宣传完整语义理解。
- 不建立第二份持久化索引，按需读取受限库并分段检索。原文与元数据原子保存在一个 JSON 文件中，没有独立索引失配问题。更大的语料或更高召回需求再引入索引 / 嵌入模型。

## 数据与安全

Tauri 应用数据目录下的 `knowledge/knowledge-state.v1.json` 保存知识库、资料原文及稳定 UUID。内容未加密，包含敏感信息的资料需自行评估；数据不在源码或发布目录中。`local_data.rs` 复用 Skills 的进程间锁、受限读取、路径检查和同目录原子保存，拒绝符号链接 / Windows 目录联接；损坏数据不会被静默清空或覆盖。

前端只发送知识库 ID 与内容版本，不能指定原生磁盘路径、远程地址或任意 system 消息。原生层按最后一条用户问题检索已选择且已启用的库，固定本次片段后释放库锁。不会将未选库、未命中文件或整库正文发给模型。

资料始终是文本，不执行其中的脚本、命令、HTML、链接或文件引用。可信的客户端资料使用约束放入 system 消息，检索原文以 JSON 数据追加在当前 user 消息中，不将资料原文升级为系统指令。提示词不能保证模型完全抵抗恶意内容，但本模块不提供工具调用、本机执行或凭据读取能力。原始资料与来源展示使用转义文本，不渲染为 HTML。

普通和流式聊天共用技能校验与知识库组装。未选知识库时不访问知识库文件，不改变原有请求正文。可同时选择一个指令技能和一个知识库；技能仅改变任务方式，知识库仅提供本次证据。更换资料范围建议新建对话，避免旧回复影响结果。

流式请求通过可选 `onSources` 通道先发回来源，正文仍使用原有 `onEvent` 通道。来源快照随该次消息保存到本机聊天存储；删除或更新资料不会回写旧快照。聊天恢复会校验来源形状、数量和文本长度；旧聊天没有知识库字段时仍正常读取。来源快照只保留当次命中片段，仍会占用部分聊天存储空间。

## 开发入口

- `src-tauri/src/knowledge.rs`：库 / 资料校验、导入、版本、分段、文本检索及命令。
- `src-tauri/src/local_data.rs`：Skills 与知识库共享的本地数据保护，不暴露前端任意文件接口。
- `src-tauri/src/connection.rs`：普通 / 流式共用知识库组装、无匹配短路及可选来源事件。
- `src/features/settings/KnowledgeSettingsPage.tsx`：管理、批量导入、审阅启用、检索预览与原文查看。
- `src/features/settings/useSettingsLeaveGuard.ts`：知识库与 Skills 共用的设置 / 原生窗口退出保护。
- `src/components/KnowledgeSources.tsx`：聊天历史中的只读来源快照。
- `src/lib/modelport.ts`：类型和原生接口；只传 ID / 版本，过滤摘要的多余字段。
- `src/App.tsx`：会话选择、版本确认及删除后的选择清理；`features/chat/useChatLifecycle.ts` 接收来源，`useChatHistory.ts` / `src/lib/chat-store.ts` 负责随消息持久化。

原生命令：

- `list_knowledge_bases()`、`get_knowledge_base(id)`：摘要与库内资料清单。
- `save_knowledge_base(base?, name)`：创建 / 改名；修改需预期版本。
- `import_knowledge_documents(base, documents, replace)`：批量输入 `{ filename, text }`；同名替换需显式允许，原子保存。
- `set_knowledge_base_enabled(base, enabled)`：已导入资料的库才可启用，检查版本。
- `remove_knowledge_base(base)`、`remove_knowledge_document(base, documentId)`：受保护删除内部副本。
- `get_knowledge_document(baseId, documentId)`：已登记资料的原文，无磁盘路径参数。
- `search_knowledge_base(base, query)`：本地预览，允许检索未启用库，但仍检查版本；聊天检索必须已启用。
- `send_chat` / `stream_chat`：可选 `knowledge: { id, revision }`；`stream_chat` 另接受可选来源通道。

## 验证

- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`：批量原子性、版本 / 启用保护、CJK / 英文匹配、Unicode 分段、损坏库 / 锁保护、选库范围及文本角色边界。
- `node scripts/verify-knowledge.mjs <调试端口> [管理页截图] [回复截图]`：实际文件选择、原文安全展示、中文检索、真实 Ollama 依据资料回答、来源恢复、无命中、替换、版本确认、删除与小窗口。
- `node scripts/verify-skills.mjs <调试端口>`、`node scripts/verify-github-skills.mjs <调试端口>`、`node scripts/verify-desktop.mjs <调试端口>`：已有模块回归。

桌面验证使用独立 WebView 配置且拒绝已有聊天，结束后只移除唯一命名的测试库、恢复测试聊天状态，校验预先存在的知识库不变；不测试云端付费请求。
