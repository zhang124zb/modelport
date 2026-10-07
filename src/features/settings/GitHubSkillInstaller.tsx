import { useState } from "react";
import type { FormEvent } from "react";

type Props = { busy: boolean; onDownload: (repository: string, gitRef: string, path: string) => Promise<void> };

export function GitHubSkillInstaller({ busy, onDownload }: Props) {
  const [repository, setRepository] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [path, setPath] = useState("SKILL.md");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) void onDownload(repository, gitRef, path);
  };
  return (
    <form aria-label="GitHub 技能安装" className="skills-github" onSubmit={submit}>
      <h4>从 GitHub 安装技能</h4>
      <p>支持公开仓库，只获取一个 SKILL.md。先预览、再确认安装；不会克隆整个仓库或执行脚本。</p>
      <label>仓库地址<input aria-label="GitHub 仓库地址" autoComplete="off" disabled={busy} maxLength={300} onChange={(event) => setRepository(event.target.value)} placeholder="https://github.com/作者/仓库 或 作者/仓库" required value={repository} /></label>
      <div className="skills-github-fields">
        <label>分支 / 标签 / 提交（可选）<input aria-label="GitHub 分支或版本" autoComplete="off" disabled={busy} maxLength={256} onChange={(event) => setGitRef(event.target.value)} placeholder="留空使用默认分支" value={gitRef} /></label>
        <label>仓库内文件路径<input aria-label="GitHub 技能文件路径" autoComplete="off" disabled={busy} maxLength={1024} onChange={(event) => setPath(event.target.value)} placeholder="skills/translation/SKILL.md" value={path} /></label>
      </div>
      <button disabled={busy || !repository.trim()} type="submit">{busy ? "正在处理…" : "获取安装预览"}</button>
      <small>文件路径区分大小写。暂不支持私有仓库；联网失败时可下载文件后使用“导入技能”。</small>
    </form>
  );
}
