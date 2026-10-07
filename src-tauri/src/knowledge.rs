use crate::local_data;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::PathBuf};
use tauri::State;

const MAX_DOCUMENT: usize = 512 * 1024;
const MAX_LIBRARY: usize = 16 * 1024 * 1024;
const MAX_BASES: usize = 20;
const MAX_DOCUMENTS: usize = 200;
const CHUNK_CHARS: usize = 1000;
const CHUNK_OVERLAP: usize = 100;
const MAX_SOURCES: usize = 4;
pub const NO_MATCH_REPLY: &str = "没有在当前知识库中检索到与问题匹配的资料，因此暂时无法依据资料回答。请尝试更具体的关键词、补充资料，或选择“无知识库”进行普通对话。";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeReference {
    pub id: String,
    pub revision: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSummary {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub enabled: bool,
    pub document_count: usize,
    pub chunk_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub filename: String,
    pub revision: String,
    pub bytes: usize,
    pub chunk_count: usize,
}
#[derive(Serialize)]
pub struct KnowledgeRecord {
    pub summary: KnowledgeSummary,
    pub documents: Vec<DocumentSummary>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentImport {
    pub filename: String,
    pub text: String,
}
#[derive(Serialize)]
pub struct DocumentRecord {
    pub summary: DocumentSummary,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSource {
    pub number: usize,
    pub document_id: String,
    pub document_revision: String,
    pub filename: String,
    pub chunk_index: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContext {
    pub base: KnowledgeSummary,
    pub sources: Vec<KnowledgeSource>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Document {
    id: String,
    filename: String,
    text: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Base {
    id: String,
    name: String,
    enabled: bool,
    documents: Vec<Document>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Library {
    version: u32,
    bases: Vec<Base>,
}
pub struct KnowledgeStore {
    root: PathBuf,
}
struct Chunk {
    text: String,
    index: usize,
    start_line: usize,
    end_line: usize,
}

fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("知识库名称不能为空，最多 120 个字符，不允许控制字符。".into());
    }
    Ok(())
}
fn validate_filename(filename: &str) -> Result<(), String> {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if filename.trim().is_empty()
        || filename.chars().count() > 240
        || filename.contains(['/', '\\'])
        || filename.chars().any(char::is_control)
        || !matches!(ext.as_str(), "txt" | "md" | "markdown")
    {
        return Err("只支持单个 TXT / Markdown 文件名，不支持目录、压缩包、PDF 或 Word。".into());
    }
    Ok(())
}
fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_DOCUMENT {
        return Err("单份资料不能超过 512 KiB。".into());
    }
    if text.trim().is_empty()
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("资料为空或含二进制控制字符，请选择 UTF-8 文本。".into());
    }
    Ok(())
}

fn chunks(text: &str) -> Vec<Chunk> {
    let chars: Vec<char> = text.chars().collect();
    let mut line = 1;
    let lines: Vec<usize> = chars
        .iter()
        .map(|c| {
            let current = line;
            if *c == '\n' {
                line += 1;
            }
            current
        })
        .collect();
    let mut result = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + CHUNK_CHARS).min(chars.len());
        if end < chars.len() {
            if let Some(position) = chars[start + CHUNK_CHARS / 2..end]
                .iter()
                .rposition(|c| *c == '\n')
            {
                end = start + CHUNK_CHARS / 2 + position + 1;
            }
        }
        let body: String = chars[start..end].iter().collect();
        if !body.trim().is_empty() {
            result.push(Chunk {
                text: body,
                index: result.len() + 1,
                start_line: lines[start],
                end_line: lines[end - 1],
            });
        }
        if end == chars.len() {
            break;
        }
        start = end - CHUNK_OVERLAP;
    }
    result
}

impl Document {
    fn summary(&self) -> DocumentSummary {
        DocumentSummary {
            id: self.id.clone(),
            filename: self.filename.clone(),
            revision: hash(&self.text),
            bytes: self.text.len(),
            chunk_count: chunks(&self.text).len(),
        }
    }
}
impl Base {
    fn summary(&self) -> KnowledgeSummary {
        let mut digest = Sha256::new();
        digest.update(self.name.as_bytes());
        digest.update([0]);
        for document in &self.documents {
            digest.update(document.id.as_bytes());
            digest.update([0]);
            digest.update(document.filename.as_bytes());
            digest.update([0]);
            digest.update(hash(&document.text));
        }
        KnowledgeSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            revision: format!("{:x}", digest.finalize()),
            enabled: self.enabled,
            document_count: self.documents.len(),
            chunk_count: self.documents.iter().map(|d| chunks(&d.text).len()).sum(),
        }
    }
    fn record(&self) -> KnowledgeRecord {
        KnowledgeRecord {
            summary: self.summary(),
            documents: self.documents.iter().map(Document::summary).collect(),
        }
    }
    fn check_revision(&self, reference: &KnowledgeReference) -> Result<(), String> {
        if self.summary().revision != reference.revision {
            return Err("知识库已更新，请重新打开或重新选择后重试。".into());
        }
        Ok(())
    }
}

