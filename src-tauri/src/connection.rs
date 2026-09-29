use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::Duration,
};

use futures_util::{
    future::{Either, select},
    pin_mut,
};
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{State, ipc::Channel};
use tokio::sync::watch;

const CREDENTIAL_SERVICE: &str = "com.modelport.desktop";
const MAX_STREAM_LINE_BYTES: usize = 1024 * 1024;
const MAX_STREAM_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_PENDING_CANCELLATIONS: usize = 128;
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Default)]
pub struct CancellationRegistry {
    inner: Mutex<CancellationState>,
}

#[derive(Default)]
struct CancellationState {
    active: HashMap<String, watch::Sender<bool>>,
    pending: VecDeque<String>,
}

struct ActiveRequest<'a> {
    registry: &'a CancellationRegistry,
    request_id: String,
}

impl Drop for ActiveRequest<'_> {
    fn drop(&mut self) {
        let mut state = self
            .registry
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active.remove(&self.request_id);
    }
}

impl CancellationRegistry {
    fn register(
        &self,
        request_id: String,
    ) -> Result<(ActiveRequest<'_>, watch::Receiver<bool>), String> {
        validate_request_id(&request_id)?;
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.active.contains_key(&request_id) {
            return Err("该请求已在进行中。".to_string());
        }
        let already_cancelled = state.pending.iter().any(|id| id == &request_id);
        state.pending.retain(|id| id != &request_id);
        let (sender, receiver) = watch::channel(already_cancelled);
        state.active.insert(request_id.clone(), sender);
        Ok((
            ActiveRequest {
                registry: self,
                request_id,
            },
            receiver,
        ))
    }

    fn cancel(&self, request_id: &str) -> Result<(), String> {
        validate_request_id(request_id)?;
        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(sender) = state.active.get(request_id) {
            sender.send_replace(true);
        } else if !state.pending.iter().any(|id| id == request_id) {
            if state.pending.len() == MAX_PENDING_CANCELLATIONS {
                state.pending.pop_front();
            }
            state.pending.push_back(request_id.to_string());
        }
        Ok(())
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 128 || request_id.chars().any(char::is_control) {
        return Err("请求标识无效。".to_string());
    }
    Ok(())
}

async fn wait_for_cancel(receiver: &mut watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }
    let _ = receiver.changed().await;
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Deepseek,
    Ollama,
}

impl Provider {
    fn credential_name(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Deepseek => "deepseek",
            Self::Ollama => "ollama",
        }
    }

    fn models_url(self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1/models",
            Self::Deepseek => "https://api.deepseek.com/models",
            Self::Ollama => "http://127.0.0.1:11434/api/tags",
        }
    }

    fn chat_url(self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1/chat/completions",
            Self::Deepseek => "https://api.deepseek.com/chat/completions",
            Self::Ollama => "http://127.0.0.1:11434/api/chat",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    role: String,
    content: String,
}

fn credential(provider: Provider) -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, provider.credential_name())
        .map_err(|_| "无法访问系统安全凭据库。".to_string())
}

fn api_key(provider: Provider) -> Result<String, String> {
    if matches!(provider, Provider::Ollama) {
        return Ok(String::new());
    }
    credential(provider)?
        .get_password()
        .map_err(|_| "请先在设置中保存该服务的 API Key。".to_string())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "无法初始化网络客户端。".to_string())
}

fn stream_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "无法初始化网络客户端。".to_string())
}

fn validate_model(model: &str) -> Result<(), String> {
    if model.trim().is_empty() || model.len() > 128 || model.chars().any(char::is_control) {
        return Err("模型名称无效。".to_string());
    }
    Ok(())
}

