use crate::local_data;
use base64::Engine;
use reqwest::{Client, Response, Url, header};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};
use tauri::State;
use tokio::sync::oneshot;
use uuid::Uuid;

const MODERN_VERSION: &str = "2026-07-28";
const LEGACY_VERSIONS: [&str; 3] = ["2025-11-25", "2025-06-18", "2025-03-26"];
#[cfg(not(test))]
const CREDENTIAL_SERVICE: &str = "ModelPort.MCP";
const CONFIG_LIMIT: usize = 128 * 1024;
const RESPONSE_LIMIT: usize = 512 * 1024;
const SCHEMA_LIMIT: usize = 8 * 1024;
const ARGUMENT_LIMIT: usize = 16 * 1024;
const RESULT_LIMIT: usize = 64 * 1024;
const MAX_TOOLS: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpSelection {
    pub id: String,
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub revision: String,
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub has_token: bool,
}

impl McpServer {
    pub fn selection(&self) -> McpSelection {
        McpSelection {
            id: self.id.clone(),
            revision: self.revision.clone(),
        }
    }
    fn validate(&self) -> Result<(), String> {
        validate_id(&self.id)?;
        validate_revision(&self.revision)?;
        if self.name.trim().is_empty()
            || self.name.chars().count() > 60
            || self
                .name
                .chars()
                .any(|c| c.is_control() || invisible_direction(c))
        {
            return Err("MCP 服务名称须为 1–60 个字符，不能包含控制字符。".into());
        }
        validate_url(&self.url)?;
        if self.disabled_tools.len() > MAX_TOOLS {
            return Err("最多禁用 32 个 MCP 工具。".into());
        }
        let mut unique = HashSet::new();
        for name in &self.disabled_tools {
            validate_tool_name(name)?;
            if !unique.insert(name) {
                return Err("禁用工具列表不能重复。".into());
            }
        }
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        Ok(())
    } else {
        Err("MCP 服务标识无效。".into())
    }
}
fn validate_revision(revision: &str) -> Result<(), String> {
    if revision.len() == 64
        && revision
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        Ok(())
    } else {
        Err("MCP 配置版本无效，请刷新服务列表。".into())
    }
}
fn new_revision() -> String {
    format!("{:x}", Sha256::digest(Uuid::new_v4().as_bytes()))
}
fn validate_tool_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return Err("MCP 工具名称无效，仅支持 1–128 字节的字母、数字、下划线、点和短横线。".into());
    }
    Ok(())
}

fn invisible_direction(c: char) -> bool {
    matches!(c, '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && a != 0
                && a < 224
                && a != 127
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && (b == 0 || (b == 168) || (b == 88 && c == 99)))
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            // Only global unicast; reject mapped IPv4, transition, documentation and local networks.
            let segments = ip.segments();
            (segments[0] & 0xe000) == 0x2000
                && segments[0] != 0x2002
                && segments[0] != 0x3fff
                && !(segments[0] == 0x2001 && (segments[1] < 0x0200 || segments[1] == 0x0db8))
                && !ip.is_loopback()
                && ip.to_ipv4_mapped().is_none()
        }
    }
}

fn validate_url(value: &str) -> Result<Url, String> {
    if value.len() > 1000
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
        || value.contains('\\')
    {
        return Err("MCP 地址格式无效。".into());
    }
    let url = Url::parse(value).map_err(|_| "请输入完整 MCP 服务地址。")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err("MCP 地址不能包含用户名、密码、查询参数或 # 片段；令牌请单独保存。".into());
    }
    let literal = url
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']'])
        .parse::<IpAddr>()
        .ok();
    let loopback = literal.is_some_and(|ip| ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(
            "远程 MCP 必须使用 HTTPS；HTTP 仅允许明确的本机回环 IP（127.0.0.1 / ::1）。".into(),
        );
    }
    if literal.is_some_and(|ip| !ip.is_loopback() && !public_ip(ip)) {
        return Err("MCP 不允许访问私有、链路本地、保留或云元数据地址。".into());
    }
    if url.port_or_known_default().is_none_or(|port| port == 0) {
        return Err("MCP 服务端口无效。".into());
    }
    Ok(url)
}

#[derive(Default)]
struct StoreRuntime {
    busy: HashMap<String, usize>,
    #[cfg(test)]
    tokens: HashMap<String, String>,
}

pub struct McpStore {
    root: PathBuf,
    runtime: Mutex<StoreRuntime>,
}