impl KnowledgeStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self) -> PathBuf {
        self.root.join("knowledge-state.v1.json")
    }
    fn read(&self) -> Result<Library, String> {
        let library = local_data::read_json(&self.path(), MAX_LIBRARY)?.unwrap_or(Library {
            version: 1,
            bases: vec![],
        });
        if library.version != 1 || library.bases.len() > MAX_BASES {
            return Err("知识库版本不支持或数量超限，原始数据不会被覆盖。".into());
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for base in &library.bases {
            uuid::Uuid::parse_str(&base.id).map_err(|_| "知识库标识损坏，原始数据未更改。")?;
            validate_name(&base.name)?;
            if !ids.insert(base.id.clone())
                || !names.insert(base.name.to_lowercase())
                || base.documents.len() > MAX_DOCUMENTS
            {
                return Err("知识库有重复条目或资料数量超限，原数据未更改。".into());
            }
            let mut document_names = HashSet::new();
            for document in &base.documents {
                uuid::Uuid::parse_str(&document.id).map_err(|_| "资料标识损坏。")?;
                validate_filename(&document.filename)?;
                validate_text(&document.text)?;
                if !ids.insert(document.id.clone())
                    || !document_names.insert(document.filename.to_lowercase())
                {
                    return Err("资料有重复条目，原数据未更改。".into());
                }
            }
        }
        Ok(library)
    }
    fn write(&self, library: &Library) -> Result<(), String> {
        local_data::write_json(&self.path(), library, MAX_LIBRARY)
    }
    pub(crate) fn list(&self) -> Result<Vec<KnowledgeSummary>, String> {
        let _lock = local_data::lock(&self.root)?;
        Ok(self.read()?.bases.iter().map(Base::summary).collect())
    }
    fn get(&self, id: &str) -> Result<KnowledgeRecord, String> {
        let _lock = local_data::lock(&self.root)?;
        Ok(self
            .read()?
            .bases
            .iter()
            .find(|b| b.id == id)
            .ok_or("知识库不存在或已删除。")?
            .record())
    }
    fn save(
        &self,
        reference: Option<KnowledgeReference>,
        name: String,
    ) -> Result<KnowledgeRecord, String> {
        let name = name.trim().to_string();
        validate_name(&name)?;
        let _lock = local_data::lock(&self.root)?;
        let mut library = self.read()?;
        if library.bases.iter().any(|b| {
            b.name.to_lowercase() == name.to_lowercase()
                && Some(b.id.as_str()) != reference.as_ref().map(|r| r.id.as_str())
        }) {
            return Err("已有同名知识库，请使用其他名称。".into());
        }
        let record = if let Some(reference) = reference {
            let base = library
                .bases
                .iter_mut()
                .find(|b| b.id == reference.id)
                .ok_or("知识库不存在或已删除。")?;
            base.check_revision(&reference)?;
            base.name = name;
            base.record()
        } else {
            if library.bases.len() >= MAX_BASES {
                return Err("最多创建 20 个知识库。".into());
            }
            let base = Base {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                enabled: false,
                documents: vec![],
            };
            let record = base.record();
            library.bases.push(base);
            record
        };
        self.write(&library)?;
        Ok(record)
    }
    fn import(
        &self,
        reference: KnowledgeReference,
        inputs: Vec<DocumentImport>,
        replace: bool,
    ) -> Result<KnowledgeRecord, String> {
        if inputs.is_empty()
            || inputs.len() > 20
            || inputs.iter().map(|i| i.text.len()).sum::<usize>() > 2 * 1024 * 1024
        {
            return Err("每批可导入 1–20 个文件，总大小最多 2 MiB。".into());
        }
        let mut names = HashSet::new();
        for input in &inputs {
            validate_filename(&input.filename)?;
            validate_text(&input.text)?;
            if !names.insert(input.filename.to_lowercase()) {
                return Err("同一批次不能有重复文件名。".into());
            }
        }
        let _lock = local_data::lock(&self.root)?;
        let mut library = self.read()?;
        let base = library
            .bases
            .iter_mut()
            .find(|b| b.id == reference.id)
            .ok_or("知识库不存在或已删除。")?;
        base.check_revision(&reference)?;
        let new_count = inputs
            .iter()
            .filter(|input| {
                !base
                    .documents
                    .iter()
                    .any(|d| d.filename.to_lowercase() == input.filename.to_lowercase())
            })
            .count();
        if base.documents.len() + new_count > MAX_DOCUMENTS {
            return Err("单个知识库最多保存 200 份资料。".into());
        }
        for input in inputs {
            let text = input
                .text
                .trim_start_matches('\u{feff}')
                .replace("\r\n", "\n")
                .replace('\r', "\n");
            validate_text(&text)?;
            if let Some(document) = base
                .documents
                .iter_mut()
                .find(|d| d.filename.to_lowercase() == input.filename.to_lowercase())
            {
                if !replace {
                    return Err("已有同名资料，请确认替换后重试。".into());
                }
                document.text = text;
                document.filename = input.filename;
            } else {
                base.documents.push(Document {
                    id: uuid::Uuid::new_v4().to_string(),
                    filename: input.filename,
                    text,
                });
            }
        }
        base.enabled = false;
        let record = base.record();
        self.write(&library)?;
        Ok(record)
    }
    fn set_enabled(
        &self,
        reference: KnowledgeReference,
        enabled: bool,
    ) -> Result<KnowledgeSummary, String> {
        let _lock = local_data::lock(&self.root)?;
        let mut library = self.read()?;
        let base = library
            .bases
            .iter_mut()
            .find(|b| b.id == reference.id)
            .ok_or("知识库不存在或已删除。")?;
        base.check_revision(&reference)?;
        if enabled && base.documents.is_empty() {
            return Err("请先导入资料，再启用知识库。".into());
        }
        base.enabled = enabled;
        let summary = base.summary();
        self.write(&library)?;
        Ok(summary)
    }
    fn remove(
        &self,
        reference: KnowledgeReference,
        document_id: Option<String>,
    ) -> Result<(), String> {
        let _lock = local_data::lock(&self.root)?;
        let mut library = self.read()?;
        let base = library
            .bases
            .iter_mut()
            .find(|b| b.id == reference.id)
            .ok_or("知识库不存在或已删除。")?;
        base.check_revision(&reference)?;
        if let Some(id) = document_id {
            if !base.documents.iter().any(|d| d.id == id) {
                return Err("资料不存在或已删除。".into());
            }
            base.documents.retain(|d| d.id != id);
            base.enabled = false;
        } else {
            library.bases.retain(|b| b.id != reference.id);
        }
        self.write(&library)
    }
    fn document(&self, base_id: &str, document_id: &str) -> Result<DocumentRecord, String> {
        let _lock = local_data::lock(&self.root)?;
        let library = self.read()?;
        let document = library
            .bases
            .iter()
            .find(|b| b.id == base_id)
            .and_then(|b| b.documents.iter().find(|d| d.id == document_id))
            .ok_or("资料不存在或已删除。")?;
        Ok(DocumentRecord {
            summary: document.summary(),
            text: document.text.clone(),
        })
    }
    pub fn search(
        &self,
        reference: &KnowledgeReference,
        query: &str,
        require_enabled: bool,
    ) -> Result<KnowledgeContext, String> {
        if query.trim().is_empty() || query.len() > 8192 {
            return Err(
                "知识库检索问题不能为空，且不能超过 8 KiB；请缩短问题或关闭知识库。".into(),
            );
        }
        let _lock = local_data::lock(&self.root)?;
        let library = self.read()?;
        let base = library
            .bases
            .iter()
            .find(|b| b.id == reference.id)
            .ok_or("知识库不存在或已删除。")?;
        base.check_revision(reference)?;
        if require_enabled && !base.enabled {
            return Err("选中的知识库已禁用，请清除选择或重新启用。".into());
        }
        let summary = base.summary();
        drop(_lock);
        let terms = query_terms(query);
        // ponytail: bounded, on-demand lexical search; add a persistent index / embeddings when measured corpus size or recall requires it.
        let candidates: Vec<_> = base
            .documents
            .iter()
            .flat_map(|document| {
                chunks(&document.text)
                    .into_iter()
                    .map(move |chunk| (document, chunk))
            })
            .collect();
        let lowered: Vec<_> = candidates
            .iter()
            .map(|(_, chunk)| chunk.text.to_lowercase())
            .collect();
        let weights: Vec<_> = terms
            .iter()
            .map(|term| {
                let frequency = lowered
                    .iter()
                    .filter(|text| matches_term(text, term) > 0)
                    .count();
                ((candidates.len() + 1) as f64 / (frequency + 1) as f64).ln() + 1.0
            })
            .collect();
        let mut ranked: Vec<_> = candidates
            .iter()
            .enumerate()
            .filter_map(|(index, (_, chunk))| {
                let score: f64 = terms
                    .iter()
                    .zip(&weights)
                    .map(|(term, weight)| {
                        weight * (matches_term(&lowered[index], term) as f64).sqrt()
                    })
                    .sum::<f64>()
                    / (chunk.text.chars().count().max(100) as f64).sqrt();
                (score > 0.0).then_some((index, score))
            })
            .collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut seen = HashSet::new();
        let mut sources = Vec::new();
        for (index, _) in ranked {
            let (document, chunk) = &candidates[index];
            if !seen.insert(chunk.text.as_str()) {
                continue;
            }
            sources.push(KnowledgeSource {
                number: sources.len() + 1,
                document_id: document.id.clone(),
                document_revision: hash(&document.text),
                filename: document.filename.clone(),
                chunk_index: chunk.index,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                text: chunk.text.clone(),
            });
            if sources.len() == MAX_SOURCES {
                break;
            }
        }
        Ok(KnowledgeContext {
            base: summary,
            sources,
        })
    }
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x2fa1f | 0x3040..=0x30ff | 0xac00..=0xd7af)
}
fn query_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut word = String::new();
    let mut previous_cjk = None;
    for c in query.to_lowercase().chars().chain(std::iter::once(' ')) {
        if is_cjk(c) {
            if !word.is_empty() {
                terms.push(std::mem::take(&mut word));
            }
            if let Some(previous) = previous_cjk {
                terms.push(format!("{previous}{c}"));
            }
            previous_cjk = Some(c);
        } else {
            previous_cjk = None;
            if c.is_alphanumeric() {
                word.push(c);
            } else if !word.is_empty() {
                terms.push(std::mem::take(&mut word));
            }
        }
    }
    if query.trim().chars().count() == 1 {
        terms.push(query.trim().to_lowercase());
    }
    let stop = [
        "the", "a", "an", "is", "are", "of", "to", "in", "for", "and", "what", "how", "does", "do",
        "please", "with", "can", "you", "me", "it", "this", "that", "请问", "什么", "怎么", "如何",
        "多少", "一下", "是否", "可以", "帮我", "这个", "那个", "的", "了", "我", "你",
    ];
    let mut seen = HashSet::new();
    terms
        .into_iter()
        .filter(|term| !stop.contains(&term.as_str()) && seen.insert(term.clone()))
        .take(32)
        .collect()
}
fn matches_term(text: &str, term: &str) -> usize {
    let cjk = term.chars().any(is_cjk);
    text.match_indices(term)
        .filter(|(index, _)| {
            cjk || (text[..*index]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_alphanumeric())
                && text[index + term.len()..]
                    .chars()
                    .next()
                    .is_none_or(|c| !c.is_alphanumeric()))
        })
        .count()
}

