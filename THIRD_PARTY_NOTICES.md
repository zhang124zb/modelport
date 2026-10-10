# 第三方组件与许可证声明

ModelPort 自有代码采用根目录的 [MIT 许可证](./LICENSE)。该许可证不替代第三方代码、依赖和字体的授权。以下记录已确认的直接复制组件与打包字体；并非完整的依赖许可证清单或法律合规审计。

## Vercel AI Elements

- 来源：[vercel/ai-elements](https://github.com/vercel/ai-elements)，[上游 message.tsx](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx)。
- 本地代码：`src/components/ai-elements/message.tsx`。
- Copyright 2023 Vercel, Inc.
- 许可证：Apache License, Version 2.0；完整文本保留于 [licenses/Apache-2.0.txt](./licenses/Apache-2.0.txt)，[上游许可证](https://github.com/vercel/ai-elements/blob/main/LICENSE)。
- 本地适配：组件与工具函数的导入路径改为 ModelPort 项目路径。复制来源未记录固定上游提交，当前声明不推定所有历史版本的文件或授权相同。

此复制代码仍按其 Apache-2.0 许可证分发，不因 ModelPort 根目录采用 MIT 而变为 MIT。继续修改或分发时保留声明、许可证及适用的上游通知要求。

## shadcn/ui

- 来源：[shadcn-ui/ui](https://github.com/shadcn-ui/ui)，[上游许可证](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)。
- 本地代码：`src/components/ui/` 下的界面组件，按本项目导入路径适配。
- 许可证：MIT；完整版权与许可声明如下。

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Geist 字体

- 项目：[vercel/geist-font](https://github.com/vercel/geist-font)。
- 来源依赖：`@fontsource-variable/geist`，由 `src/index.css` 引入并随前端构建打包。
- Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font).
- 许可证：SIL Open Font License, Version 1.1。完整版权与许可文本保留于 [licenses/Geist-OFL-1.1.txt](./licenses/Geist-OFL-1.1.txt)，来自已安装依赖的 `LICENSE`。

字体保持其原许可证，不以 ModelPort 的 MIT 许可证重新授权。

## 其他依赖与发布

前端依赖版本由 `package-lock.json` 锁定，原生依赖由 `src-tauri/Cargo.lock` 锁定。React、Tauri、Rust 库、Markdown 渲染组件及它们的传递依赖都有各自许可证，应以所分发版本的原始许可文件为准。仅在依赖清单中标注 MIT 不足以替代它们的要求。

分发源码或程序时保留本声明及 `licenses/` 中的相关文本。新增、升级依赖或复制第三方代码后，维护者应继续检查实际分发内容的许可证、版权和 NOTICE 要求；本文件不宣称所有传递依赖已经逐项审计，也不代表上游作者为 ModelPort 提供担保或背书。