impl McpStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            runtime: Mutex::default(),
        }
    }
    fn read(&self) -> Result<Vec<McpServer>, String> {
        local_data::check_path(&self.root)?;
        let servers: Vec<McpServer> =
            local_data::read_json(&self.root.join("mcp.json"), CONFIG_LIMIT)?.unwrap_or_default();
        if servers.len() > 16 {
            return Err("最多保存 16 个 MCP 服务。".into());
        }
        let mut unique = HashSet::new();
        for server in &servers {
            server.validate()?;
            if !unique.insert(&server.id) {
                return Err("MCP 服务标识重复，原数据未更改。".into());
            }
        }
        Ok(servers)
    }
    fn write(&self, servers: &[McpServer]) -> Result<(), String> {
        let mut metadata = servers.to_vec();
        for server in &mut metadata {
            server.has_token = false;
        }
        local_data::write_json(&self.root.join("mcp.json"), &metadata, CONFIG_LIMIT)
    }
    #[cfg(not(test))]
    fn token(&self, id: &str, _: &StoreRuntime) -> Result<Option<String>, String> {
        validate_id(id)?;
        let entry =
            keyring::Entry::new(CREDENTIAL_SERVICE, id).map_err(|_| "无法访问 MCP 系统凭据库。")?;
        match entry.get_password() {
            Ok(token) => {
                validate_token(&token)?;
                Ok(Some(token))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取 MCP 访问令牌，请检查系统凭据库。".into()),
        }
    }
    #[cfg(test)]
    fn token(&self, id: &str, runtime: &StoreRuntime) -> Result<Option<String>, String> {
        Ok(runtime.tokens.get(id).cloned())
    }
    #[cfg(not(test))]
    fn set_token(&self, id: &str, token: Option<&str>, _: &mut StoreRuntime) -> Result<(), String> {
        let entry =
            keyring::Entry::new(CREDENTIAL_SERVICE, id).map_err(|_| "无法访问 MCP 系统凭据库。")?;
        match token {
            Some(token) => entry
                .set_password(token)
                .map_err(|_| "保存 MCP 访问令牌失败。".into()),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("删除 MCP 访问令牌失败。".into()),
            },
        }
    }
    #[cfg(test)]
    fn set_token(
        &self,
        id: &str,
        token: Option<&str>,
        runtime: &mut StoreRuntime,
    ) -> Result<(), String> {
        match token {
            Some(token) => {
                runtime.tokens.insert(id.into(), token.into());
            }
            None => {
                runtime.tokens.remove(id);
            }
        }
        Ok(())
    }
    fn current(&self, selection: &McpSelection) -> Result<McpServer, String> {
        validate_id(&selection.id)?;
        validate_revision(&selection.revision)?;
        let server = self
            .read()?
            .into_iter()
            .find(|item| item.id == selection.id)
            .ok_or("MCP 服务已删除，请重新选择。")?;
        if server.revision != selection.revision {
            return Err("MCP 配置或凭据已改变，请刷新后重新选择并授权。".into());
        }
        Ok(server)
    }
    fn idle(runtime: &StoreRuntime, id: &str) -> Result<(), String> {
        if runtime.busy.get(id).copied().unwrap_or_default() > 0 {
            Err(
                "该 MCP 服务有请求正在进行，请先停止对话或等待连接测试结束，再修改配置或凭据。"
                    .into(),
            )
        } else {
            Ok(())
        }
    }
    pub fn list(&self) -> Result<Vec<McpServer>, String> {
        let runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let mut servers = self.read()?;
        for server in &mut servers {
            server.has_token = self.token(&server.id, &runtime)?.is_some();
        }
        Ok(servers)
    }
    pub fn save(&self, mut config: McpServer) -> Result<McpServer, String> {
        let runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let _lock = local_data::lock(&self.root)?;
        let mut servers = self.read()?;
        if config.id.is_empty() {
            if servers.len() >= 16 {
                return Err("最多保存 16 个 MCP 服务。".into());
            }
            config.id = Uuid::new_v4().to_string();
            config.enabled = false;
            config.has_token = false;
            config.revision = new_revision();
            config.validate()?;
            servers.push(config.clone());
        } else {
            let old = self.current(&config.selection())?;
            Self::idle(&runtime, &config.id)?;
            config.has_token = self.token(&config.id, &runtime)?.is_some();
            if old.url != config.url && config.has_token {
                return Err("更改 MCP 地址前必须删除旧令牌，防止令牌被发送到另一个地址。".into());
            }
            config.revision = new_revision();
            config.validate()?;
            *servers
                .iter_mut()
                .find(|server| server.id == config.id)
                .unwrap() = config.clone();
        }
        self.write(&servers)?;
        Ok(config)
    }
    pub fn remove(&self, selection: &McpSelection) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let _lock = local_data::lock(&self.root)?;
        let server = self.current(selection)?;
        Self::idle(&runtime, &server.id)?;
        let token = self.token(&server.id, &runtime)?;
        let mut servers = self.read()?;
        servers.retain(|item| item.id != server.id);
        self.set_token(&server.id, None, &mut runtime)?;
        if self.write(&servers).is_err() {
            self.set_token(&server.id, token.as_deref(), &mut runtime)?;
            return Err("删除 MCP 配置失败，原配置保留。".into());
        }
        Ok(())
    }
    pub fn update_token(
        &self,
        selection: &McpSelection,
        token: Option<&str>,
    ) -> Result<McpServer, String> {
        if let Some(token) = token {
            validate_token(token)?;
        }
        let mut runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let _lock = local_data::lock(&self.root)?;
        let mut server = self.current(selection)?;
        Self::idle(&runtime, &server.id)?;
        let old_token = self.token(&server.id, &runtime)?;
        let mut servers = self.read()?;
        server.revision = new_revision();
        server.has_token = token.is_some();
        *servers
            .iter_mut()
            .find(|item| item.id == server.id)
            .unwrap() = server.clone();
        self.set_token(&server.id, token, &mut runtime)?;
        if self.write(&servers).is_err() {
            self.set_token(&server.id, old_token.as_deref(), &mut runtime)?;
            return Err("保存 MCP 配置版本失败，令牌已恢复，原配置保留。".into());
        }
        Ok(server)
    }
    fn acquire(
        &self,
        selection: &McpSelection,
        require_enabled: bool,
    ) -> Result<(RequestLease<'_>, McpServer, Option<String>), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let mut server = self.current(selection)?;
        if require_enabled && !server.enabled {
            return Err("MCP 服务已停用，请在设置中启用并重新选择。".into());
        }
        let token = self.token(&server.id, &runtime)?;
        server.has_token = token.is_some();
        *runtime.busy.entry(server.id.clone()).or_default() += 1;
        Ok((
            RequestLease {
                store: self,
                id: server.id.clone(),
            },
            server,
            token,
        ))
    }
    fn unchanged(
        &self,
        selection: &McpSelection,
        token: &Option<String>,
        require_enabled: bool,
    ) -> Result<(), String> {
        let runtime = self.runtime.lock().map_err(|_| "MCP 状态不可用。")?;
        let server = self.current(selection)?;
        if require_enabled && !server.enabled {
            return Err("MCP 服务已停用。".into());
        }
        if &self.token(&server.id, &runtime)? != token {
            return Err("MCP 凭据已改变，本次授权失效。".into());
        }
        Ok(())
    }
}

struct RequestLease<'a> {
    store: &'a McpStore,
    id: String,
}
impl Drop for RequestLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.store.runtime.lock() {
            if let Some(count) = runtime.busy.get_mut(&self.id) {
                *count = count.saturating_sub(1);
            }
            runtime.busy.retain(|_, count| *count > 0);
        }
    }
}

fn validate_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 4096 || !token.bytes().all(|c| (33..=126).contains(&c)) {
        return Err("访问令牌须为 1–4096 字节的可打印 ASCII 字符，不能包含空格或换行；无需填写 Bearer 前缀。".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub server: McpServer,
    pub tools: Vec<McpTool>,
    pub protocol_version: String,
}

pub struct McpSession {
    pub server: McpServer,
    pub tools: Vec<McpTool>,
    pub protocol_version: String,
    client: Client,
    token: Option<String>,
    session_id: Option<String>,
    output_schemas: HashMap<String, Value>,
}

async fn pinned_client(url: &Url) -> Result<Client, String> {
    let host = url
        .host_str()
        .ok_or("MCP 地址缺少主机。")?
        .trim_matches(['[', ']']);
    let port = url.port_or_known_default().ok_or("MCP 地址缺少端口。")?;
    let addresses: Vec<SocketAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        let resolved = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::lookup_host((host, port)),
        )
        .await
        .map_err(|_| "MCP 主机解析超时。")?
        .map_err(|_| "无法解析 MCP 主机。")?;
        let mut addresses: Vec<_> = resolved.take(17).collect();
        if addresses.is_empty()
            || addresses.len() > 16
            || addresses.iter().any(|address| !public_ip(address.ip()))
        {
            return Err(
                "MCP 主机解析到非公开或异常地址，已阻止连接以防止内网探测和 DNS 重绑定。".into(),
            );
        }
        addresses.sort();
        addresses.dedup();
        addresses
    };
    let mut builder = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(45))
        .pool_max_idle_per_host(0);
    if host.parse::<IpAddr>().is_err() {
        builder = builder.resolve_to_addrs(host, &addresses);
    }
    builder
        .build()
        .map_err(|_| "无法创建安全 MCP 网络连接。".into())
}