#[tauri::command]
pub async fn list_knowledge_bases(
    store: State<'_, KnowledgeStore>,
) -> Result<Vec<KnowledgeSummary>, String> {
    store.list()
}
#[tauri::command]
pub async fn get_knowledge_base(
    id: String,
    store: State<'_, KnowledgeStore>,
) -> Result<KnowledgeRecord, String> {
    store.get(&id)
}
#[tauri::command]
pub async fn save_knowledge_base(
    base: Option<KnowledgeReference>,
    name: String,
    store: State<'_, KnowledgeStore>,
) -> Result<KnowledgeRecord, String> {
    store.save(base, name)
}
#[tauri::command]
pub async fn import_knowledge_documents(
    base: KnowledgeReference,
    documents: Vec<DocumentImport>,
    replace: bool,
    store: State<'_, KnowledgeStore>,
) -> Result<KnowledgeRecord, String> {
    store.import(base, documents, replace)
}
#[tauri::command]
pub async fn set_knowledge_base_enabled(
    base: KnowledgeReference,
    enabled: bool,
    store: State<'_, KnowledgeStore>,
) -> Result<KnowledgeSummary, String> {
    store.set_enabled(base, enabled)
}
#[tauri::command]
pub async fn remove_knowledge_base(
    base: KnowledgeReference,
    store: State<'_, KnowledgeStore>,
) -> Result<(), String> {
    store.remove(base, None)
}
#[tauri::command]
pub async fn remove_knowledge_document(
    base: KnowledgeReference,
    document_id: String,
    store: State<'_, KnowledgeStore>,
) -> Result<(), String> {
    store.remove(base, Some(document_id))
}
#[tauri::command]
pub async fn get_knowledge_document(
    base_id: String,
    document_id: String,
    store: State<'_, KnowledgeStore>,
) -> Result<DocumentRecord, String> {
    store.document(&base_id, &document_id)
}
#[tauri::command]
pub async fn search_knowledge_base(
    base: KnowledgeReference,
    query: String,
    store: State<'_, KnowledgeStore>,
) -> Result<KnowledgeContext, String> {
    store.search(&base, &query, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_filename_replacement_cannot_create_an_unreadable_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let store = KnowledgeStore::new(dir.path().into());
        let base = store.save(None, "Unicode".into()).unwrap();
        let first = store
            .import(
                reference(&base.summary),
                vec![input("Résumé.txt", "First")],
                false,
            )
            .unwrap();
        assert!(
            store
                .import(
                    reference(&first.summary),
                    vec![input("résumé.TXT", "Second")],
                    false
                )
                .is_err()
        );
        let updated = store
            .import(
                reference(&first.summary),
                vec![input("résumé.TXT", "Second")],
                true,
            )
            .unwrap();
        assert_eq!(updated.documents.len(), 1);
        assert_eq!(updated.documents[0].id, first.documents[0].id);
        assert_eq!(store.get(&updated.summary.id).unwrap().documents.len(), 1);
    }
    fn reference(summary: &KnowledgeSummary) -> KnowledgeReference {
        KnowledgeReference {
            id: summary.id.clone(),
            revision: summary.revision.clone(),
        }
    }
    fn input(filename: &str, text: &str) -> DocumentImport {
        DocumentImport {
            filename: filename.into(),
            text: text.into(),
        }
    }
    #[test]
    fn complete_lifecycle_atomic_import_and_source_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let store = KnowledgeStore::new(dir.path().into());
        let base = store.save(None, "资料库".into()).unwrap();
        let initial = reference(&base.summary);
        assert!(!base.summary.enabled);
        assert!(store.set_enabled(initial.clone(), true).is_err());
        assert!(
            store
                .import(
                    initial.clone(),
                    vec![input("good.md", "valid"), input("bad.txt", "\0binary")],
                    false
                )
                .is_err()
        );
        assert!(store.get(&initial.id).unwrap().documents.is_empty());
        let record = store.import(initial.clone(), vec![input("手册.md", "\u{feff}退款政策\r\n商品可在 7 天内申请退款。\r\n退款代号：MODELPORT_KB_VERIFIED"), input("other.txt", "设备保修三年。")], false).unwrap();
        let current = reference(&record.summary);
        assert_ne!(initial.revision, current.revision);
        assert!(store.search(&initial, "退款期限", false).is_err());
        assert!(store.search(&current, "退款期限", true).is_err());
        let preview = store.search(&current, "退款期限", false).unwrap();
        assert_eq!(preview.sources[0].filename, "手册.md");
        assert_eq!(preview.sources[0].number, 1);
        assert_eq!(preview.sources[0].start_line, 1);
        assert_eq!(preview.sources[0].end_line, 3);
        store.set_enabled(current.clone(), true).unwrap();
        assert!(
            store
                .search(&current, "quasar xenolith", true)
                .unwrap()
                .sources
                .is_empty()
        );
        assert!(
            store
                .import(
                    current.clone(),
                    vec![input("手册.md", "new content")],
                    false
                )
                .is_err()
        );
        assert!(store.get(&current.id).unwrap().summary.enabled);
        let replaced = store
            .import(
                current.clone(),
                vec![input("手册.md", "退款期限更新为 14 天。")],
                true,
            )
            .unwrap();
        assert_eq!(record.documents[0].id, replaced.documents[0].id);
        assert!(!replaced.summary.enabled);
        assert!(preview.sources[0].text.contains("7 天"));
        let reopened = KnowledgeStore::new(dir.path().into());
        let updated = reference(&replaced.summary);
        assert!(
            reopened
                .document(&updated.id, &replaced.documents[0].id)
                .unwrap()
                .text
                .contains("14 天")
        );
        assert!(store.remove(current, None).is_err());
        store
            .remove(updated, Some(replaced.documents[1].id.clone()))
            .unwrap();
        let last = store.get(&initial.id).unwrap();
        store.remove(reference(&last.summary), None).unwrap();
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn retrieval_unicode_overlap_english_boundaries_and_limits() {
        let text = "税务办理步骤。\n".repeat(400);
        let pieces = chunks(&text);
        assert!(pieces.len() > 1);
        assert!(pieces.iter().all(|c| c.text.chars().count() <= CHUNK_CHARS));
        assert!(pieces[1].start_line <= pieces[0].end_line);
        assert_eq!(matches_term("report port portal", "port"), 1);
        assert_eq!(matches_term("退款办法和退款期限", "退款"), 2);
        assert!(query_terms("the 请问 什么").is_empty());
        assert!(query_terms("请问退款期限是多少？").contains(&"退款".into()));
        let dir = tempfile::tempdir().unwrap();
        let store = KnowledgeStore::new(dir.path().into());
        let record = store.save(None, "测试".into()).unwrap();
        let base = reference(&record.summary);
        for filename in [
            "../outside.md",
            "C:\\secret.txt",
            "file.pdf",
            "file.docx",
            "file.zip",
        ] {
            assert!(
                store
                    .import(base.clone(), vec![input(filename, "text")], false)
                    .is_err()
            );
        }
        assert!(
            store
                .import(
                    base.clone(),
                    vec![input("file.txt", &"x".repeat(MAX_DOCUMENT + 1))],
                    false
                )
                .is_err()
        );
        assert!(
            store
                .import(
                    base.clone(),
                    vec![input("same.md", "text"), input("SAME.MD", "text")],
                    false
                )
                .is_err()
        );
        assert!(store.search(&base, &"x".repeat(8193), false).is_err());
        let record = store
            .import(base, vec![input("long.md", &text)], false)
            .unwrap();
        let hits = store
            .search(&reference(&record.summary), "税务", false)
            .unwrap();
        assert!(hits.sources.len() <= MAX_SOURCES);
        assert!(!hits.sources.is_empty());
    }
    #[test]
    fn corrupt_library_and_held_lock_never_overwrite_user_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = KnowledgeStore::new(dir.path().into());
        std::fs::write(store.path(), b"{broken}").unwrap();
        assert!(store.list().is_err());
        assert!(store.save(None, "new".into()).is_err());
        assert_eq!(std::fs::read(store.path()).unwrap(), b"{broken}");
        let lock = local_data::lock(dir.path()).unwrap();
        assert!(store.list().is_err());
        drop(lock);
        assert!(store.get("../../secret").is_err());
    }
}
