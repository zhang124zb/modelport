# GitHub 上传与发布

本文面向首次把本地 ModelPort 仓库上传到 GitHub 的维护者。仓库已经有 Git 历史；无需重新初始化，也不要覆盖已有提交。本文不会替你创建仓库、上传源码或发布程序。

## 1. 上传前先审查

在项目根目录执行：

```powershell
git status --short
git log --oneline --all
git remote -v
npm run check:repo
```

当前文件没有密钥，不代表旧提交也没有。`check:repo` 只用有限规则检查当前候选文件和已有 Git 历史中的常见敏感内容、生成文件及大文件，不会修改文件或清理历史；它不能识别所有自定义令牌和私密内容。仍需人工审阅日志、截图、测试样例、私人地址及文档中的个人信息。

不要提交：

- `node_modules/`、`dist/`、`src-tauri/target/` 等依赖和构建缓存；
- `release/` 中的程序、归档及桌面验证产物；
- API Key、MCP 令牌、`.env` 私密配置、证书私钥；
- WebView 用户数据、聊天备份、附件副本、知识库资料及真实日志。

需要保留源码、文档、`package-lock.json`、`src-tauri/Cargo.lock`、工具链配置、CI 工作流及许可证声明。`.gitignore` 不会移除已经被 Git 跟踪的文件；发现敏感内容或旧历史问题时应先处理，不要带着警告继续公开发布。已泄露凭据必须先在服务商处撤销或轮换。

## 2. 审阅并提交本地修改

先运行 [贡献指南](../CONTRIBUTING.md)中的检查，确认变更都属于要上传的项目内容，再执行：

```powershell
git add --all
git diff --cached --stat
git diff --cached --check
git diff --cached
git commit -m "Prepare ModelPort for GitHub"
```

不要跳过暂存区审阅。`git add --all` 会加入所有未被忽略的修改和删除，包含上传前已经存在的功能变更。提交身份需要使用你自己的 Git 姓名和邮箱；公开仓库会显示提交中的身份信息，可自行选择 GitHub 提供的隐私邮箱。

## 3. 创建空的 GitHub 仓库

在 GitHub 新建仓库，选择名称和可见性。因为本地已有历史，**不要勾选自动创建 README、许可证或 `.gitignore`**，避免引入另一条初始历史。项目已有 MIT 许可证，不需要重复生成。

### 使用 GitHub Desktop

选择 **File → Add local repository**，打开现有 `modelport` 目录；审查并提交变化后，使用 **Publish repository**。仔细核对可见性和账户，确认不包含私密数据，再发布。不要创建第二份空项目代替已有仓库。

### 使用 Git 命令行

先检查 `git remote -v`。仅在没有 `origin` 时添加，下面的地址必须替换成你刚创建的实际仓库地址：

```powershell
git remote add origin "https://github.com/OWNER/REPOSITORY.git"
git push -u origin main
```

如果已经有 `origin`，先核对所有权及目标，不要重复添加或擅自覆盖。推送失败时先查看错误原因，不使用强制推送来覆盖远程内容；如果远程误生成了 README 等初始提交，先协调如何合并历史。

## 4. GitHub 仓库设置

- 查看 Actions 的 Windows CI 是否通过。它验证类型、纯逻辑、前端构建和原生单元测试，不会调用真实云端模型或签发安装包。
- 在可用时启用 Private vulnerability reporting，并按 [安全政策](../SECURITY.md)处理报告。
- 启用分支保护前，先确认实际工作流检查名称；建议后续更新使用分支和 Pull Request。
- 仓库介绍可填写“本地优先的多模型 AI 桌面客户端”；不要宣称未经验证的平台或服务全部受支持。

后续更新通常为：

```powershell
git pull --ff-only
npm ci
```

有本地修改时先审阅并提交到自己的分支，不要为拉取更新而清空工作区。重新生成桌面程序见 README。

## 5. 源码与可执行程序分开发布

源码走 Git 提交；Windows 可执行程序走 **GitHub Releases**，不把 `release/` 加入 Git 或 Git LFS。完成测试、审查版本号和许可证后，使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
```

脚本会把程序、启动文件和许可证声明放到 `release/`。若已有不同的程序，脚本会停止。明确确认更新时添加 `-ReplaceExisting`，旧程序会保留在 `release/archive/`。如果新旧程序文件相同，不替换程序，但仍刷新附带的启动文件和许可证。

推荐从 `release/` 中选取以下文件打包成发布附件，保留平铺目录和第三方许可子目录；启动文件可直接找到同目录程序。不要直接压缩整个 `release/`，其中可能包含旧版归档、调试截图和验证产物。还应保留其他分发所需的依赖声明。

```text
ModelPort/
├─ ModelPort.exe
├─ 启动 ModelPort.cmd
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
└─ licenses/
   ├─ Apache-2.0.txt
   └─ Geist-OFL-1.1.txt
```

在发布说明中列出版本、对应源码提交、Windows / WebView2 要求、变更、安全限制和文件 SHA-256。可用 `Get-FileHash -Algorithm SHA256 -LiteralPath .\release\ModelPort.exe` 计算校验值；校验值不等于签名或可信发布者证明。当前未配置自动 Release、代码签名或签名安装包。

首次发布前仍需完成第三方依赖和字体的分发许可核对；现有声明只覆盖明确记录的直接复制组件，不声称完整许可证审计已经完成。不要将 API Key、测试用户数据、调试日志和个人聊天截图打进发布包。