struct RpcReply {
    status: u16,
    value: Option<Value>,
    session_id: Option<String>,
}

fn rpc_message(method: &str, mut params: Value, id: Option<&str>, version: &str) -> Value {
    if version == MODERN_VERSION {
        params["_meta"] = json!({
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientInfo": { "name": "ModelPort", "version": env!("CARGO_PKG_VERSION") },
            "io.modelcontextprotocol/clientCapabilities": {}
        });
    }
    let mut message = json!({"jsonrpc":"2.0","method":method,"params":params});
    if let Some(id) = id {
        message["id"] = json!(id);
    }
    message
}

impl McpSession {
    async fn rpc(
        &self,
        method: &str,
        params: Value,
        id: Option<&str>,
        probe: bool,
    ) -> Result<RpcReply, String> {
        let message = rpc_message(method, params.clone(), id, &self.protocol_version);
        let bytes = serde_json::to_vec(&message).map_err(|_| "无法生成 MCP 请求。")?;
        if bytes.len() > ARGUMENT_LIMIT + 4096 {
            return Err("MCP 请求超过安全大小限制。".into());
        }
        let mut request = self
            .client
            .post(&self.server.url)
            .header(header::ACCEPT, "application/json, text/event-stream")
            .header(header::CONTENT_TYPE, "application/json")
            .header("MCP-Protocol-Version", &self.protocol_version);
        if self.protocol_version == MODERN_VERSION {
            request = request.header("Mcp-Method", method);
            if let Some(name) = params.get("name").and_then(Value::as_str) {
                request = request.header("Mcp-Name", encoded_header(name));
            }
            if method == "tools/call" {
                let name = params["name"].as_str().ok_or("MCP 工具请求无效。")?;
                let tool = self
                    .tools
                    .iter()
                    .find(|tool| tool.name == name)
                    .ok_or("MCP 工具未授权。")?;
                for (path, name) in header_specs(&tool.input_schema)? {
                    let mut value = &params["arguments"];
                    for part in path {
                        value = value.get(&part).unwrap_or(&Value::Null);
                    }
                    if value.is_null() {
                        continue;
                    }
                    let text = match value {
                        Value::String(text) => text.clone(),
                        Value::Bool(value) => value.to_string(),
                        Value::Number(value) => {
                            let value = value.as_i64().ok_or("MCP 头参数必须为安全整数。")?;
                            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value) {
                                return Err("MCP 头参数超出安全整数范围。".into());
                            }
                            value.to_string()
                        }
                        _ => return Err("MCP 头参数类型无效。".into()),
                    };
                    let encoded = encoded_header(&text);
                    if encoded.len() > 4096 {
                        return Err("MCP 头参数超过安全大小限制。".into());
                    }
                    request = request.header(format!("Mcp-Param-{name}"), encoded);
                }
            }
        } else if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id);
        }
        if let Some(token) = &self.token {
            let mut authorization = header::HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|_| "MCP 访问令牌格式无效。")?;
            authorization.set_sensitive(true);
            request = request.header(header::AUTHORIZATION, authorization);
        }
        let response = request.body(bytes).send().await.map_err(|error| {
            if error.is_timeout() {
                "MCP 请求超时；执行可能已经发生，请核查服务状态，不要盲目重复执行。"
            } else {
                "MCP 网络连接失败；不会自动重试工具操作。"
            }
        })?;
        read_reply(response, id, probe).await
    }
    pub fn validate_call(&self, store: &McpStore, name: &str, args: &Value) -> Result<(), String> {
        store.unchanged(&self.server.selection(), &self.token, true)?;
        if self
            .server
            .disabled_tools
            .iter()
            .any(|disabled| disabled == name)
        {
            return Err("该 MCP 工具已被禁用。".into());
        }
        let tool = self
            .tools
            .iter()
            .find(|tool| tool.name == name)
            .ok_or("模型请求了未发现或未授权的 MCP 工具。")?;
        validate_tool_arguments(tool, args)
    }
    pub async fn call(
        &mut self,
        store: &McpStore,
        name: &str,
        args: &Value,
    ) -> Result<Value, String> {
        self.validate_call(store, name, args)?;
        let (_lease, _, token) = store.acquire(&self.server.selection(), true)?;
        if token != self.token {
            return Err("MCP 凭据已改变，本次授权失效。".into());
        }
        let id = Uuid::new_v4().to_string();
        let reply = self
            .rpc(
                "tools/call",
                json!({"name":name,"arguments":args}),
                Some(&id),
                false,
            )
            .await?;
        store.unchanged(&self.server.selection(), &self.token, true)?;
        let result = rpc_result(reply)?;
        validate_result(
            &result,
            self.output_schemas.get(name),
            self.token.as_deref(),
        )
    }
}

fn encoded_header(text: &str) -> String {
    if text.trim() == text
        && text.bytes().all(|c| (32..=126).contains(&c))
        && !(text.starts_with("=?base64?") && text.ends_with("?="))
    {
        text.to_owned()
    } else {
        format!(
            "=?base64?{}?=",
            base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
        )
    }
}

fn check_rpc(value: &Value, id: &str) -> Result<bool, String> {
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || !value.is_object() {
        return Err("MCP 返回了无效 JSON-RPC 消息。".into());
    }
    if value.get("method").is_some() {
        if value.get("id").is_some() {
            return Err(
                "MCP 服务请求了未支持的客户端能力，已阻止；不会执行采样、命令或额外授权。".into(),
            );
        }
        let method = value["method"].as_str().ok_or("MCP 通知格式无效。")?;
        if !matches!(
            method,
            "notifications/progress"
                | "notifications/message"
                | "notifications/tools/list_changed"
                | "notifications/resources/list_changed"
                | "notifications/prompts/list_changed"
        ) {
            return Err("MCP 服务返回了未支持的通知。".into());
        }
        return Ok(false);
    }
    if value.get("id").and_then(Value::as_str) != Some(id)
        || value.get("result").is_some() == value.get("error").is_some()
    {
        return Err("MCP 响应标识不匹配或结果格式无效，已阻止处理。".into());
    }
    if let Some(error) = value.get("error") {
        if error.get("code").and_then(Value::as_i64).is_none()
            || error.get("message").and_then(Value::as_str).is_none()
        {
            return Err("MCP 错误响应格式无效。".into());
        }
    }
    Ok(true)
}

