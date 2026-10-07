use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::State;

const MAX_DOCUMENT: usize = 128 * 1024;
const MAX_BODY: usize = 64 * 1024;
const MAX_LIBRARY: usize = 8 * 1024 * 1024;
const MAX_SKILLS: usize = 200;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReference {
    pub id: String,
    pub revision: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub revision: String,
    pub enabled: bool,
    pub source: String,
    pub compatibility: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub summary: SkillSummary,
    pub document: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSkill {
    id: String,
    document: String,
    display_name: String,
    enabled: bool,
    source: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Library {
    version: u32,
    skills: Vec<StoredSkill>,
}

#[derive(Deserialize)]
struct Frontmatter {
    name: String,
    description: String,
    compatibility: Option<String>,
    #[serde(flatten)]
    _extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
pub struct SkillPreview {
    name: String,
    description: String,
    compatibility: Option<String>,
    body: String,
}

pub struct SkillStore {
    root: PathBuf,
}

fn parse_document(document: &str) -> Result<SkillPreview, String> {
    if document.len() > MAX_DOCUMENT {
        return Err("技能文件不能超过 128 KiB。".into());
    }
    if document.contains('\0') {
        return Err("技能文件含有无效字符，请使用 UTF-8 文本。".into());
    }
    let normalized = document
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    let content = normalized
        .strip_prefix("---\n")
        .ok_or("文件应以 YAML 元数据头（---）开始。")?;
    let (yaml, body) = content
        .split_once("\n---\n")
        .ok_or("缺少 YAML 元数据头的结束标记（---）。")?;
    let options = serde_saphyr::options! {
        reject_unsupported_tags: true,
        with_snippet: false,
        merge_keys: serde_saphyr::MergeKeyPolicy::Error,
        budget: serde_saphyr::budget! {
            max_depth: 16, max_nodes: 2048, max_events: 8192,
            max_aliases: 0, max_anchors: 0, max_documents: 1,
            max_total_scalar_bytes: MAX_DOCUMENT,
        },
    };
    let metadata: Frontmatter =
        serde_saphyr::from_str_with_options(yaml, options).map_err(|error| {
            format!(
                "YAML 元数据无效：{}",
                error.to_string().chars().take(300).collect::<String>()
            )
        })?;
    let name = metadata.name;
    if name.is_empty()
        || name.len() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("name 应为 1–64 个小写英文字母、数字或短横线；不能以短横线开头/结尾，也不能连续使用短横线。".into());
    }
    let description = metadata.description.trim().to_string();
    if description.is_empty() || description.chars().count() > 1024 {
        return Err("description 必须填写，且不能超过 1024 个字符。".into());
    }
    if metadata
        .compatibility
        .as_ref()
        .is_some_and(|value| value.chars().count() > 500)
    {
        return Err("compatibility 不能超过 500 个字符。".into());
    }
    let body = body.trim().to_string();
    if body.is_empty() || body.len() > MAX_BODY {
        return Err("指令正文不能为空，且不能超过 64 KiB。".into());
    }
    Ok(SkillPreview {
        name,
        description,
        compatibility: metadata.compatibility,
        body,
    })
}

fn validate_label(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control)
    {
        return Err("显示名称/来源不能为空，不能超过 120 个字符或含控制字符。".into());
    }
    Ok(())
}

impl StoredSkill {
    fn summary(&self) -> Result<SkillSummary, String> {
        uuid::Uuid::parse_str(&self.id).map_err(|_| "技能库标识损坏，原始数据不会被覆盖。")?;
        validate_label(&self.display_name)?;
        validate_label(&self.source)?;
        let parsed = parse_document(&self.document)?;
        let mut hash = Sha256::new();
        hash.update(self.display_name.as_bytes());
        hash.update([0]);
        hash.update(self.document.as_bytes());
        Ok(SkillSummary {
            id: self.id.clone(),
            name: parsed.name,
            display_name: self.display_name.clone(),
            description: parsed.description,
            revision: format!("{:x}", hash.finalize()),
            enabled: self.enabled,
            source: self.source.clone(),
            compatibility: parsed.compatibility,
        })
    }
    fn record(&self) -> Result<SkillRecord, String> {
        Ok(SkillRecord {
            summary: self.summary()?,
            document: self.document.clone(),
        })
    }
}

// Imported text never supplies a path. Only the application's own library file is accessed.
fn check_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err("技能存储位置不能是符号链接或目录联接。".into());
                }
            }
            if metadata.file_type().is_symlink() {
                return Err("技能存储位置不能是符号链接。".into());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法检查技能存储位置。".into()),
    }
}

