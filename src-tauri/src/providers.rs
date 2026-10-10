use crate::local_data;
use serde::{Deserialize, Deserializer, Serialize, de::Error};
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Openai,
    Deepseek,
    Ollama,
    Gemini,
    Anthropic,
    Qwen,
    Moonshot,
    Custom(Uuid),
}

impl Provider {
    pub fn parse(id: &str) -> Result<Self, String> {
        Ok(match id {
            "openai" => Self::Openai,
            "deepseek" => Self::Deepseek,
            "ollama" => Self::Ollama,
            "gemini" => Self::Gemini,
            "anthropic" => Self::Anthropic,
            "qwen" => Self::Qwen,
            "moonshot" => Self::Moonshot,
            _ => {
                let uuid = id
                    .strip_prefix("custom-")
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or("模型提供商标识无效。")?;
                if id != format!("custom-{uuid}") {
                    return Err("模型提供商标识无效。".into());
                }
                Self::Custom(uuid)
            }
        })
    }
    pub fn credential_name(self) -> String {
        match self {
            Self::Openai => "openai".into(),
            Self::Deepseek => "deepseek".into(),
            Self::Ollama => "ollama".into(),
            Self::Gemini => "gemini".into(),
            Self::Anthropic => "anthropic".into(),
            Self::Qwen => "qwen".into(),
            Self::Moonshot => "moonshot".into(),
            Self::Custom(id) => format!("custom-{id}"),
        }
    }
}
impl<'de> Deserialize<'de> for Provider {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub chat_path: String,
    pub models: Vec<String>,
    #[serde(default)]
    pub network_compatibility: bool,
}

pub fn defaults() -> Vec<ProviderConfig> {
    [
        (
            "ollama",
            "Ollama",
            "http://127.0.0.1:11434",
            "/api/chat",
            vec![],
        ),
        (
            "openai",
            "OpenAI",
            "https://api.openai.com/v1",
            "/chat/completions",
            vec!["gpt-4.1"],
        ),
        (
            "deepseek",
            "DeepSeek",
            "https://api.deepseek.com",
            "/chat/completions",
            vec!["deepseek-flash", "deepseek-v4-pro"],
        ),
        (
            "gemini",
            "Google Gemini",
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "/chat/completions",
            vec![],
        ),
        (
            "anthropic",
            "Anthropic Claude",
            "https://api.anthropic.com/v1",
            "/messages",
            vec![],
        ),
        (
            "qwen",
            "通义千问 · 阿里云百炼",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "/chat/completions",
            vec![],
        ),
        (
            "moonshot",
            "Kimi · Moonshot",
            "https://api.moonshot.cn/v1",
            "/chat/completions",
            vec![],
        ),
    ]
    .into_iter()
    .map(|(id, name, base, path, models)| ProviderConfig {
        id: id.into(),
        name: name.into(),
        base_url: base.into(),
        chat_path: path.into(),
        models: models.into_iter().map(str::to_owned).collect(),
        network_compatibility: false,
    })
    .collect()
}

impl ProviderConfig {
    fn validate(&self) -> Result<(), String> {
        let provider = Provider::parse(&self.id)?;
        if self.name.trim().is_empty()
            || self.name.chars().count() > 60
            || self.name.chars().any(char::is_control)
        {
            return Err("提供商名称须为 1–60 个字符，不能包含控制字符。".into());
        }
        validate_base_url(&self.base_url)?;
        if self.chat_path.len() > 200
            || !self.chat_path.starts_with('/')
            || self.chat_path.starts_with("//")
            || self
                .chat_path
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || self.chat_path.contains(['?', '#', '\\'])
        {
            return Err("API 路径须以 / 开头，不能包含查询参数、空格或完整网址。".into());
        }
        if self.models.len() > 100
            || self.models.iter().any(|id| {
                id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control)
            })
        {
            return Err("最多保存 100 个模型；模型 ID 须为 1–128 字节，不能包含控制字符。".into());
        }
        let unique: std::collections::HashSet<_> = self.models.iter().collect();
        if unique.len() != self.models.len() {
            return Err("模型 ID 不能重复。".into());
        }
        if !matches!(provider, Provider::Custom(_)) {
            let default = defaults()
                .into_iter()
                .find(|item| item.id == self.id)
                .unwrap();
            if self.name != default.name
                || self.base_url != default.base_url
                || self.chat_path != default.chat_path
                || self.network_compatibility
            {
                return Err("内置提供商使用官方地址；其他地址请添加自定义提供商。".into());
            }
        }
        Ok(())
    }
    pub fn chat_url(&self) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), self.chat_path)
    }
    pub fn models_url(&self) -> String {
        format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            if self.id == "ollama" {
                "/api/tags"
            } else {
                "/models"
            }
        )
    }
}

