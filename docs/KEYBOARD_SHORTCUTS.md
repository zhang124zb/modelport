# 键盘快捷键

在“设置 → 键盘快捷键”查看和修改发送方式。界面按参考图排列 8 项；只有前两项可选择组合，其余先固定。修改需点击“保存快捷键”，恢复默认仅重置本页表单，不改变对话配置或记录；切换分类、关闭设置及关闭原生窗口时保护未保存修改。

## 操作

- 发送：默认 Enter，也可选择 Ctrl + Enter。Shift + Enter 始终换行；Ctrl 发送模式下 Enter 换行。
- 发送但不生成回答：默认 Ctrl + Enter，也可选择 Alt + Enter 或未设置。两种发送组合不能相同；切换为 Ctrl 发送时自动清除冲突的仅保存组合。
- 创建新的对话：Ctrl + N。已有草稿时先确认是否放弃，使用“默认模型”保存的选择；未设置时使用本机 Ollama。
- 新话题：Ctrl + Shift + N。在当前文本会话中保留记录、模型、技能、知识库和草稿，但下一条消息重新开始聊天上下文。生成过程中不修改话题边界；空白新对话无须重置。
- 跳转到下一个 / 上一个会话：Ctrl + Tab / Ctrl + Shift + Tab。按侧栏普通会话列表顺序循环，不计入“快速开始”；当前没有选中会话时从首项 / 末项开始。
- 跳转到第 N 个会话：Ctrl + 1–9；没有对应编号时不操作。
- 显示 / 隐藏搜索弹窗：Ctrl + K。也可点击左上角搜索图标。只按本机聊天标题和消息正文匹配，最多显示 50 项，不联网。选择结果打开会话；Esc、再次 Ctrl + K、关闭按钮或遮罩关闭，恢复原焦点。

仅保存消息会显示状态，不需要 API Key 或在线模型，不生成助手消息。后续生成时，这些消息可能随上下文送给所选模型；0 轮上下文或新话题之前的消息不会发送。请求仍限制最多 100 条消息；长历史先裁剪旧消息。仅保存内容与普通聊天一样未加密，并非独立的私人记事本。

输入法选词（isComposing / keyCode 229）及重复按键不会触发操作。设置或模型连接打开时，主界面固定快捷键暂停；搜索打开时仅 Ctrl + K 可切换搜索。Ctrl 组合同时兼容 Meta 修饰键，不作为系统全局热键注册。

## 数据与接口

- `src/lib/chat-settings.ts` 保留存储键 `modelport.preferences.chat.v1`；发送字段仍为 `sendShortcut`，新增 `sendWithoutReplyShortcut`。旧版 Ctrl 发送配置缺少新字段时默认“未设置”，保留 Enter 换行行为。旧 Enter 配置默认 Ctrl 仅保存；读取异常不自动覆盖原数据。
- `KeyboardShortcutsPage.tsx` 和 `ChatSettingsPage.tsx` 只保存各自字段，共用 `useSettingsLeaveGuard`；两个页面的恢复默认互不影响。
- `src/lib/keyboard-shortcuts.ts` 包含固定显示组合、事件判定与列表循环导航；主界面注册一个稳定监听器，通过 ref 读取最新已提交状态。
- `src/App.tsx` 复用现有聊天提交和持久化流程，仅保存分支不调用原生聊天命令。`ConversationSearchDialog.tsx` 为原生 HTML 模态搜索界面，不建立额外索引或第三方依赖。
- `src/lib/chat-store.ts` 的用户消息带 `savedOnly`、`topicStart`，会话带 `newTopicPending`。旧数据无此字段仍正常加载，助手消息不接受用户专用标记；待发送边界重启后保留，编辑失败话题的首条问题时恢复边界。
- `buildRequestHistory` 按最近的话题边界重置历史、保留范围内完整问答与仅保存消息；基础提示词、技能及知识库组装仍由现有原生流程处理。

## 验证

- `node scripts/verify-chat-settings-store.mjs`：Node.js 24；配置迁移 / 冲突 / 保存失败、输入法、固定映射、循环导航、仅保存与话题持久化、上下文与数量边界。
- `node scripts/verify-keyboard-shortcuts.mjs <调试端口> [截图路径]`：仅全新独立 WebView 配置；实际按键、8 项界面、两个页面互不覆盖、退出 / 存储失败保护、搜索 / 焦点、最小窗口、重启，以及真实 Ollama 请求的上下文。结束恢复测试前聊天与配置，不发送云端请求，不修改技能 / 知识库。
- `node scripts/verify-chat-settings.mjs <调试端口>`：原有对话设置回归，发送选项从新模块配置。
- `node scripts/verify-desktop.mjs <调试端口>`：12 分类切换、遮罩、默认 Ollama 与历史模型恢复。