async fn read_reply(
    mut response: Response,
    id: Option<&str>,
    probe: bool,
) -> Result<RpcReply, String> {
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err("MCP 服务拒绝访问，请检查令牌和服务权限；不会自动申请更高权限。".into());
    }
    if (300..400).contains(&status) {
        return Err("MCP 服务要求重定向，已阻止以保护令牌；请核实并手动填写最终地址。".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT as u64)
    {
        return Err("MCP 响应超过安全大小限制。".into());
    }
    let session_id = response
        .headers()
        .get("Mcp-Session-Id")
        .map(|value| -> Result<String, String> {
            let value = value.to_str().map_err(|_| "MCP 会话标识无效。")?;
            if value.is_empty()
                || value.len() > 256
                || !value.bytes().all(|c| (33..=126).contains(&c))
            {
                return Err("MCP 会话标识无效。".into());
            }
            Ok(value.to_owned())
        })
        .transpose()?;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let mut bytes = Vec::new();
    let mut sse = SseParser::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取 MCP 响应失败；工具可能已经执行，不会自动重试。")?
    {
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("MCP 响应超过安全大小限制，已停止接收。".into());
        }
        bytes.extend_from_slice(&chunk);
        if content_type == "text/event-stream" {
            if let Some(value) = sse.push(&chunk, id.ok_or("MCP 通知不能返回事件流。")?)?
            {
                return Ok(RpcReply {
                    status,
                    value: Some(value),
                    session_id,
                });
            }
        }
    }
    if id.is_none() {
        if status != 202 || !bytes.is_empty() {
            return Err("MCP 初始化通知未被正确接受。".into());
        }
        return Ok(RpcReply {
            status,
            value: None,
            session_id,
        });
    }
    if content_type == "text/event-stream" {
        return Err("MCP 事件流结束，但未收到对应请求结果。".into());
    }
    if content_type != "application/json" {
        if probe && matches!(status, 400 | 404 | 405) {
            return Ok(RpcReply {
                status,
                value: None,
                session_id,
            });
        }
        return Err(
            "MCP 响应必须为 JSON 或请求范围内的 SSE 事件流；旧版 SSE-only 地址暂不支持。".into(),
        );
    }
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) if probe && matches!(status, 400 | 404 | 405) => {
            return Ok(RpcReply {
                status,
                value: None,
                session_id,
            });
        }
        Err(_) => return Err("MCP 返回了无效 JSON。".into()),
    };
    if !check_rpc(&value, id.unwrap())? {
        return Err("MCP 请求未返回结果。".into());
    }
    Ok(RpcReply {
        status,
        value: Some(value),
        session_id,
    })
}

#[derive(Default)]
struct SseParser {
    pending: Vec<u8>,
    data: String,
    notifications: usize,
}
impl SseParser {
    fn push(&mut self, bytes: &[u8], id: &str) -> Result<Option<Value>, String> {
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let raw: Vec<_> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&raw[..raw.len() - 1])
                .map_err(|_| "MCP 事件流必须使用 UTF-8。")?
                .trim_end_matches('\r');
            if line.is_empty() {
                if self.data.is_empty() {
                    continue;
                }
                let value: Value = serde_json::from_str(self.data.trim_end_matches('\n'))
                    .map_err(|_| "MCP 事件包含无效 JSON。")?;
                self.data.clear();
                if check_rpc(&value, id)? {
                    return Ok(Some(value));
                }
                self.notifications += 1;
                if self.notifications > 128 {
                    return Err("MCP 通知过多，已停止接收。".into());
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                self.data.push('\n');
                if self.data.len() > RESPONSE_LIMIT {
                    return Err("MCP 事件超过安全大小限制。".into());
                }
            } else if line.starts_with(':')
                || line.starts_with("event:")
                || line.starts_with("id:")
                || line.starts_with("retry:")
            {
                // No resume/retry: a dropped tool request must never be silently replayed.
            } else {
                return Err("MCP 事件流格式无效。".into());
            }
        }
        if self.pending.len() > RESPONSE_LIMIT {
            return Err("MCP 事件行超过安全大小限制。".into());
        }
        Ok(None)
    }
}

fn rpc_result(reply: RpcReply) -> Result<Value, String> {
    let value = reply
        .value
        .ok_or_else(|| format!("MCP 请求失败（HTTP {}）。", reply.status))?;
    if let Some(error) = value.get("error") {
        let code = error["code"].as_i64().unwrap_or_default();
        return Err(format!(
            "MCP 服务返回协议错误（代码 {code}）；不会自动重试工具操作。"
        ));
    }
    if !(200..300).contains(&reply.status) {
        return Err(format!("MCP 请求失败（HTTP {}）。", reply.status));
    }
    let result = value.get("result").cloned().ok_or("MCP 未返回结果。")?;
    complete_result(&result)?;
    Ok(result)
}
fn complete_result(result: &Value) -> Result<(), String> {
    if !result.is_object() {
        return Err("MCP 结果必须为对象。".into());
    }
    match result.get("resultType").and_then(Value::as_str) {
        None if !result.get("resultType").is_some() => Ok(()),
        Some("complete") => Ok(()),
        Some("input_required") => Err(
            "该 MCP 操作要求额外登录、采样或用户输入，首版暂不支持；未自动提供任何信息。".into(),
        ),
        _ => Err("MCP 返回了未支持的结果类型。".into()),
    }
}

pub async fn connect(store: &McpStore, selection: &McpSelection) -> Result<McpSession, String> {
    connect_inner(store, selection, true).await
}

async fn connect_inner(
    store: &McpStore,
    selection: &McpSelection,
    require_enabled: bool,
) -> Result<McpSession, String> {
    let (_lease, server, token) = store.acquire(selection, require_enabled)?;
    let url = validate_url(&server.url)?;
    let mut session = McpSession {
        server,
        tools: vec![],
        protocol_version: MODERN_VERSION.into(),
        client: pinned_client(&url).await?,
        token,
        session_id: None,
        output_schemas: HashMap::new(),
    };
    let id = Uuid::new_v4().to_string();
    let probe = session
        .rpc("server/discover", json!({}), Some(&id), true)
        .await?;
    let code = probe
        .value
        .as_ref()
        .and_then(|value| value["error"]["code"].as_i64());
    if code == Some(-32022) {
        let supported = probe
            .value
            .as_ref()
            .and_then(|value| value["error"]["data"]["supported"].as_array())
            .ok_or("MCP 协议版本协商响应无效。")?;
        if !supported.iter().any(|value| {
            LEGACY_VERSIONS
                .iter()
                .any(|version| value.as_str() == Some(version))
        }) {
            return Err("该 MCP 服务不支持 ModelPort 当前实现的协议版本。".into());
        }
        initialize_legacy(&mut session).await?;
    } else if matches!(code, Some(-32020 | -32021)) {
        return Err("MCP 服务要求首版未支持的协议能力，已阻止连接。".into());
    } else if probe
        .value
        .as_ref()
        .is_some_and(|value| value.get("result").is_some())
        && (200..300).contains(&probe.status)
    {
        let result = rpc_result(probe)?;
        if !result["supportedVersions"]
            .as_array()
            .is_some_and(|versions| {
                versions
                    .iter()
                    .any(|value| value.as_str() == Some(MODERN_VERSION))
            })
        {
            return Err("MCP 服务发现未声明受支持的现代协议版本。".into());
        }
        require_tools(&result)?;
    } else if code == Some(-32601)
        || (matches!(probe.status, 400 | 404 | 405) && !matches!(code, Some(-32022..=-32020)))
    {
        initialize_legacy(&mut session).await?;
    } else {
        return Err(
            "MCP 服务发现失败；请确认地址为 Streamable HTTP MCP 端点，旧版 SSE-only 暂不支持。"
                .into(),
        );
    }
    let mut cursor: Option<String> = None;
    let mut cursors = HashSet::new();
    let mut names = HashSet::new();
    for page in 0..4 {
        let params = cursor
            .as_ref()
            .map_or_else(|| json!({}), |cursor| json!({"cursor":cursor}));
        let id = Uuid::new_v4().to_string();
        let result = rpc_result(session.rpc("tools/list", params, Some(&id), false).await?)?;
        let tools = result["tools"].as_array().ok_or("MCP 工具列表格式无效。")?;
        for value in tools {
            if session.tools.len() >= MAX_TOOLS {
                return Err("MCP 工具超过首版 32 个工具的安全上限。".into());
            }
            if session
                .token
                .as_ref()
                .is_some_and(|token| contains_token(value, token))
            {
                return Err("MCP 工具描述包含当前访问令牌，已阻止并且不会交给模型；请检查服务是否泄露凭据。".into());
            }
            let tool = parse_tool(value)?;
            if !names.insert(tool.name.clone()) {
                return Err("MCP 服务返回了重复工具名称。".into());
            }
            if let Some(output) = value.get("outputSchema") {
                validate_schema(output, false)?;
                session
                    .output_schemas
                    .insert(tool.name.clone(), output.clone());
            }
            session.tools.push(tool);
        }
        match result.get("nextCursor") {
            None | Some(Value::Null) => break,
            Some(Value::String(value))
                if !value.is_empty()
                    && value.len() <= 1024
                    && !value.chars().any(char::is_control) =>
            {
                if !cursors.insert(value.clone()) || page == 3 {
                    return Err("MCP 工具分页重复或超过安全上限。".into());
                }
                cursor = Some(value.clone());
            }
            _ => return Err("MCP 工具分页标识无效。".into()),
        }
    }
    store.unchanged(selection, &session.token, require_enabled)?;
    Ok(session)
}