fn validate_base_url(base: &str) -> Result<(), String> {
    if base.len() > 1000
        || base.chars().any(|c| c.is_control() || c.is_whitespace())
        || base.contains('\\')
    {
        return Err("API 主机格式无效。".into());
    }
    let url = reqwest::Url::parse(base)
        .map_err(|_| "请输入完整 API 主机，例如 https://api.example.com/v1。")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err("API 主机不能包含用户名、密钥、查询参数或 # 片段。".into());
    }
    let host = url.host_str().unwrap_or_default();
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("远程 API 必须使用 HTTPS；HTTP 仅允许本机 localhost / 回环地址。".into());
    }
    Ok(())
}

pub struct ProviderStore {
    root: PathBuf,
}
impl ProviderStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn read(&self) -> Result<Vec<ProviderConfig>, String> {
        local_data::check_path(&self.root)?;
        let configs: Vec<ProviderConfig> =
            local_data::read_json(&self.root.join("providers.json"), 256 * 1024)?
                .unwrap_or_default();
        if configs.len() > 39 {
            return Err("提供商配置过多，原数据未更改。".into());
        }
        let mut ids = std::collections::HashSet::new();
        for config in &configs {
            config.validate()?;
            if !ids.insert(&config.id) {
                return Err("提供商配置重复，原数据未更改。".into());
            }
        }
        Ok(configs)
    }
    pub fn list(&self) -> Result<Vec<ProviderConfig>, String> {
        let mut result = defaults();
        for config in self.read()? {
            if let Some(item) = result.iter_mut().find(|item| item.id == config.id) {
                *item = config;
            } else {
                result.push(config);
            }
        }
        Ok(result)
    }
    pub fn get(&self, provider: Provider) -> Result<ProviderConfig, String> {
        self.list()?
            .into_iter()
            .find(|item| item.id == provider.credential_name())
            .ok_or_else(|| "该自定义提供商已删除或不存在，请重新配置；不会切换到其他服务。".into())
    }
    fn save(&self, config: ProviderConfig, creating: bool) -> Result<ProviderConfig, String> {
        config.validate()?;
        let _lock = local_data::lock(&self.root)?;
        let mut items = self.read()?;
        if creating {
            if items
                .iter()
                .filter(|item| item.id.starts_with("custom-"))
                .count()
                >= 32
            {
                return Err("最多添加 32 个自定义提供商。".into());
            }
        } else {
            self.get(Provider::parse(&config.id)?)?;
        }
        if let Some(item) = items.iter_mut().find(|item| item.id == config.id) {
            *item = config.clone();
        } else {
            items.push(config.clone());
        }
        local_data::write_json(&self.root.join("providers.json"), &items, 256 * 1024)?;
        Ok(config)
    }
    fn remove(&self, provider: Provider) -> Result<(), String> {
        if !matches!(provider, Provider::Custom(_)) {
            return Err("不能删除内置提供商。".into());
        }
        let _lock = local_data::lock(&self.root)?;
        let mut items = self.read()?;
        items.retain(|item| item.id != provider.credential_name());
        local_data::write_json(&self.root.join("providers.json"), &items, 256 * 1024)
    }
}

