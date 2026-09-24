use std::time::Duration;

use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const CREDENTIAL_SERVICE: &str = "com.modelport.desktop";

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
}