impl SkillStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self) -> PathBuf {
        self.root.join("skills-state.v1.json")
    }
    fn lock(&self) -> Result<File, String> {
        check_path(&self.root)?;
        fs::create_dir_all(&self.root).map_err(|_| "无法创建本地技能目录。")?;
        let path = self.root.join("library.lock");
        check_path(&path)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|_| "无法访问技能库锁。")?;
        file.try_lock()
            .map_err(|_| "技能库正被另一个操作占用，请稍后重试。")?;
        Ok(file) // Dropping the file releases the cross-process lock.
    }
    fn read(&self) -> Result<Library, String> {
        let path = self.path();
        check_path(&path)?;
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Library {
                    version: 1,
                    skills: vec![],
                });
            }
            Err(_) => return Err("无法读取本地技能库；原始数据未更改。".into()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_LIBRARY + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "读取技能库失败。")?;
        if bytes.len() > MAX_LIBRARY {
            return Err("技能库超过 8 MiB，原始数据未更改。".into());
        }
        let library: Library = serde_json::from_slice(&bytes)
            .map_err(|_| "技能库文件损坏；请保留原文件并恢复备份，原始数据不会被覆盖。")?;
        if library.version != 1 || library.skills.len() > MAX_SKILLS {
            return Err("技能库版本不支持或条目过多；原始数据未更改。".into());
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        // ponytail: validate the bounded library on access; cache only if measured load times require it.
        for skill in &library.skills {
            let summary = skill
                .summary()
                .map_err(|error| format!("技能库含无效条目，未更改原数据：{error}"))?;
            if !ids.insert(summary.id) || !names.insert(summary.name) {
                return Err("技能库有重复条目；原始数据不会被覆盖。".into());
            }
        }
        Ok(library)
    }
    fn write(&self, library: &Library) -> Result<(), String> {
        if library.skills.len() > MAX_SKILLS {
            return Err("技能数量最多为 200 个。".into());
        }
        let bytes = serde_json::to_vec_pretty(library).map_err(|_| "无法生成技能库数据。")?;
        if bytes.len() > MAX_LIBRARY {
            return Err("技能库总大小不能超过 8 MiB。".into());
        }
        check_path(&self.path())?;
        let mut temp =
            tempfile::NamedTempFile::new_in(&self.root).map_err(|_| "无法创建保存临时文件。")?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| "技能保存失败，原始数据未更改。")?;
        temp.persist(self.path())
            .map_err(|_| "无法替换技能库，原始数据未更改。")?;
        Ok(())
    }
    pub fn list(&self) -> Result<Vec<SkillSummary>, String> {
        let _lock = self.lock()?;
        self.read()?
            .skills
            .iter()
            .map(StoredSkill::summary)
            .collect()
    }
    fn get(&self, id: &str) -> Result<SkillRecord, String> {
        let _lock = self.lock()?;
        self.read()?
            .skills
            .iter()
            .find(|skill| skill.id == id)
            .ok_or("技能不存在或已删除。")?
            .record()
    }
    fn save(
        &self,
        id: Option<String>,
        expected_revision: Option<String>,
        document: String,
        display_name: String,
        imported: bool,
    ) -> Result<SkillRecord, String> {
        let parsed = parse_document(&document)?;
        validate_label(&display_name)?;
        let _lock = self.lock()?;
        let mut library = self.read()?;
        if library.skills.iter().any(|skill| {
            skill
                .summary()
                .is_ok_and(|s| s.name == parsed.name && Some(skill.id.as_str()) != id.as_deref())
        }) {
            return Err("已有同名技能。请选择已有项目并确认替换，或修改 name 后再保存。".into());
        }
        let record = if let Some(id) = id {
            let existing = library
                .skills
                .iter_mut()
                .find(|skill| skill.id == id)
                .ok_or("技能不存在或已删除。")?;
            if expected_revision.as_deref() != Some(existing.summary()?.revision.as_str()) {
                return Err("技能已被更新，请重新打开并检查内容后再保存。".into());
            }
            existing.document = document;
            existing.display_name = display_name.trim().into();
            if imported {
                existing.enabled = false;
                existing.source = "导入 SKILL.md".into();
            }
            existing.record()?
        } else {
            let skill = StoredSkill {
                id: uuid::Uuid::new_v4().to_string(),
                document,
                display_name: display_name.trim().into(),
                enabled: false,
                source: if imported {
                    "导入 SKILL.md"
                } else {
                    "本地创建"
                }
                .into(),
            };
            let record = skill.record()?;
            library.skills.push(skill);
            record
        };
        self.write(&library)?;
        Ok(record)
    }
    fn set_enabled(
        &self,
        reference: &SkillReference,
        enabled: bool,
    ) -> Result<SkillSummary, String> {
        let _lock = self.lock()?;
        let mut library = self.read()?;
        let skill = library
            .skills
            .iter_mut()
            .find(|skill| skill.id == reference.id)
            .ok_or("技能不存在或已删除。")?;
        if skill.summary()?.revision != reference.revision {
            return Err("技能已更新，请重新审阅后再更改启用状态。".into());
        }
        skill.enabled = enabled;
        let summary = skill.summary()?;
        self.write(&library)?;
        Ok(summary)
    }
    fn remove(&self, reference: &SkillReference) -> Result<(), String> {
        let _lock = self.lock()?;
        let mut library = self.read()?;
        let skill = library
            .skills
            .iter()
            .find(|skill| skill.id == reference.id)
            .ok_or("技能不存在或已删除。")?;
        if skill.summary()?.revision != reference.revision {
            return Err("技能已更新，请重新打开后再删除。".into());
        }
        library.skills.retain(|skill| skill.id != reference.id);
        self.write(&library)
    }
    pub fn resolve(&self, reference: &SkillReference) -> Result<String, String> {
        let record = self.get(&reference.id)?;
        if !record.summary.enabled {
            return Err("选中的技能已禁用，请清除选择或重新启用。".into());
        }
        if record.summary.revision != reference.revision {
            return Err("技能内容已更新，请重新选择并确认使用新版技能。".into());
        }
        Ok(parse_document(&record.document)?.body)
    }
}

