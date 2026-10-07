use serde::{Serialize, de::DeserializeOwned};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

pub fn check_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err("本地数据位置不能是符号链接或目录联接。".into());
                }
            }
            if metadata.file_type().is_symlink() {
                return Err("本地数据位置不能是符号链接。".into());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法检查本地数据存储位置。".into()),
    }
}

pub fn lock(root: &Path) -> Result<File, String> {
    check_path(root)?;
    fs::create_dir_all(root).map_err(|_| "无法创建本地数据目录。")?;
    let path = root.join("library.lock");
    check_path(&path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| "无法访问本地数据锁。")?;
    file.try_lock()
        .map_err(|_| "本地数据正被另一个操作占用，请稍后重试。")?;
    Ok(file)
}

pub fn read_json<T: DeserializeOwned>(path: &Path, limit: usize) -> Result<Option<T>, String> {
    check_path(path)?;
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取本地库；原始数据未更改。".into()),
    };
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取本地库失败。")?;
    if bytes.len() > limit {
        return Err("本地库超过大小限制，原始数据未更改。".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "本地库文件损坏；请保留原文件并恢复备份，原始数据不会被覆盖。".into())
}

pub fn write_json<T: Serialize>(path: &Path, value: &T, limit: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "无法生成本地库数据。")?;
    if bytes.len() > limit {
        return Err("本地库总大小超过限制，原始数据未更改。".into());
    }
    check_path(path)?;
    let root = path.parent().ok_or("本地库位置无效。")?;
    let mut temp = tempfile::NamedTempFile::new_in(root).map_err(|_| "无法创建保存临时文件。")?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "保存失败，原始数据未更改。")?;
    temp.persist(path)
        .map_err(|_| "无法替换本地库，原始数据未更改。")?;
    Ok(())
}