fn require_tools(result: &Value) -> Result<(), String> {
    if !result
        .get("capabilities")
        .and_then(|capabilities| capabilities.get("tools"))
        .is_some_and(Value::is_object)
    {
        return Err("该 MCP 服务未声明工具能力；首版只支持工具服务。".into());
    }
    Ok(())
}
async fn initialize_legacy(session: &mut McpSession) -> Result<(), String> {
    session.protocol_version = LEGACY_VERSIONS[0].into();
    let id = Uuid::new_v4().to_string();
    let reply = session
        .rpc(
            "initialize",
            json!({"protocolVersion":LEGACY_VERSIONS[0], "capabilities":{},
        "clientInfo":{"name":"ModelPort","version":env!("CARGO_PKG_VERSION")}}),
            Some(&id),
            false,
        )
        .await?;
    session.session_id = reply.session_id.clone();
    let result = rpc_result(reply)?;
    let version = result["protocolVersion"]
        .as_str()
        .ok_or("MCP 初始化缺少协议版本。")?;
    if !LEGACY_VERSIONS.contains(&version) {
        return Err("该 MCP 服务协商了未支持的协议版本。".into());
    }
    session.protocol_version = version.into();
    require_tools(&result)?;
    session
        .rpc("notifications/initialized", json!({}), None, false)
        .await?;
    Ok(())
}

fn check_tree(value: &Value, depth: usize, nodes: &mut usize, schema: bool) -> Result<(), String> {
    *nodes += 1;
    if depth > 16 || *nodes > 1024 {
        return Err("MCP 数据结构过深或过于复杂，已阻止处理。".into());
    }
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if schema
                    && matches!(
                        key.as_str(),
                        "$ref" | "$dynamicRef" | "$recursiveRef" | "$id" | "$vocabulary"
                    )
                {
                    return Err("首版不支持包含引用、动态引用或自定义词汇的 MCP Schema，以防止外部读取和递归消耗。".into());
                }
                check_tree(value, depth + 1, nodes, schema)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                check_tree(value, depth + 1, nodes, schema)?;
            }
        }
        _ => (),
    }
    Ok(())
}
fn schema_validator(schema: &Value) -> Result<jsonschema::Validator, String> {
    let options = jsonschema::options().offline();
    let options = if schema.get("$schema").is_none() {
        options.with_draft(jsonschema::Draft::Draft202012)
    } else {
        options
    };
    options
        .with_pattern_options(
            jsonschema::PatternOptions::regex()
                .size_limit(64 * 1024)
                .dfa_size_limit(64 * 1024),
        )
        .should_validate_formats(true)
        .should_ignore_unknown_formats(false)
        .build(schema)
        .map_err(|_| "MCP Schema 无效或包含不支持的约束，已阻止工具。".into())
}
fn validate_schema(schema: &Value, input: bool) -> Result<(), String> {
    if serde_json::to_vec(schema)
        .map_err(|_| "MCP Schema 无效。")?
        .len()
        > SCHEMA_LIMIT
        || (!schema.is_object() && !schema.is_boolean())
    {
        return Err("MCP Schema 无效或超过 8 KiB 安全上限。".into());
    }
    if input && (!schema.is_object() || schema["type"].as_str() != Some("object")) {
        return Err("MCP 工具参数 Schema 必须声明 object 类型。".into());
    }
    if let Some(draft) = schema.get("$schema") {
        if !matches!(
            draft.as_str(),
            Some(
                "https://json-schema.org/draft/2020-12/schema"
                    | "http://json-schema.org/draft-07/schema#"
                    | "https://json-schema.org/draft-07/schema#"
            )
        ) {
            return Err("MCP Schema 使用了首版未支持的 JSON Schema 版本。".into());
        }
    }
    check_tree(schema, 0, &mut 0, true)?;
    schema_validator(schema)?;
    if input {
        header_specs(schema)?;
    }
    Ok(())
}

fn parse_tool(value: &Value) -> Result<McpTool, String> {
    let name = value["name"]
        .as_str()
        .ok_or("MCP 工具缺少名称。")?
        .to_owned();
    validate_tool_name(&name)?;
    let description = match value.get("description") {
        None => String::new(),
        Some(Value::String(value)) => value.clone(),
        _ => return Err("MCP 工具说明格式无效。".into()),
    };
    if description.len() > 2048
        || description.chars().any(|c| {
            invisible_direction(c) || (c.is_control() && c != '\n' && c != '\t' && c != '\r')
        })
    {
        return Err("MCP 工具说明过长或含有不安全控制字符。".into());
    }
    let input_schema = value
        .get("inputSchema")
        .cloned()
        .ok_or("MCP 工具缺少参数 Schema。")?;
    validate_schema(&input_schema, true)?;
    Ok(McpTool {
        name,
        description,
        input_schema,
    })
}
pub fn validate_tool_arguments(tool: &McpTool, args: &Value) -> Result<(), String> {
    if !args.is_object()
        || serde_json::to_vec(args)
            .map_err(|_| "MCP 工具参数无效。")?
            .len()
            > ARGUMENT_LIMIT
    {
        return Err("MCP 工具参数必须为对象，且不超过 16 KiB。".into());
    }
    check_tree(args, 0, &mut 0, false)?;
    validate_schema(&tool.input_schema, true)?;
    if !schema_validator(&tool.input_schema)?.is_valid(args) {
        return Err("模型生成的 MCP 参数不符合工具 Schema；未执行工具。".into());
    }
    Ok(())
}

