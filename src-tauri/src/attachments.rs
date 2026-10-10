use crate::local_data;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Cursor, path::PathBuf};

pub const MAX_ATTACHMENTS: usize = 4;
pub const MAX_IMAGE: usize = 4 * 1024 * 1024;
pub const MAX_TEXT: usize = 128 * 1024;
const MAX_RECORD: usize = 6 * 1024 * 1024;
const MAX_STORE: u64 = 256 * 1024 * 1024;
const MAX_STORED_FILES: usize = 2000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub kind: String,
    pub bytes: usize,
}

#[derive(Deserialize, Serialize)]
pub struct AttachmentRecord {
    pub attachment: Attachment,
    pub data: String,
}

pub struct AttachmentStore {
    root: PathBuf,
}

fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.trim().is_empty()
        || filename.chars().count() > 240
        || filename.contains(['/', '\\'])
        || filename.chars().any(char::is_control)
    {
        return Err("附件文件名无效。".into());
    }
    Ok(())
}

fn validate_data(kind: &str, data: &str) -> Result<usize, String> {
    match kind {
        "text" => {
            if data.is_empty()
                || data.len() > MAX_TEXT
                || data.trim().is_empty()
                || data
                    .chars()
                    .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            {
                return Err(
                    "文本附件为空、含二进制字符或超过 128 KiB；请选择 UTF-8 TXT / Markdown。"
                        .into(),
                );
            }
            Ok(data.len())
        }
        "image" => {
            if data.len() > (MAX_IMAGE + 2) / 3 * 4 {
                return Err("处理后的图片不能超过 4 MiB。".into());
            }
            let bytes = STANDARD.decode(data).map_err(|_| "图片编码无效。")?;
            if bytes.is_empty() || bytes.len() > MAX_IMAGE {
                return Err("图片为空或超过 4 MiB。".into());
            }
            let mut decoder = png::Decoder::new(Cursor::new(&bytes));
            decoder.set_limits(png::Limits {
                bytes: 32 * 1024 * 1024,
            });
            let mut reader = decoder.read_info().map_err(|_| "图片不是有效的 PNG。")?;
            let info = reader.info();
            if info.width == 0 || info.height == 0 || info.width > 2048 || info.height > 2048 {
                return Err("图片尺寸超出 2048 × 2048 的处理上限。".into());
            }
            if info.animation_control.is_some() {
                return Err("暂不支持动态图，请选择静态图片。".into());
            }
            let mut decoded = vec![0; reader.output_buffer_size()];
            reader
                .next_frame(&mut decoded)
                .map_err(|_| "图片损坏，无法读取。")?;
            Ok(bytes.len())
        }
        "video" => Err("当前版本尚未接入视频识别，不会把视频当作图片发送。请改用截图。".into()),
        _ => Err("仅支持静态图片、TXT 和 Markdown 附件；PDF / Word / 视频暂不支持。".into()),
    }
}