fn validate_messages(messages: &[ChatMessage]) -> Result<(), String> {
    if messages.is_empty() || messages.len() > 100 {
        return Err("对话消息数量超出范围。".to_string());
    }
    let total: usize = messages.iter().map(|message| message.content.len()).sum();
    if total > 1_000_000
        || messages.iter().any(|message| {
            !matches!(message.role.as_str(), "user" | "assistant")
                || message.content.trim().is_empty()
        })
    {
        return Err("对话内容无效或过长。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn has_provider_key(provider: Provider) -> Result<bool, String> {
    if matches!(provider, Provider::Ollama) {
        return Ok(false);
    }
    match credential(provider)?.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("无法读取系统安全凭据库。".to_string()),
    }
}

#[tauri::command]
pub fn save_provider_key(provider: Provider, key: String) -> Result<(), String> {
    if matches!(provider, Provider::Ollama) {
        return Err("本地 Ollama 不需要 API Key。".to_string());
    }
    let key = key.trim();
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("API Key 不能为空，且不能包含控制字符。".to_string());
    }
    credential(provider)?
        .set_password(key)
        .map_err(|_| "保存到系统安全凭据库失败。".to_string())
}

#[tauri::command]
pub fn remove_provider_key(provider: Provider) -> Result<(), String> {
    if matches!(provider, Provider::Ollama) {
        return Err("本地 Ollama 没有 API Key。".to_string());
    }
    match credential(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法从系统安全凭据库删除 API Key。".to_string()),
    }
}

#[tauri::command]
pub async fn list_available_models(provider: Provider) -> Result<Vec<String>, String> {
    let client = http_client()?;
    let mut request = client.get(provider.models_url());
    if !matches!(provider, Provider::Ollama) {
        request = request.bearer_auth(api_key(provider)?);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "连接失败，请检查网络或本地模型服务。".to_string())?;
    if !response.status().is_success() {
        return Err(format!("连接失败，服务返回 HTTP {}。", response.status()));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "服务返回的模型列表格式无效。".to_string())?;
    let models = match provider {
        Provider::Ollama => payload["models"].as_array().map(|models| {
            models
                .iter()
                .filter_map(|model| model["name"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        }),
        _ => payload["data"].as_array().map(|models| {
            models
                .iter()
                .filter_map(|model| model["id"].as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        }),
    }
    .ok_or_else(|| "服务返回的模型列表格式无效。".to_string())?;
    Ok(models)
}

#[tauri::command]
pub async fn send_chat(
    provider: Provider,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    validate_model(&model)?;
    validate_messages(&messages)?;
    let client = http_client()?;
    let mut request = client.post(provider.chat_url());
    if !matches!(provider, Provider::Ollama) {
        request = request.bearer_auth(api_key(provider)?);
    }
    let body = json!({ "model": model, "messages": messages, "stream": false });
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|_| "发送失败，请检查连接与网络。".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "模型请求失败，服务返回 HTTP {}。",
            response.status()
        ));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "服务返回了无法识别的响应。".to_string())?;
    let content = match provider {
        Provider::Ollama => payload["message"]["content"].as_str(),
        _ => payload["choices"][0]["message"]["content"].as_str(),
    };
    content
        .filter(|content| !content.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "模型没有返回文本内容。".to_string())
}

struct StreamParser {
    provider: Provider,
    line: Vec<u8>,
    event_data: String,
    error_event: bool,
    done: bool,
    emitted_bytes: usize,
    has_text: bool,
}

struct ParseBatch {
    deltas: Vec<String>,
    error: Option<String>,
}

#[cfg(test)]
impl ParseBatch {
    fn unwrap(self) -> Vec<String> {
        assert!(self.error.is_none(), "{:?}", self.error);
        self.deltas
    }

    fn is_err(&self) -> bool {
        self.error.is_some()
    }
}

impl StreamParser {
    fn new(provider: Provider) -> Self {
        Self {
            provider,
            line: Vec::new(),
            event_data: String::new(),
            error_event: false,
            done: false,
            emitted_bytes: 0,
            has_text: false,
        }
    }

    fn push_bytes(&mut self, bytes: &[u8]) -> ParseBatch {
        let mut deltas = Vec::new();
        let error = self.push_bytes_inner(bytes, &mut deltas).err();
        ParseBatch { deltas, error }
    }

