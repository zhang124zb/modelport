use crate::skills::{SkillPreview, SkillRecord, SkillStore, parse_document};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::State;

const MAX_DOCUMENT: usize = 128 * 1024;
const MAX_API_RESPONSE: usize = 512 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitHubOrigin {
    pub repository: String,
    pub path: String,
    pub commit: String,
    pub document_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillPreview {
    pub origin: GitHubOrigin,
    pub document: String,
    pub preview: SkillPreview,
}

fn repository_name(input: &str) -> Result<String, String> {
    let input = input.trim().trim_end_matches('/');
    let name = if input.contains("://") {
        let url = Url::parse(input).map_err(|_| "GitHub 仓库地址格式无效。")?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("请使用 https://github.com/作者/仓库 的公开仓库首页地址。".into());
        }
        url.path().trim_matches('/').to_owned()
    } else {
        input.to_owned()
    };
    let name = name.strip_suffix(".git").unwrap_or(&name);
    let parts: Vec<_> = name.split('/').collect();
    if parts.len() != 2
        || parts[0].is_empty()
        || parts[0].len() > 39
        || parts[1].is_empty()
        || parts[1].len() > 100
        || matches!(parts[1], "." | "..")
        || !parts[0]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !parts[1]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("请输入仓库首页地址或 作者/仓库；分支和 SKILL.md 路径请填写在下方。".into());
    }
    Ok(name.into())
}

fn skill_path(input: &str) -> Result<String, String> {
    let path = input.trim();
    let path = if path.is_empty() { "SKILL.md" } else { path };
    if path.len() > 1024
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|p| p.is_empty() || matches!(p, "." | ".."))
        || path.rsplit('/').next() != Some("SKILL.md")
    {
        return Err(
            "请填写仓库内相对路径，例如 skills/translation/SKILL.md；不允许绝对路径或 ..。".into(),
        );
    }
    Ok(path.into())
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn document_hash(document: &str) -> String {
    format!("{:x}", Sha256::digest(document.as_bytes()))
}