impl AttachmentStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| "附件标识无效。")?;
        if parsed.to_string() != id {
            return Err("附件标识无效。".into());
        }
        local_data::check_path(&self.root)?;
        Ok(self.root.join(format!("{id}.json")))
    }

    pub fn save(&self, filename: String, kind: String, data: String) -> Result<Attachment, String> {
        validate_filename(&filename)?;
        let extension = filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if kind == "text" && !matches!(extension.as_str(), "txt" | "md" | "markdown") {
            return Err("文字附件只支持 TXT / Markdown。".into());
        }
        let bytes = validate_data(&kind, &data)?;
        let _lock = local_data::lock(&self.root)?;
        let mut total = 0u64;
        let mut count = 0usize;
        for entry in fs::read_dir(&self.root).map_err(|_| "无法检查附件空间。")? {
            let entry = entry.map_err(|_| "无法检查附件空间。")?;
            if entry.path().extension().is_some_and(|ext| ext == "json") {
                count += 1;
                local_data::check_path(&entry.path())?;
                total =
                    total.saturating_add(entry.metadata().map_err(|_| "无法检查附件空间。")?.len());
            }
        }
        let attachment = Attachment {
            id: uuid::Uuid::new_v4().to_string(),
            filename,
            kind,
            bytes,
        };
        let record = AttachmentRecord {
            attachment: attachment.clone(),
            data,
        };
        let encoded = serde_json::to_vec_pretty(&record).map_err(|_| "无法保存附件。")?;
        if count >= MAX_STORED_FILES {
            return Err("本地附件达到 2000 个上限，请在常规设置中清理闲置附件。".into());
        }
        if total.saturating_add(encoded.len() as u64) > MAX_STORE {
            return Err("本地附件已达到 256 MiB 上限，请在常规设置中清理闲置附件。".into());
        }
        local_data::write_json(&self.path(&attachment.id)?, &record, MAX_RECORD)?;
        Ok(attachment)
    }

    pub fn get(&self, id: &str) -> Result<AttachmentRecord, String> {
        let record: AttachmentRecord = local_data::read_json(&self.path(id)?, MAX_RECORD)?
            .ok_or("附件副本缺失，无法发送。聊天 JSON 备份不包含附件原件，请重新添加文件。")?;
        validate_filename(&record.attachment.filename)?;
        let bytes = validate_data(&record.attachment.kind, &record.data)?;
        if record.attachment.id != id || record.attachment.bytes != bytes {
            return Err("附件数据损坏，请重新添加。".into());
        }
        Ok(record)
    }

    pub fn resolve(&self, reference: &Attachment) -> Result<AttachmentRecord, String> {
        let record = self.get(&reference.id)?;
        if record.attachment != *reference {
            return Err("附件信息不匹配，请重新添加。".into());
        }
        Ok(record)
    }

    pub fn remove(&self, ids: &[String]) -> Result<(), String> {
        if ids.len() > 20000 {
            return Err("附件清理数量超出范围。".into());
        }
        let paths = ids
            .iter()
            .map(|id| self.path(id))
            .collect::<Result<Vec<_>, _>>()?;
        let _lock = local_data::lock(&self.root)?;
        for path in paths {
            local_data::check_path(&path)?;
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err("部分附件未能删除，请稍后重试。".into()),
            }
        }
        Ok(())
    }

    pub fn clean_unused(&self, keep: &[String]) -> Result<usize, String> {
        // Explicit user action only; never collect references from another WebView automatically.
        if keep.len() > 20000 {
            return Err("附件引用数量超出范围。".into());
        }
        for id in keep {
            self.path(id)?;
        }
        let keep: HashSet<&str> = keep.iter().map(String::as_str).collect();
        let _lock = local_data::lock(&self.root)?;
        let mut removed = 0;
        for entry in fs::read_dir(&self.root).map_err(|_| "无法读取附件目录。")? {
            let path = entry.map_err(|_| "无法读取附件目录。")?.path();
            let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if path.extension().is_none_or(|ext| ext != "json")
                || uuid::Uuid::parse_str(id).is_err()
                || keep.contains(id)
            {
                continue;
            }
            local_data::check_path(&path)?;
            fs::remove_file(&path).map_err(|_| "部分闲置附件未能清理。")?;
            removed += 1;
        }
        Ok(removed)
    }
}

#[tauri::command]
pub fn save_chat_attachment(
    filename: String,
    kind: String,
    data: String,
    store: tauri::State<'_, AttachmentStore>,
) -> Result<Attachment, String> {
    store.save(filename, kind, data)
}

#[tauri::command]
pub fn get_chat_attachment(
    id: String,
    store: tauri::State<'_, AttachmentStore>,
) -> Result<AttachmentRecord, String> {
    store.get(&id)
}

#[tauri::command]
pub fn remove_chat_attachments(
    ids: Vec<String>,
    store: tauri::State<'_, AttachmentStore>,
) -> Result<(), String> {
    store.remove(&ids)
}

#[tauri::command]
pub fn clean_unused_attachments(
    keep: Vec<String>,
    store: tauri::State<'_, AttachmentStore>,
) -> Result<usize, String> {
    store.clean_unused(&keep)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub fn png_data() -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[255, 0, 0]).unwrap();
        }
        STANDARD.encode(bytes)
    }
    #[test]
    fn files_are_bounded_validated_and_persisted_outside_chat_storage() {
        let dir = tempfile::tempdir().unwrap();
        let store = AttachmentStore::new(dir.path().into());
        let text = store
            .save("中文.md".into(), "text".into(), "hello 中文".into())
            .unwrap();
        assert_eq!(store.resolve(&text).unwrap().data, "hello 中文");
        let image = store
            .save("red.png".into(), "image".into(), png_data())
            .unwrap();
        assert_eq!(store.get(&image.id).unwrap().attachment, image);
        let mut altered = text.clone();
        altered.filename = "other.md".into();
        assert!(store.resolve(&altered).is_err());
        for (name, kind, data) in [
            ("../../bad.txt", "text", "hi"),
            ("a.pdf", "text", "hi"),
            ("a.txt", "text", "bad\0"),
            ("a.png", "image", "garbage"),
            ("a.mp4", "video", "video"),
        ] {
            assert!(store.save(name.into(), kind.into(), data.into()).is_err());
        }
        assert!(
            store
                .save("big.txt".into(), "text".into(), "x".repeat(MAX_TEXT + 1))
                .is_err()
        );
        assert!(store.get("../../secret").is_err());
        assert!(store.remove(&["../../secret".into()]).is_err());
        assert_eq!(store.clean_unused(&[text.id.clone()]).unwrap(), 1);
        assert!(store.get(&image.id).is_err());
        assert!(store.get(&text.id).is_ok());
        store.remove(&[text.id.clone()]).unwrap();
        assert!(store.get(&text.id).is_err());
    }
}