    fn push_bytes_inner(&mut self, bytes: &[u8], deltas: &mut Vec<String>) -> Result<(), String> {
        for &byte in bytes {
            if self.done {
                break;
            }
            if byte == b'\n' {
                let mut line = std::mem::take(&mut self.line);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                let line = std::str::from_utf8(&line)
                    .map_err(|_| "服务返回了无法识别的流式响应。".to_string())?;
                self.process_line(line, deltas)?;
            } else {
                if self.line.len() == MAX_STREAM_LINE_BYTES {
                    return Err("模型响应过长，已停止接收。".to_string());
                }
                self.line.push(byte);
            }
        }
        Ok(())
    }

    fn finish(&mut self) -> ParseBatch {
        let mut deltas = Vec::new();
        let error = self.finish_inner(&mut deltas).err();
        ParseBatch { deltas, error }
    }

    fn finish_inner(&mut self, deltas: &mut Vec<String>) -> Result<(), String> {
        if !self.done && !self.line.is_empty() {
            let mut line = std::mem::take(&mut self.line);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = std::str::from_utf8(&line)
                .map_err(|_| "服务返回了无法识别的流式响应。".to_string())?;
            self.process_line(line, deltas)?;
        }
        if !self.done && !self.event_data.is_empty() {
            self.flush_event(deltas)?;
        }
        if !self.done {
            return Err("流式响应意外结束，请重试。".to_string());
        }
        if !self.has_text {
            return Err("模型没有返回文本内容。".to_string());
        }
        Ok(())
    }

    fn process_line(&mut self, line: &str, deltas: &mut Vec<String>) -> Result<(), String> {
        if matches!(self.provider, Provider::Ollama) {
            if line.is_empty() {
                return Ok(());
            }
            let payload: Value = serde_json::from_str(line)
                .map_err(|_| "服务返回了无法识别的流式响应。".to_string())?;
            if payload.get("error").is_some_and(|error| !error.is_null()) {
                return Err("模型服务在生成过程中返回错误。".to_string());
            }
            if let Some(content) = payload.pointer("/message/content") {
                match content {
                    Value::String(content) => self.record_delta(content, deltas)?,
                    Value::Null => {}
                    _ => return Err("服务返回了无法识别的流式响应。".to_string()),
                }
            }
            if payload.get("done").and_then(Value::as_bool) == Some(true) {
                self.done = true;
            }
            return Ok(());
        }

        if line.is_empty() {
            self.flush_event(deltas)?;
        } else if let Some(data) = line.strip_prefix("data:") {
            let data = data.strip_prefix(' ').unwrap_or(data);
            if self.event_data.len() + data.len() + 1 > MAX_STREAM_LINE_BYTES {
                return Err("模型响应过长，已停止接收。".to_string());
            }
            self.event_data.push_str(data);
            self.event_data.push('\n');
        } else if let Some(event) = line.strip_prefix("event:") {
            self.error_event = event.trim() == "error";
        }
        Ok(())
    }

    fn flush_event(&mut self, deltas: &mut Vec<String>) -> Result<(), String> {
        let data = std::mem::take(&mut self.event_data);
        let error_event = std::mem::take(&mut self.error_event);
        if error_event {
            return Err("模型服务在生成过程中返回错误。".to_string());
        }
        let data = data.trim_end_matches('\n');
        if data.is_empty() {
            return Ok(());
        }
        if data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let payload: Value =
            serde_json::from_str(data).map_err(|_| "服务返回了无法识别的流式响应。".to_string())?;
        if payload.get("error").is_some_and(|error| !error.is_null()) {
            return Err("模型服务在生成过程中返回错误。".to_string());
        }
        if let Some(content) = payload.pointer("/choices/0/delta/content") {
            match content {
                Value::String(content) => self.record_delta(content, deltas)?,
                Value::Null => {}
                _ => return Err("服务返回了无法识别的流式响应。".to_string()),
            }
        }
        Ok(())
    }

    fn record_delta(&mut self, content: &str, deltas: &mut Vec<String>) -> Result<(), String> {
        if content.is_empty() {
            return Ok(());
        }
        self.emitted_bytes = self
            .emitted_bytes
            .checked_add(content.len())
            .filter(|bytes| *bytes <= MAX_STREAM_TEXT_BYTES)
            .ok_or_else(|| "模型响应过长，已停止接收。".to_string())?;
        self.has_text |= content.chars().any(|character| !character.is_whitespace());
        deltas.push(content.to_string());
        Ok(())
    }
}