#[tauri::command]
pub fn preview_skill(document: String) -> Result<SkillPreview, String> {
    parse_document(&document)
}
#[tauri::command]
pub fn list_skills(store: State<'_, SkillStore>) -> Result<Vec<SkillSummary>, String> {
    store.list()
}
#[tauri::command]
pub fn get_skill(id: String, store: State<'_, SkillStore>) -> Result<SkillRecord, String> {
    store.get(&id)
}
#[tauri::command]
pub fn save_skill(
    id: Option<String>,
    expected_revision: Option<String>,
    document: String,
    display_name: String,
    imported: bool,
    store: State<'_, SkillStore>,
) -> Result<SkillRecord, String> {
    store.save(id, expected_revision, document, display_name, imported)
}
#[tauri::command]
pub fn set_skill_enabled(
    skill: SkillReference,
    enabled: bool,
    store: State<'_, SkillStore>,
) -> Result<SkillSummary, String> {
    store.set_enabled(&skill, enabled)
}
#[tauri::command]
pub fn remove_skill(skill: SkillReference, store: State<'_, SkillStore>) -> Result<(), String> {
    store.remove(&skill)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn document(name: &str, body: &str) -> String {
        format!("---\nname: {name}\ndescription: 测试用途\n---\n{body}")
    }
    fn reference(record: &SkillRecord) -> SkillReference {
        SkillReference {
            id: record.summary.id.clone(),
            revision: record.summary.revision.clone(),
        }
    }
    #[test]
    fn parsing_handles_windows_and_rejects_unsafe_inputs() {
        let text = "\u{feff}---\r\nname: test-skill\r\ndescription: >\r\n  多行描述\r\n  保持合法\r\nmetadata:\r\n  author: test\r\nallowed-tools: Bash\r\n---\r\n只回答测试";
        assert!(
            parse_document(text)
                .unwrap()
                .description
                .contains("多行描述")
        );
        for bad in [
            "no yaml".into(),
            document("../outside", "text"),
            document("test", ""),
            "---\nname: !include /secret\ndescription: test\n---\nbody".into(),
            "---\nname: test\ndescription: &alias test\nmetadata: *alias\n---\nbody".into(),
            "---\nname: test\nname: second\ndescription: test\n---\nbody".into(),
            document("test", &"x".repeat(MAX_BODY + 1)),
        ] {
            assert!(parse_document(&bad).is_err(), "{bad:.80}");
        }
        assert!(parse_document(&"x".repeat(MAX_DOCUMENT + 1)).is_err());
    }
    #[test]
    fn library_crud_versions_and_disabled_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let store = SkillStore::new(dir.path().join("skills"));
        let first = store
            .save(
                None,
                None,
                document("test", "First"),
                "测试技能".into(),
                true,
            )
            .unwrap();
        let old = reference(&first);
        assert!(!first.summary.enabled);
        assert!(store.resolve(&old).is_err());
        store.set_enabled(&old, true).unwrap();
        assert_eq!(store.resolve(&old).unwrap(), "First");
        assert!(
            store
                .save(
                    None,
                    None,
                    document("test", "duplicate"),
                    "重复".into(),
                    false
                )
                .is_err()
        );
        let updated = store
            .save(
                Some(old.id.clone()),
                Some(old.revision.clone()),
                document("renamed", "Second"),
                "改名".into(),
                false,
            )
            .unwrap();
        assert_eq!(updated.summary.id, old.id);
        assert_ne!(updated.summary.revision, old.revision);
        assert!(store.resolve(&old).is_err());
        assert!(store.remove(&old).is_err());
        let new = reference(&updated);
        assert_eq!(store.resolve(&new).unwrap(), "Second");
        let reopened = SkillStore::new(dir.path().join("skills"));
        assert_eq!(reopened.list().unwrap().len(), 1);
        reopened.set_enabled(&new, false).unwrap();
        assert!(reopened.resolve(&new).is_err());
        reopened.remove(&new).unwrap();
        assert!(reopened.list().unwrap().is_empty());
    }
    #[test]
    fn corrupt_library_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let store = SkillStore::new(dir.path().into());
        fs::write(store.path(), b"{broken}").unwrap();
        assert!(store.list().is_err());
        assert!(
            store
                .save(None, None, document("test", "text"), "test".into(), false)
                .is_err()
        );
        assert_eq!(fs::read(store.path()).unwrap(), b"{broken}");
        assert!(
            store
                .resolve(&SkillReference {
                    id: "../../secret".into(),
                    revision: "x".into()
                })
                .is_err()
        );
    }
}