fn header_specs(schema: &Value) -> Result<Vec<(Vec<String>, String)>, String> {
    fn walk(
        value: &Value,
        path: &[String],
        reachable: bool,
        result: &mut Vec<(Vec<String>, String)>,
        names: &mut HashSet<String>,
    ) -> Result<(), String> {
        match value {
            Value::Object(map) => {
                if let Some(name) = map.get("x-mcp-header") {
                    let name = name.as_str().ok_or("MCP 参数头标注无效。")?;
                    if !reachable
                        || path.is_empty()
                        || name.is_empty()
                        || name.len() > 60
                        || header::HeaderName::from_bytes(format!("Mcp-Param-{name}").as_bytes())
                            .is_err()
                        || !matches!(
                            map.get("type").and_then(Value::as_str),
                            Some("string" | "integer" | "boolean")
                        )
                        || !names.insert(name.to_ascii_lowercase())
                        || result.len() >= 32
                    {
                        return Err(
                            "MCP 参数头标注无效、重复或位于非静态属性路径，已阻止工具。".into()
                        );
                    }
                    result.push((path.to_vec(), name.into()));
                }
                for (key, value) in map {
                    if key == "properties" && value.is_object() {
                        for (property, schema) in value.as_object().unwrap() {
                            let mut nested = path.to_vec();
                            nested.push(property.clone());
                            walk(schema, &nested, reachable, result, names)?;
                        }
                    } else if key != "x-mcp-header" {
                        walk(value, path, false, result, names)?;
                    }
                }
            }
            Value::Array(values) => {
                for value in values {
                    walk(value, path, false, result, names)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    let mut result = vec![];
    walk(schema, &[], true, &mut result, &mut HashSet::new())?;
    Ok(result)
}

fn contains_token(value: &Value, token: &str) -> bool {
    match value {
        Value::String(value) => value.contains(token),
        Value::Object(map) => map
            .iter()
            .any(|(key, value)| key.contains(token) || contains_token(value, token)),
        Value::Array(values) => values.iter().any(|value| contains_token(value, token)),
        _ => false,
    }
}

fn scrub_token(value: &mut Value, token: Option<&str>) {
    match value {
        Value::String(text) => {
            if let Some(token) = token {
                *text = text.replace(token, "[MCP 令牌已隐藏]");
            }
        }
        Value::Object(map) => {
            for (key, mut value) in std::mem::take(map) {
                scrub_token(&mut value, token);
                let key = token.map_or(key.clone(), |token| key.replace(token, "[MCP 令牌已隐藏]"));
                map.insert(key, value);
            }
        }
        Value::Array(values) => {
            for value in values {
                scrub_token(value, token);
            }
        }
        _ => (),
    }
}
fn validate_result(
    result: &Value,
    output_schema: Option<&Value>,
    token: Option<&str>,
) -> Result<Value, String> {
    complete_result(result)?;
    if serde_json::to_vec(result)
        .map_err(|_| "MCP 结果无效。")?
        .len()
        > RESULT_LIMIT
    {
        return Err("MCP 工具结果超过 64 KiB 安全上限；操作可能已完成，请核查服务。".into());
    }
    check_tree(result, 0, &mut 0, false)?;
    let is_error = match result.get("isError") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => return Err("MCP 工具结果状态无效。".into()),
    };
    let mut content = Vec::new();
    if let Some(blocks) = result.get("content") {
        let blocks = blocks.as_array().ok_or("MCP 工具内容必须为数组。")?;
        if blocks.len() > 64 {
            return Err("MCP 工具内容块过多。".into());
        }
        for block in blocks {
            if block["type"].as_str() != Some("text") {
                return Err("首版只支持 MCP 文本和 JSON 结果；未打开链接、图片或嵌入资源。操作可能已完成，请核查服务。".into());
            }
            let text = block["text"].as_str().ok_or("MCP 文本结果格式无效。")?;
            content.push(json!({"type":"text","text":text}));
        }
    }
    if !result.get("content").is_some() && !result.get("structuredContent").is_some() {
        return Err("MCP 工具未返回受支持的结果内容。".into());
    }
    let mut safe = json!({"content":content,"isError":is_error});
    if let Some(structured) = result.get("structuredContent") {
        if !is_error {
            if let Some(schema) = output_schema {
                if !schema_validator(schema)?.is_valid(structured) {
                    return Err(
                        "MCP 结构化结果不符合声明的 Schema，未交给模型；操作可能已完成。".into(),
                    );
                }
            }
        }
        safe["structuredContent"] = structured.clone();
    } else if output_schema.is_some() && !is_error {
        return Err("MCP 工具声明了结果 Schema，但未返回结构化结果。".into());
    }
    scrub_token(&mut safe, token);
    if safe.to_string().len() > RESULT_LIMIT {
        return Err("MCP 脱敏结果超过安全大小限制；操作可能已完成，请核查服务。".into());
    }
    Ok(safe)
}

struct PendingApproval {
    request_id: String,
    sender: oneshot::Sender<bool>,
}
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}
impl ApprovalRegistry {
    pub fn create(
        &self,
        request_id: &str,
        approval_id: &str,
    ) -> Result<oneshot::Receiver<bool>, String> {
        validate_id(request_id)?;
        validate_id(approval_id)?;
        let mut pending = self.pending.lock().map_err(|_| "MCP 授权状态不可用。")?;
        if pending.len() >= 32 || pending.contains_key(approval_id) {
            return Err("MCP 授权请求过多或标识重复。".into());
        }
        let (sender, receiver) = oneshot::channel();
        pending.insert(
            approval_id.into(),
            PendingApproval {
                request_id: request_id.into(),
                sender,
            },
        );
        Ok(receiver)
    }
    pub fn remove(&self, approval_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(approval_id);
        }
    }
    pub fn decide(&self, request_id: &str, approval_id: &str, allow: bool) -> Result<(), String> {
        validate_id(request_id)?;
        validate_id(approval_id)?;
        let mut pending = self.pending.lock().map_err(|_| "MCP 授权状态不可用。")?;
        if !pending
            .get(approval_id)
            .is_some_and(|approval| approval.request_id == request_id)
        {
            return Err("MCP 授权已过期或不属于该对话请求，未执行工具。".into());
        }
        let approval = pending.remove(approval_id).unwrap();
        approval
            .sender
            .send(allow)
            .map_err(|_| "MCP 对话已停止，授权不再有效。".into())
    }
}

#[tauri::command]
pub fn list_mcp_servers(store: State<'_, McpStore>) -> Result<Vec<McpServer>, String> {
    store.list()
}
#[tauri::command]
pub fn save_mcp_server(config: McpServer, store: State<'_, McpStore>) -> Result<McpServer, String> {
    store.save(config)
}
#[tauri::command]
pub fn remove_mcp_server(
    selection: McpSelection,
    store: State<'_, McpStore>,
) -> Result<(), String> {
    store.remove(&selection)
}
#[tauri::command]
pub async fn test_mcp_server(
    selection: McpSelection,
    store: State<'_, McpStore>,
) -> Result<McpTestResult, String> {
    let session = connect_inner(&store, &selection, false).await?;
    Ok(McpTestResult {
        server: session.server,
        tools: session.tools,
        protocol_version: session.protocol_version,
    })
}
#[tauri::command]
pub fn save_mcp_token(
    selection: McpSelection,
    token: String,
    store: State<'_, McpStore>,
) -> Result<McpServer, String> {
    store.update_token(&selection, Some(&token))
}
#[tauri::command]
pub fn remove_mcp_token(
    selection: McpSelection,
    store: State<'_, McpStore>,
) -> Result<McpServer, String> {
    store.update_token(&selection, None)
}
#[tauri::command]
pub fn decide_mcp_tool(
    request_id: String,
    approval_id: String,
    allow: bool,
    registry: State<'_, ApprovalRegistry>,
) -> Result<(), String> {
    registry.decide(&request_id, &approval_id, allow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn http_fixture(
        modern: bool,
        count: usize,
    ) -> (String, std::thread::JoinHandle<Vec<(Value, String)>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let mut records = vec![];
            let deadline = std::time::Instant::now() + Duration::from_secs(8);
            while records.len() < count {
                assert!(
                    std::time::Instant::now() < deadline,
                    "MCP fixture timed out"
                );
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                // Windows can inherit the listener's nonblocking mode on accepted sockets.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = vec![];
                let (headers, end, length) = loop {
                    let mut buffer = [0; 4096];
                    let read = stream.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    bytes.extend_from_slice(&buffer[..read]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        break (headers, end + 4, length);
                    }
                    assert!(bytes.len() < 8192);
                };
                while bytes.len() < end + length {
                    let mut buffer = [0; 4096];
                    let read = stream.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    bytes.extend_from_slice(&buffer[..read]);
                }
                let message: Value = serde_json::from_slice(&bytes[end..end + length]).unwrap();
                let method = message["method"].as_str().unwrap();
                let id = message.get("id").cloned().unwrap_or(Value::Null);
                let result = match method {
                    "server/discover" if modern => {
                        json!({"resultType":"complete","supportedVersions":[MODERN_VERSION],"capabilities":{"tools":{}}})
                    }
                    "initialize" => {
                        json!({"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"Fixture","version":"1"}})
                    }
                    "tools/list" => {
                        json!({"tools":[{"name":"echo","description":"Fixture echo","inputSchema":{"type":"object","properties":{"query":{"type":"string","x-mcp-header":"Query"}},"required":["query"],"additionalProperties":false}}]})
                    }
                    "tools/call" => {
                        json!({"content":[{"type":"text","text":message["params"]["arguments"]["query"]}]})
                    }
                    _ => Value::Null,
                };
                let body = if method == "notifications/initialized" {
                    String::new()
                } else if result.is_null() {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unknown method"}}).to_string()
                } else {
                    json!({"jsonrpc":"2.0","id":id,"result":result}).to_string()
                };
                let status = if method == "notifications/initialized" {
                    "202 Accepted"
                } else {
                    "200 OK"
                };
                let session_header = if method == "initialize" {
                    "Mcp-Session-Id: fixture-session\r\n"
                } else {
                    ""
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{session_header}Connection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
                records.push((message, headers));
            }
            records
        });
        (url, thread)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn config() -> McpServer {
        McpServer {
            id: String::new(),
            name: "Local test".into(),
            url: "http://127.0.0.1:9392/mcp".into(),
            enabled: true,
            revision: String::new(),
            disabled_tools: vec![],
            has_token: true,
        }
    }
    #[test]
    fn urls_and_network_boundaries() {
        for url in [
            "http://127.0.0.1:9392/mcp",
            "http://[::1]:9392/mcp",
            "https://example.com/mcp",
        ] {
            validate_url(url).unwrap();
        }
        for url in [
            "http://localhost:9392/mcp",
            "http://remote.test/mcp",
            "https://user:pass@example.com/mcp",
            "https://example.com/mcp?token=secret",
            "https://example.com/mcp#secret",
            "https://169.254.169.254/mcp",
            "https://10.0.0.1/mcp",
            "https://[::ffff:127.0.0.1]/mcp",
            "file:///tmp/mcp",
            "https://example.com\\evil",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
        for ip in [
            "127.0.0.1",
            "0.0.0.0",
            "169.254.169.254",
            "192.168.1.1",
            "100.64.0.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "::ffff:8.8.8.8",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn persistence_defaults_revision_and_token_isolation() {
        let dir = tempfile::tempdir().unwrap();
        let store = McpStore::new(dir.path().join("mcp"));
        let first = store.save(config()).unwrap();
        assert!(!first.enabled);
        assert!(!first.has_token);
        let mut enabled = first.clone();
        enabled.enabled = true;
        let enabled = store.save(enabled).unwrap();
        assert_ne!(first.revision, enabled.revision);
        assert!(store.save(first.clone()).is_err());
        let token = store
            .update_token(&enabled.selection(), Some("test-secret"))
            .unwrap();
        assert!(token.has_token);
        assert_ne!(token.revision, enabled.revision);
        let text = std::fs::read_to_string(store.root.join("mcp.json")).unwrap();
        assert!(!text.contains("test-secret"));
        let mut changed = token.clone();
        changed.url = "http://127.0.0.1:9393/mcp".into();
        assert!(store.save(changed).is_err());
        assert!(store.unchanged(&enabled.selection(), &None, true).is_err());
        let (lease, _, _) = store.acquire(&token.selection(), true).unwrap();
        assert!(store.remove(&token.selection()).is_err());
        drop(lease);
        let removed = store.update_token(&token.selection(), None).unwrap();
        assert!(!removed.has_token);
        store.remove(&removed.selection()).unwrap();
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn corrupt_store_is_not_overwritten_and_metadata_is_not_authority() {
        let dir = tempfile::tempdir().unwrap();
        let store = McpStore::new(dir.path().join("mcp"));
        let first = store.save(config()).unwrap();
        let mut invalid = first.clone();
        invalid.revision = "a".repeat(64);
        assert!(store.save(invalid).is_err());
        std::fs::write(store.root.join("mcp.json"), b"broken").unwrap();
        assert!(store.save(config()).is_err());
        assert_eq!(
            std::fs::read(store.root.join("mcp.json")).unwrap(),
            b"broken"
        );
    }
    #[test]
    fn schema_validation_denies_external_refs_and_invalid_arguments() {
        let tool = parse_tool(&json!({"name":"safe","inputSchema":{"type":"object","properties":{"n":{"type":"integer","minimum":1,"maximum":3}},"required":["n"],"additionalProperties":false}})).unwrap();
        validate_tool_arguments(&tool, &json!({"n":2})).unwrap();
        for args in [
            json!({"n":0}),
            json!({"n":"2"}),
            json!({"n":2,"secret":"x"}),
            json!([]),
        ] {
            assert!(validate_tool_arguments(&tool, &args).is_err());
        }
        for schema in [
            json!({"type":"object","$ref":"https://evil.test/schema"}),
            json!({"type":"object","$ref":"#"}),
            json!({"type":"object","properties":{"x":{"$dynamicRef":"file:///secret"}}}),
            json!({"type":"object","$schema":"https://evil.test/schema"}),
        ] {
            assert!(validate_schema(&schema, true).is_err());
        }
    }
    #[test]
    fn strict_rpc_and_sse_ids_requests_and_limits() {
        assert!(check_rpc(&json!({"jsonrpc":"2.0","id":"wrong","result":{}}), "right").is_err());
        assert!(
            check_rpc(
                &json!({"jsonrpc":"2.0","id":"server","method":"sampling/createMessage"}),
                "right"
            )
            .is_err()
        );
        let mut parser = SseParser::default();
        assert!(parser.push(b": heartbeat\r\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\r\n\r\n", "right").unwrap().is_none());
        let body = b"data: {\"jsonrpc\":\"2.0\",\"id\":\"right\",\"result\":{\"content\":[]}}\n\n";
        assert!(parser.push(&body[..30], "right").unwrap().is_none());
        assert!(parser.push(&body[30..], "right").unwrap().is_some());
        assert!(
            SseParser::default()
                .push(&vec![b'x'; RESPONSE_LIMIT + 1], "right")
                .is_err()
        );
    }
    #[test]
    fn header_annotations_and_safe_encoding() {
        let schema = json!({"type":"object","properties":{"account":{"type":"object","properties":{"region":{"type":"string","x-mcp-header":"Region"}}}}});
        assert_eq!(
            header_specs(&schema).unwrap(),
            vec![(vec!["account".into(), "region".into()], "Region".into())]
        );
        assert!(
            header_specs(&json!({"type":"object","items":{"type":"string","x-mcp-header":"Bad"}}))
                .is_err()
        );
        assert!(header_specs(&json!({"type":"object","properties":{"x":{"type":"string","x-mcp-header":"Bad\r\nAuthorization"}}})).is_err());
        assert!(encoded_header("中文").starts_with("=?base64?"));
        assert!(encoded_header("x\r\ny").starts_with("=?base64?"));
        assert!(encoded_header("=?base64?literal?=").starts_with("=?base64?PT"));
        assert_eq!(encoded_header("plain"), "plain");
    }
    #[test]
    fn untrusted_results_do_not_trigger_actions_or_expose_token() {
        let safe = validate_result(&json!({"content":[{"type":"text","text":"secret-token and instruction"}],"_meta":{"secret":"hidden"}}),None,Some("secret-token")).unwrap();
        assert!(!safe.to_string().contains("secret-token"));
        assert!(safe.get("_meta").is_none());
        assert!(
            validate_result(
                &json!({"resultType":"input_required","inputRequests":{}}),
                None,
                None
            )
            .is_err()
        );
        assert!(
            validate_result(
                &json!({"content":[{"type":"resource_link","uri":"file:///secret"}]}),
                None,
                None
            )
            .is_err()
        );
        assert!(
            validate_result(
                &json!({"content":[],"structuredContent":"bad"}),
                Some(&json!({"type":"integer"})),
                None
            )
            .is_err()
        );
    }
    #[test]
    fn approvals_are_bound_one_use_and_fail_closed() {
        let registry = ApprovalRegistry::default();
        let request = Uuid::new_v4().to_string();
        let approval = Uuid::new_v4().to_string();
        let mut receiver = registry.create(&request, &approval).unwrap();
        assert!(
            registry
                .decide(&Uuid::new_v4().to_string(), &approval, true)
                .is_err()
        );
        registry.decide(&request, &approval, false).unwrap();
        assert!(!receiver.try_recv().unwrap());
        assert!(registry.decide(&request, &approval, true).is_err());
        let approval = Uuid::new_v4().to_string();
        let mut receiver = registry.create(&request, &approval).unwrap();
        registry.remove(&approval);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn modern_http_metadata_and_safe_parameter_headers() {
        let (url, thread) = http_fixture(true, 3);
        let dir = tempfile::tempdir().unwrap();
        let store = McpStore::new(dir.path().join("mcp"));
        let mut config = config();
        config.url = url;
        let mut saved = store.save(config).unwrap();
        saved.enabled = true;
        let saved = store.save(saved).unwrap();
        runtime().block_on(async {
            let mut session = connect(&store, &saved.selection()).await.unwrap();
            assert_eq!(session.protocol_version, MODERN_VERSION);
            let result = session
                .call(&store, "echo", &json!({"query":"中文\r\nHeader"}))
                .await
                .unwrap();
            assert_eq!(result["content"][0]["text"], "中文\r\nHeader");
        });
        let records = thread.join().unwrap();
        assert_eq!(
            records
                .iter()
                .map(|(message, _)| message["method"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["server/discover", "tools/list", "tools/call"]
        );
        for (message, headers) in &records {
            assert_eq!(
                message["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"],
                MODERN_VERSION
            );
            assert!(
                headers
                    .to_ascii_lowercase()
                    .contains("mcp-protocol-version: 2026-07-28")
            );
        }
        assert!(
            records[2]
                .1
                .to_ascii_lowercase()
                .contains("mcp-param-query: =?base64?")
        );
        assert!(!records[2].1.contains("\r\nHeader"));
    }

    #[test]
    fn legacy_http_handshake_and_test_never_execute_tools() {
        let (url, thread) = http_fixture(false, 4);
        let dir = tempfile::tempdir().unwrap();
        let store = McpStore::new(dir.path().join("mcp"));
        let mut config = config();
        config.url = url;
        let saved = store.save(config).unwrap();
        runtime().block_on(async {
            assert!(connect(&store, &saved.selection()).await.is_err());
            let session = connect_inner(&store, &saved.selection(), false)
                .await
                .unwrap();
            assert_eq!(session.protocol_version, "2025-11-25");
            assert_eq!(session.session_id.as_deref(), Some("fixture-session"));
            assert!(
                session
                    .validate_call(&store, "echo", &json!({"query":"x"}))
                    .is_err()
            );
        });
        let records = thread.join().unwrap();
        assert_eq!(
            records
                .iter()
                .map(|(message, _)| message["method"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "server/discover",
                "initialize",
                "notifications/initialized",
                "tools/list"
            ]
        );
        assert!(
            records[3]
                .1
                .to_ascii_lowercase()
                .contains("mcp-session-id: fixture-session")
        );
        assert!(
            !records
                .iter()
                .any(|(message, _)| message["method"] == "tools/call")
        );
    }
}