#[tauri::command]
pub fn cancel_chat(
    request_id: String,
    registry: State<'_, CancellationRegistry>,
) -> Result<(), String> {
    registry.cancel(&request_id)
}

#[derive(Serialize)]
pub struct StreamResult {
    status: &'static str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl StreamResult {
    fn completed(content: String) -> Self {
        Self {
            status: "completed",
            content,
            error: None,
        }
    }

    fn cancelled(content: String) -> Self {
        Self {
            status: "cancelled",
            content,
            error: None,
        }
    }

    fn failed(content: String, error: String) -> Self {
        Self {
            status: "failed",
            content,
            error: Some(error),
        }
    }
}

#[tauri::command]
pub async fn stream_chat(
    provider: Provider,
    model: String,
    messages: Vec<ChatMessage>,
    request_id: String,
    on_event: Channel<String>,
    registry: State<'_, CancellationRegistry>,
) -> Result<StreamResult, String> {
    validate_model(&model)?;
    validate_messages(&messages)?;
    let (_active_request, mut cancellation) = registry.register(request_id)?;
    if *cancellation.borrow() {
        return Ok(StreamResult::cancelled(String::new()));
    }

    let client = stream_http_client()?;
    let mut request = client.post(provider.chat_url());
    if !matches!(provider, Provider::Ollama) {
        request = request.bearer_auth(api_key(provider)?);
    }
    let body = json!({ "model": model, "messages": messages, "stream": true });
    let mut response = {
        let send_future = tokio::time::timeout(STREAM_IDLE_TIMEOUT, request.json(&body).send());
        let cancel_future = wait_for_cancel(&mut cancellation);
        pin_mut!(send_future, cancel_future);
        match select(cancel_future, send_future).await {
            Either::Left(_) => return Ok(StreamResult::cancelled(String::new())),
            Either::Right((Ok(Ok(response)), _)) => response,
            Either::Right((Ok(Err(_)), _)) => {
                return Ok(StreamResult::failed(
                    String::new(),
                    "发送失败，请检查连接与网络。".to_string(),
                ));
            }
            Either::Right((Err(_), _)) => {
                return Ok(StreamResult::failed(
                    String::new(),
                    "等待模型服务超时，请稍后重试。".to_string(),
                ));
            }
        }
    };
    if *cancellation.borrow() {
        return Ok(StreamResult::cancelled(String::new()));
    }
    if !response.status().is_success() {
        return Ok(StreamResult::failed(
            String::new(),
            format!("模型请求失败，服务返回 HTTP {}。", response.status()),
        ));
    }

    let mut parser = StreamParser::new(provider);
    let mut content = String::new();
    loop {
        let chunk = {
            let receive_future = tokio::time::timeout(STREAM_IDLE_TIMEOUT, response.chunk());
            let cancel_future = wait_for_cancel(&mut cancellation);
            pin_mut!(receive_future, cancel_future);
            match select(cancel_future, receive_future).await {
                Either::Left(_) => return Ok(StreamResult::cancelled(content)),
                Either::Right((Ok(Ok(chunk)), _)) => chunk,
                Either::Right((Ok(Err(_)), _)) => {
                    return Ok(StreamResult::failed(
                        content,
                        "接收模型回复失败，请检查网络。".to_string(),
                    ));
                }
                Either::Right((Err(_), _)) => {
                    return Ok(StreamResult::failed(
                        content,
                        "模型服务长时间无响应，已停止等待。".to_string(),
                    ));
                }
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        let ParseBatch { deltas, error } = parser.push_bytes(&chunk);
        for delta in deltas {
            if error.is_none() && *cancellation.borrow() {
                return Ok(StreamResult::cancelled(content));
            }
            content.push_str(&delta);
            if on_event.send(delta).is_err() {
                return Ok(StreamResult::failed(
                    content,
                    "无法向界面发送模型回复。".to_string(),
                ));
            }
        }
        if let Some(error) = error {
            return Ok(StreamResult::failed(content, error));
        }
        if parser.done {
            break;
        }
    }
    let ParseBatch { deltas, error } = parser.finish();
    for delta in deltas {
        if error.is_none() && *cancellation.borrow() {
            return Ok(StreamResult::cancelled(content));
        }
        content.push_str(&delta);
        if on_event.send(delta).is_err() {
            return Ok(StreamResult::failed(
                content,
                "无法向界面发送模型回复。".to_string(),
            ));
        }
    }
    if let Some(error) = error {
        return Ok(StreamResult::failed(content, error));
    }
    if *cancellation.borrow() {
        return Ok(StreamResult::cancelled(content));
    }
    Ok(StreamResult::completed(content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_use_fixed_endpoints() {
        assert_eq!(
            Provider::Ollama.chat_url(),
            "http://127.0.0.1:11434/api/chat"
        );
        assert_eq!(
            Provider::Deepseek.models_url(),
            "https://api.deepseek.com/models"
        );
    }

    #[test]
    fn rejects_empty_and_invalid_messages() {
        assert!(validate_messages(&[]).is_err());
        assert!(
            validate_messages(&[ChatMessage {
                role: "system".to_string(),
                content: "hello".to_string(),
            }])
            .is_err()
        );
        assert!(validate_model("bad\nmodel").is_err());
    }

    #[test]
    fn sse_handles_split_utf8_crlf_and_done() {
        let mut parser = StreamParser::new(Provider::Deepseek);
        let event = format!(
            "data: {}\r\n\r\n",
            json!({ "choices": [{ "delta": { "content": "你好" } }] })
        );
        let split = event.find('你').unwrap() + 1;
        assert!(
            parser
                .push_bytes(&event.as_bytes()[..split])
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            parser.push_bytes(&event.as_bytes()[split..]).unwrap(),
            vec!["你好"]
        );
        assert!(parser.push_bytes(b"data: [DO").unwrap().is_empty());
        assert!(parser.push_bytes(b"NE]\r\n\r\n").unwrap().is_empty());
        assert!(parser.finish().unwrap().is_empty());
    }

    #[test]
    fn sse_reports_midstream_errors_and_empty_replies() {
        let mut parser = StreamParser::new(Provider::Openai);
        assert!(
            parser
                .push_bytes(b"data: {\"error\":{\"message\":\"secret\"}}\n\n")
                .is_err()
        );

        let mut parser = StreamParser::new(Provider::Deepseek);
        parser.push_bytes(b"data: [DONE]\n\n").unwrap();
        assert!(parser.finish().is_err());

        let mut parser = StreamParser::new(Provider::Openai);
        assert!(parser.push_bytes(b"event: error\ndata: {}\n\n").is_err());
    }

    #[test]
    fn ollama_handles_split_utf8_and_done() {
        let mut parser = StreamParser::new(Provider::Ollama);
        let event = format!(
            "{}\n",
            json!({ "message": { "content": "世界" }, "done": false })
        );
        let split = event.find('世').unwrap() + 2;
        assert!(
            parser
                .push_bytes(&event.as_bytes()[..split])
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            parser.push_bytes(&event.as_bytes()[split..]).unwrap(),
            vec!["世界"]
        );
        parser.push_bytes(b"{\"done\":true}\n").unwrap();
        assert!(parser.finish().unwrap().is_empty());
    }

    #[test]
    fn ollama_reports_midstream_errors_and_truncation() {
        let mut parser = StreamParser::new(Provider::Ollama);
        parser
            .push_bytes(b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n")
            .unwrap();
        assert!(parser.push_bytes(b"{\"error\":\"secret\"}\n").is_err());

        let mut parser = StreamParser::new(Provider::Ollama);
        parser
            .push_bytes(b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n")
            .unwrap();
        assert!(parser.finish().is_err());
    }

    #[test]
    fn same_chunk_error_preserves_prior_sse_and_ollama_deltas() {
        let mut sse = StreamParser::new(Provider::Openai);
        let stream = format!(
            "data: {}\n\ndata: {{\"error\":\"secret\"}}\n\n",
            json!({ "choices": [{ "delta": { "content": "已生成" } }] })
        );
        let batch = sse.push_bytes(stream.as_bytes());
        assert_eq!(batch.deltas, vec!["已生成"]);
        assert_eq!(
            batch.error.as_deref(),
            Some("模型服务在生成过程中返回错误。")
        );

        let mut ollama = StreamParser::new(Provider::Ollama);
        let batch = ollama.push_bytes(
            b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n{\"error\":\"secret\"}\n",
        );
        assert_eq!(batch.deltas, vec!["partial"]);
        assert_eq!(
            batch.error.as_deref(),
            Some("模型服务在生成过程中返回错误。")
        );
    }

    #[test]
    fn truncated_eof_preserves_last_unterminated_delta() {
        let mut ollama = StreamParser::new(Provider::Ollama);
        assert!(
            ollama
                .push_bytes(b"{\"message\":{\"content\":\"tail\"},\"done\":false}")
                .unwrap()
                .is_empty()
        );
        let batch = ollama.finish();
        assert_eq!(batch.deltas, vec!["tail"]);
        assert_eq!(batch.error.as_deref(), Some("流式响应意外结束，请重试。"));

        let mut sse = StreamParser::new(Provider::Deepseek);
        let event = format!(
            "data: {}",
            json!({ "choices": [{ "delta": { "content": "尾段" } }] })
        );
        assert!(sse.push_bytes(event.as_bytes()).unwrap().is_empty());
        let batch = sse.finish();
        assert_eq!(batch.deltas, vec!["尾段"]);
        assert_eq!(batch.error.as_deref(), Some("流式响应意外结束，请重试。"));
    }

    #[test]
    fn streaming_lines_and_text_are_bounded() {
        let mut parser = StreamParser::new(Provider::Ollama);
        assert!(
            parser
                .push_bytes(&vec![b'a'; MAX_STREAM_LINE_BYTES + 1])
                .is_err()
        );
        let mut parser = StreamParser::new(Provider::Deepseek);
        assert!(
            parser
                .record_delta(&"a".repeat(MAX_STREAM_TEXT_BYTES + 1), &mut Vec::new())
                .is_err()
        );
    }

    #[test]
    fn cancellation_works_before_and_during_registration() {
        let registry = CancellationRegistry::default();
        registry.cancel("early").unwrap();
        let (early_guard, early_receiver) = registry.register("early".to_string()).unwrap();
        assert!(*early_receiver.borrow());
        drop(early_guard);

        let (active_guard, active_receiver) = registry.register("active".to_string()).unwrap();
        assert!(registry.register("active".to_string()).is_err());
        registry.cancel("active").unwrap();
        assert!(*active_receiver.borrow());
        drop(active_guard);
        assert!(registry.register("active".to_string()).is_ok());
        assert!(registry.cancel("").is_err());
    }

    #[test]
    fn final_result_serializes_status_and_authoritative_content() {
        assert_eq!(
            serde_json::to_value(StreamResult::completed("你好".to_string())).unwrap(),
            json!({ "status": "completed", "content": "你好" })
        );
        assert_eq!(
            serde_json::to_value(StreamResult::cancelled("部分".to_string())).unwrap(),
            json!({ "status": "cancelled", "content": "部分" })
        );
        assert_eq!(
            serde_json::to_value(StreamResult::failed(
                "已生成".to_string(),
                "连接中断。".to_string()
            ))
            .unwrap(),
            json!({ "status": "failed", "content": "已生成", "error": "连接中断。" })
        );
    }

    #[test]
    fn streaming_uses_a_per_operation_idle_timeout() {
        assert_eq!(STREAM_IDLE_TIMEOUT, Duration::from_secs(180));
        assert!(stream_http_client().is_ok());
        tauri::async_runtime::block_on(async {
            let timeout = tokio::time::timeout(Duration::ZERO, std::future::pending::<()>()).await;
            assert!(timeout.is_err());
        });
    }
}