impl GitHubOrigin {
    pub fn validate(&self) -> Result<(), String> {
        if repository_name(&self.repository)? != self.repository
            || skill_path(&self.path)? != self.path
            || !is_hex(&self.commit, 40)
            || !is_hex(&self.document_hash, 64)
        {
            return Err("GitHub 来源信息无效，请重新获取预览。".into());
        }
        Ok(())
    }
    fn content_url(&self) -> Result<Url, String> {
        self.validate()?;
        let mut url = Url::parse("https://api.github.com/").unwrap();
        url.path_segments_mut()
            .unwrap()
            .push("repos")
            .extend(self.repository.split('/'))
            .push("contents")
            .extend(self.path.split('/'));
        url.query_pairs_mut().append_pair("ref", &self.commit);
        Ok(url)
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("ModelPort/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| "无法建立 GitHub 安全连接。".into())
}

fn status_error(status: StatusCode) -> &'static str {
    match status.as_u16() {
        404 => "未找到公开仓库、分支或 SKILL.md。请检查大小写和路径；首版不支持私有仓库。",
        403 | 429 => "GitHub 暂时限制了请求，请稍后重试；也可下载 SKILL.md 后使用本地导入。",
        409 => "仓库没有可用提交，暂时无法安装。",
        400 | 422 => "仓库或分支信息无效，请检查后重试。",
        300..=399 => "GitHub 地址发生跳转。请填写仓库当前的首页地址后重试。",
        _ => "GitHub 服务暂时不可用，请稍后重试。",
    }
}

async fn read_response(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response.status() != StatusCode::OK {
        return Err(status_error(response.status()).into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("GitHub 返回内容超过大小限制，未安装任何文件。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取 GitHub 内容失败，请重试。")?
    {
        if chunk.len() > limit - bytes.len() {
            return Err("GitHub 返回内容超过大小限制，未安装任何文件。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn request(client: &Client, url: Url, accept: &str, limit: usize) -> Result<Vec<u8>, String> {
    let request = client
        .get(url)
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28");
    let response = request.send().await.map_err(|error| {
        #[cfg(test)]
        eprintln!("GitHub connection failed: {error:?}");
        if error.is_timeout() {
            "连接 GitHub 超时，请检查网络后重试；也可下载 SKILL.md 后使用本地导入。"
        } else {
            "无法安全连接 GitHub，请检查网络或代理设置；不会跳过证书校验。"
        }
    })?;
    read_response(response, limit).await
}

fn parse_download(bytes: Vec<u8>) -> Result<(String, SkillPreview), String> {
    let document = String::from_utf8(bytes).map_err(|_| "GitHub 技能必须是 UTF-8 文本。")?;
    let preview = parse_document(&document)?;
    Ok((document, preview))
}

async fn download(
    client: &Client,
    origin: &GitHubOrigin,
) -> Result<(String, SkillPreview), String> {
    parse_download(
        request(
            client,
            origin.content_url()?,
            "application/vnd.github.raw+json",
            MAX_DOCUMENT,
        )
        .await?,
    )
}

#[tauri::command]
pub async fn preview_github_skill(
    repository: String,
    git_ref: String,
    path: String,
) -> Result<GitHubSkillPreview, String> {
    let repository = repository_name(&repository)?;
    let path = skill_path(&path)?;
    let git_ref = git_ref.trim();
    if git_ref.len() > 256 || git_ref.chars().any(char::is_control) {
        return Err("分支或版本标识无效。".into());
    }
    let client = client()?;
    let mut url = Url::parse("https://api.github.com/").unwrap();
    url.path_segments_mut()
        .unwrap()
        .push("repos")
        .extend(repository.split('/'))
        .push("commits");
    url.query_pairs_mut().append_pair("per_page", "1");
    if !git_ref.is_empty() {
        url.query_pairs_mut().append_pair("sha", git_ref);
    }
    #[derive(Deserialize)]
    struct Commit {
        sha: String,
    }
    let commits: Vec<Commit> = serde_json::from_slice(
        &request(
            &client,
            url,
            "application/vnd.github+json",
            MAX_API_RESPONSE,
        )
        .await?,
    )
    .map_err(|_| "GitHub 返回的版本信息无效。")?;
    let commit = commits.into_iter().next().ok_or("仓库没有可用提交。")?.sha;
    let mut origin = GitHubOrigin {
        repository,
        path,
        commit,
        document_hash: "0".repeat(64),
    };
    let (document, preview) = download(&client, &origin).await?;
    origin.document_hash = document_hash(&document);
    Ok(GitHubSkillPreview {
        origin,
        document,
        preview,
    })
}

#[tauri::command]
pub async fn install_github_skill(
    origin: GitHubOrigin,
    display_name: String,
    id: Option<String>,
    expected_revision: Option<String>,
    store: State<'_, SkillStore>,
) -> Result<SkillRecord, String> {
    origin.validate()?;
    // Download the pinned commit again: no mutable branch or frontend-supplied document is installed.
    let (document, _) = download(&client()?, &origin).await?;
    if document_hash(&document) != origin.document_hash {
        return Err("文件与已审阅的预览不一致，请重新获取预览；技能库未更改。".into());
    }
    store.save_from_github(id, expected_revision, document, display_name, origin)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn http_responses_are_bounded_even_without_content_length() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        fn response(wire: &[u8], limit: usize) -> Result<Vec<u8>, String> {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let wire = wire.to_vec();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).unwrap();
                let _ = stream.write_all(&wire); // The size guard may close before the whole fixture is sent.
            });
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let result = runtime.block_on(async {
                let client = Client::builder()
                    .no_proxy()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(3))
                    .build()
                    .unwrap();
                let response = client
                    .get(format!("http://{address}/"))
                    .send()
                    .await
                    .unwrap();
                read_response(response, limit).await
            });
            server.join().unwrap();
            result
        }
        assert_eq!(
            response(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ntest", 4).unwrap(),
            b"test"
        );
        assert!(
            response(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n12345", 4)
                .unwrap_err()
                .contains("大小限制")
        );
        assert!(response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n123\r\n3\r\n456\r\n0\r\n\r\n", 4).unwrap_err().contains("大小限制"));
        assert!(
            response(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\ntest", 10)
                .unwrap_err()
                .contains("读取")
        );
        assert!(
            response(
                b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://127.0.0.1:1/\r\n\r\n",
                4
            )
            .unwrap_err()
            .contains("跳转")
        );
        assert!(
            response(
                b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n",
                4
            )
            .unwrap_err()
            .contains("限制了请求")
        );
    }
    #[test]
    #[ignore = "requires access to public GitHub; never changes the skill library"]
    fn live_public_repository_preview() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let preview = runtime
            .block_on(preview_github_skill(
                "anthropics/skills".into(),
                "".into(),
                "skills/webapp-testing/SKILL.md".into(),
            ))
            .unwrap();
        assert_eq!(preview.preview.name, "webapp-testing");
        assert_eq!(
            preview.origin.document_hash,
            document_hash(&preview.document)
        );
        preview.origin.validate().unwrap();
    }
    #[test]
    fn restricts_repositories_paths_and_provenance() {
        for input in [
            "owner/repo",
            "https://github.com/owner/repo.git/",
            "https://github.com/owner/repo",
        ] {
            assert_eq!(repository_name(input).unwrap(), "owner/repo");
        }
        for input in [
            "http://github.com/owner/repo",
            "https://github.com.evil.test/owner/repo",
            "https://user@github.com/owner/repo",
            "https://github.com/owner/repo?token=secret",
            "https://github.com/owner/repo/blob/main/SKILL.md",
            "../..",
            "file:///secret",
        ] {
            assert!(repository_name(input).is_err(), "{input}");
        }
        assert_eq!(skill_path("").unwrap(), "SKILL.md");
        for path in [
            "../SKILL.md",
            "/SKILL.md",
            "scripts/run.sh",
            "a\\SKILL.md",
            "a//SKILL.md",
            "a/./SKILL.md",
            "a/../SKILL.md",
            "a/\0/SKILL.md",
        ] {
            assert!(skill_path(path).is_err(), "{path}");
        }
        let origin = GitHubOrigin {
            repository: "owner/repo".into(),
            path: "skills/中文 #?%/SKILL.md".into(),
            commit: "a".repeat(40),
            document_hash: "b".repeat(64),
        };
        let url = origin.content_url().unwrap();
        assert_eq!(url.host_str(), Some("api.github.com"));
        assert_eq!(url.query(), Some(format!("ref={}", origin.commit).as_str()));
        assert!(url.fragment().is_none());
        assert!(url.as_str().contains("%23%3F%25"));
        let mut invalid = origin.clone();
        invalid.commit = "main".into();
        assert!(invalid.validate().is_err());
        invalid = origin.clone();
        invalid.document_hash = "x".repeat(64);
        assert!(invalid.validate().is_err());
    }
    #[test]
    fn downloaded_text_obeys_local_import_limits() {
        assert!(parse_download(vec![0xff]).is_err());
        assert!(parse_download(b"a symlink target or HTML response".to_vec()).is_err());
        assert!(parse_download(vec![b'x'; MAX_DOCUMENT + 1]).is_err());
        let (text, preview) = parse_download(
            b"---\nname: github-test\ndescription: test\n---\nplain instructions".to_vec(),
        )
        .unwrap();
        assert_eq!(preview.name, "github-test");
        assert_eq!(document_hash(&text).len(), 64);
        assert_eq!(
            status_error(StatusCode::FOUND),
            "GitHub 地址发生跳转。请填写仓库当前的首页地址后重试。"
        );
    }
}