#[tauri::command]
pub fn list_provider_configs(
    store: State<'_, ProviderStore>,
) -> Result<Vec<ProviderConfig>, String> {
    store.list()
}
#[tauri::command]
pub fn add_custom_provider(store: State<'_, ProviderStore>) -> Result<ProviderConfig, String> {
    store.save(
        ProviderConfig {
            id: format!("custom-{}", Uuid::new_v4()),
            name: "自定义提供商".into(),
            base_url: "http://127.0.0.1:1234/v1".into(),
            chat_path: "/chat/completions".into(),
            models: vec![],
            network_compatibility: false,
        },
        true,
    )
}
#[tauri::command]
pub fn save_provider_config(
    config: ProviderConfig,
    store: State<'_, ProviderStore>,
) -> Result<ProviderConfig, String> {
    let provider = Provider::parse(&config.id)?;
    let old = store.get(provider)?;
    if old.base_url != config.base_url && crate::connection::has_key(provider)? {
        return Err("更改 API 主机前，请先删除该提供商的旧密钥，保存新地址后再填写新密钥，避免将旧密钥发送到其他服务。".into());
    }
    store.save(config, false)
}
#[tauri::command]
pub fn remove_custom_provider(
    provider: Provider,
    store: State<'_, ProviderStore>,
) -> Result<(), String> {
    if !matches!(provider, Provider::Custom(_)) {
        return Err("不能删除内置提供商。".into());
    }
    store.get(provider)?;
    crate::connection::delete_key(provider)?;
    store.remove(provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ProviderConfig {
        ProviderConfig {
            id: format!("custom-{}", Uuid::new_v4()),
            name: "Local".into(),
            base_url: "http://127.0.0.1:1234/v1/".into(),
            chat_path: "/chat/completions".into(),
            models: vec!["test-model".into()],
            network_compatibility: false,
        }
    }
    #[test]
    fn endpoints_and_trust_boundaries() {
        let mut item = config();
        item.validate().unwrap();
        assert_eq!(item.chat_url(), "http://127.0.0.1:1234/v1/chat/completions");
        for base in [
            "http://remote.test/v1",
            "https://user:secret@remote.test/v1",
            "https://remote.test/v1?key=secret",
            "https://remote.test/#key",
            "file:///test",
            "https://remote.test\\evil",
            "https://remote.test/\n",
        ] {
            item.base_url = base.into();
            assert!(item.validate().is_err(), "{base}");
        }
        item.base_url = "https://remote.test/v1".into();
        item.validate().unwrap();
        for path in [
            "https://evil.test",
            "//evil.test",
            "/chat?key=secret",
            "/chat#x",
            "/bad\n",
        ] {
            item.chat_path = path.into();
            assert!(item.validate().is_err());
        }
        assert!(Provider::parse("custom-../../secret").is_err());
    }
    #[test]
    fn persistence_models_and_removed_provider_never_fall_back() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProviderStore::new(dir.path().join("providers"));
        assert_eq!(store.list().unwrap().len(), 7);
        let item = config();
        let provider = Provider::parse(&item.id).unwrap();
        store.save(item.clone(), true).unwrap();
        assert_eq!(store.get(provider).unwrap(), item);
        let mut builtin = defaults().remove(3);
        builtin.models = vec!["discovered".into()];
        store.save(builtin.clone(), false).unwrap();
        assert_eq!(store.get(Provider::Gemini).unwrap().models, builtin.models);
        builtin.base_url = "https://evil.test".into();
        assert!(store.save(builtin, false).is_err());
        let mut duplicate = item.clone();
        duplicate.models.push("test-model".into());
        assert!(store.save(duplicate, false).is_err());
        store.remove(provider).unwrap();
        assert!(store.get(provider).is_err());
        assert!(store.save(item, false).is_err());
        assert!(store.remove(Provider::Openai).is_err());
    }
    #[test]
    fn corrupted_config_is_never_overwritten_or_used_as_a_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProviderStore::new(dir.path().join("providers"));
        store.save(config(), true).unwrap();
        let path = store.root.join("providers.json");
        std::fs::write(&path, b"broken config").unwrap();
        assert!(store.list().is_err());
        assert!(store.save(config(), true).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken config");
    }
}
