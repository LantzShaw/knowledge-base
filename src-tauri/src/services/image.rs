use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use walkdir::WalkDir;

/// 进程内递增计数器，保证同一毫秒内多次保存也不会冲突
static IMAGE_SEQ: AtomicU64 = AtomicU64::new(0);

use crate::database::Database;
use crate::error::AppError;
use crate::models::{OrphanImageClean, OrphanImageScan};
use crate::services::vault::{VaultService, VaultState};

/// 图片资产目录名（dev 模式加 dev- 前缀实现数据隔离）
const ASSETS_DIR_PROD: &str = "kb_assets";
const ASSETS_DIR_DEV: &str = "dev-kb_assets";
const IMAGES_DIR: &str = "images";
/// 加密图片落盘后缀。文件名形如 `20260101_xxx.png.enc`，
/// 内容为 `aead_encrypt(vault_key, raw_bytes)`。
/// 用后缀而非独立目录的好处：scan_orphans / delete_note_images 等扫盘逻辑零改动。
const ENC_SUFFIX: &str = ".enc";

/// 笔记加密态切换时的图片迁移方向
#[derive(Debug, Clone, Copy)]
pub enum ImageMigration {
    /// 普通笔记 → 加密笔记：把所有明文图片加密成 .enc，删原文件
    Encrypt,
    /// 加密笔记 → 普通笔记：把所有 .enc 解密回原后缀，删 .enc
    Decrypt,
}

#[inline]
fn assets_dir_name() -> &'static str {
    if cfg!(debug_assertions) { ASSETS_DIR_DEV } else { ASSETS_DIR_PROD }
}

pub struct ImageService;

impl ImageService {
    /// 获取图片根目录: {app_data_dir}/{prefix}kb_assets/images/
    pub fn images_dir(app_data_dir: &Path) -> PathBuf {
        app_data_dir.join(assets_dir_name()).join(IMAGES_DIR)
    }

    /// 确保图片目录存在
    pub fn ensure_dir(app_data_dir: &Path) -> Result<PathBuf, AppError> {
        let dir = Self::images_dir(app_data_dir);
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// 从 base64 数据保存图片（用于粘贴/拖放）。按笔记 is_encrypted 自动路由到加/明文分支。
    ///
    /// 返回保存后的绝对路径（加密笔记返回的路径以 `.enc` 结尾）
    pub fn save_from_base64(
        db: &Database,
        vault: &RwLock<VaultState>,
        app_data_dir: &Path,
        note_id: i64,
        file_name: &str,
        base64_data: &str,
    ) -> Result<String, AppError> {
        let data = STANDARD
            .decode(base64_data)
            .map_err(|e| AppError::Custom(format!("base64 解码失败: {}", e)))?;

        Self::save_bytes_routed(db, vault, app_data_dir, note_id, file_name, &data)
    }

    /// 从本地文件路径复制图片（用于工具栏插入）。按笔记 is_encrypted 自动路由。
    ///
    /// 返回保存后的绝对路径（加密笔记返回的路径以 `.enc` 结尾）
    pub fn save_from_path(
        db: &Database,
        vault: &RwLock<VaultState>,
        app_data_dir: &Path,
        note_id: i64,
        source_path: &str,
    ) -> Result<String, AppError> {
        let source = Path::new(source_path);
        if !source.exists() {
            return Err(AppError::NotFound(format!("文件不存在: {}", source_path)));
        }

        let file_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("image.png");

        let data = std::fs::read(source)?;
        Self::save_bytes_routed(db, vault, app_data_dir, note_id, file_name, &data)
    }

    /// 反查笔记 is_encrypted，加密笔记走 AEAD + `.enc`，否则走明文。
    /// 用户交互入口（粘贴/拖放/工具栏）应优先用这个。
    pub fn save_bytes_routed(
        db: &Database,
        vault: &RwLock<VaultState>,
        app_data_dir: &Path,
        note_id: i64,
        file_name: &str,
        data: &[u8],
    ) -> Result<String, AppError> {
        let is_encrypted = db.get_note_is_encrypted(note_id)?;
        if is_encrypted {
            // 加密分支：先 aead_encrypt 再落盘 .enc
            let blob = VaultService::encrypt_plaintext(vault, data)?;
            Self::save_bytes_inner(app_data_dir, note_id, file_name, &blob, true)
        } else {
            Self::save_bytes_inner(app_data_dir, note_id, file_name, data, false)
        }
    }

    /// 保存字节数据到文件（明文模式；导入流程用，新建笔记 is_encrypted 默认 false）
    ///
    /// 调用方若不能保证笔记非加密态，请改用 `save_bytes_routed`。
    pub fn save_bytes(
        app_data_dir: &Path,
        note_id: i64,
        file_name: &str,
        data: &[u8],
    ) -> Result<String, AppError> {
        Self::save_bytes_inner(app_data_dir, note_id, file_name, data, false)
    }

    /// 内部落盘实现：`encrypted` 决定文件名是否追加 `.enc`。
    fn save_bytes_inner(
        app_data_dir: &Path,
        note_id: i64,
        file_name: &str,
        data: &[u8],
        encrypted: bool,
    ) -> Result<String, AppError> {
        let note_dir = Self::images_dir(app_data_dir).join(note_id.to_string());
        std::fs::create_dir_all(&note_dir)?;

        // 从原始文件名提取扩展名
        let ext = Path::new(file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");

        // Why: 原版只用 timestamp+纳秒，Windows 系统时钟在极短间隔内可能返回相同值，
        // 多张图连续保存会互相覆盖 → 前端看起来"只进一张"。加进程内原子计数器彻底消除冲突。
        let now = chrono::Local::now();
        let seq = IMAGE_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique_name = format!(
            "{}_{:09}_{:06}.{}{}",
            now.format("%Y%m%d%H%M%S"),
            now.timestamp_subsec_nanos(),
            seq,
            ext,
            if encrypted { ENC_SUFFIX } else { "" },
        );

        let file_path = note_dir.join(&unique_name);
        std::fs::write(&file_path, data)?;

        log::info!(
            "图片已保存{}: {}",
            if encrypted { "（加密）" } else { "" },
            file_path.display()
        );
        Ok(file_path.to_string_lossy().into_owned())
    }

    /// 给 `get_image_blob` Command 用：路径以 `.enc` 结尾时用 vault key 解密返回明文字节，
    /// 否则直接读取磁盘原字节。
    ///
    /// 安全：路径校验留给 Command 层。这里只关心读 + 解密。
    /// vault 锁定时调用加密路径会返回 `vault 未解锁` 错误。
    pub fn read_for_render(
        vault: &RwLock<VaultState>,
        path: &str,
    ) -> Result<Vec<u8>, AppError> {
        let bytes = std::fs::read(path)?;
        if path.ends_with(ENC_SUFFIX) {
            VaultService::decrypt_blob(vault, &bytes)
        } else {
            Ok(bytes)
        }
    }

    /// 笔记加密态切换时的图片立即迁移：扫 `images/{note_id}/` 把所有图片做相反操作。
    ///
    /// - `Encrypt`：跳过已带 `.enc` 后缀的；其它文件 read → aead_encrypt → 写 `*.enc` → 删原文件
    /// - `Decrypt`：跳过不带 `.enc` 的；其它 read → aead_decrypt → 写去除 `.enc` 后缀名 → 删 `.enc`
    ///
    /// 返回成功迁移的文件数。任一文件失败立即返回 Err（避免半迁移状态）。
    /// 调用方应在 vault 已解锁状态下调用，否则 encrypt/decrypt 会失败。
    pub fn migrate_note_images(
        vault: &RwLock<VaultState>,
        app_data_dir: &Path,
        note_id: i64,
        action: ImageMigration,
    ) -> Result<usize, AppError> {
        let note_dir = Self::images_dir(app_data_dir).join(note_id.to_string());
        if !note_dir.exists() {
            return Ok(0);
        }

        let mut migrated = 0usize;
        for entry in std::fs::read_dir(&note_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let is_enc = name.ends_with(ENC_SUFFIX);

            match action {
                ImageMigration::Encrypt => {
                    if is_enc {
                        continue;
                    }
                    let data = std::fs::read(&path)?;
                    let blob = VaultService::encrypt_plaintext(vault, &data)?;
                    let new_path = note_dir.join(format!("{}{}", name, ENC_SUFFIX));
                    std::fs::write(&new_path, &blob)?;
                    std::fs::remove_file(&path)?;
                    migrated += 1;
                }
                ImageMigration::Decrypt => {
                    if !is_enc {
                        continue;
                    }
                    let blob = std::fs::read(&path)?;
                    let data = VaultService::decrypt_blob(vault, &blob)?;
                    let original_name =
                        name.strip_suffix(ENC_SUFFIX).unwrap_or(name.as_str());
                    let new_path = note_dir.join(original_name);
                    std::fs::write(&new_path, &data)?;
                    std::fs::remove_file(&path)?;
                    migrated += 1;
                }
            }
        }

        log::info!(
            "笔记 {} 图片迁移完成（{:?}）：{} 个",
            note_id,
            action,
            migrated
        );
        Ok(migrated)
    }

    /// 删除笔记的所有图片
    pub fn delete_note_images(app_data_dir: &Path, note_id: i64) -> Result<(), AppError> {
        let note_dir = Self::images_dir(app_data_dir).join(note_id.to_string());
        if note_dir.exists() {
            std::fs::remove_dir_all(&note_dir)?;
            log::info!("已删除笔记 {} 的所有图片", note_id);
        }
        Ok(())
    }

    /// 扫描孤儿图片（只扫不删）
    ///
    /// 判定方式：图片文件名形如 `YYYYMMDDHHMMSS_<nanos>.ext`，
    /// 扫描所有笔记 content 抓出所有"带图片扩展名的 token"塞进 HashSet，
    /// 磁盘文件若名字不在 set 里则视为孤儿。
    ///
    /// **旧实现的问题**：把所有笔记 content 拼成一个 GB 级 haystack，再对磁盘上
    /// 每个图片文件名做 O(n*m) 子串匹配 `haystack.contains(name)`。笔记库大时：
    ///   - haystack 内存峰值可达数百 MB（所有正文拷贝 + `join` 再拷贝一次）
    ///   - 每次 contains() 线性扫描整个 haystack
    ///
    /// **新实现**：流式扫描 content，用手写状态机一次扫过提取所有 `<name>.<ext>` token。
    /// 判定孤儿时直接 `HashSet::contains`，O(1) 查表。
    pub fn scan_orphans(db: &Database, app_data_dir: &Path) -> Result<OrphanImageScan, AppError> {
        use std::collections::HashSet;
        const DISPLAY_LIMIT: usize = 500;

        // 1) 构建"笔记里引用的图片文件名"集合：扫 content 抓时间戳前缀的文件名 token
        let contents = db.list_all_active_contents()?;
        let mut referenced: HashSet<String> = HashSet::new();
        for c in &contents {
            collect_image_filenames(c, &mut referenced);
        }
        drop(contents); // 及早释放大字符串数组

        // 2) 遍历图片目录
        let images_root = Self::images_dir(app_data_dir);
        if !images_root.exists() {
            return Ok(OrphanImageScan {
                count: 0,
                total_bytes: 0,
                paths: Vec::new(),
                truncated: false,
            });
        }

        let mut count = 0usize;
        let mut total_bytes = 0u64;
        let mut paths: Vec<String> = Vec::new();
        let mut truncated = false;

        for entry in WalkDir::new(&images_root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let name = match entry.file_name().to_str() {
                Some(n) => n,
                None => continue,
            };
            // referenced 里的文件名在 collect 时已小写化，这里也小写再比
            if referenced.contains(&name.to_lowercase()) {
                continue;
            }
            // 是孤儿
            count += 1;
            if let Ok(md) = entry.metadata() {
                total_bytes += md.len();
            }
            if paths.len() < DISPLAY_LIMIT {
                paths.push(entry.path().to_string_lossy().into_owned());
            } else {
                truncated = true;
            }
        }

        Ok(OrphanImageScan {
            count,
            total_bytes,
            paths,
            truncated,
        })
    }

    /// 删除指定路径列表的孤儿图片
    ///
    /// 为安全起见，仅允许删除 images 目录下的文件（路径前缀校验）。
    pub fn clean_orphans(
        app_data_dir: &Path,
        paths: &[String],
    ) -> Result<OrphanImageClean, AppError> {
        let images_root = Self::images_dir(app_data_dir);
        let images_root_str = images_root.to_string_lossy().to_string();
        let mut deleted = 0usize;
        let mut freed_bytes = 0u64;
        let mut failed: Vec<String> = Vec::new();

        for p in paths {
            // 安全校验：路径必须在 images 目录下
            if !p.starts_with(&images_root_str) {
                failed.push(format!("{}: 非法路径（不在 images 目录下）", p));
                continue;
            }
            let path = Path::new(p);
            if !path.exists() {
                // 已不存在，忽略
                continue;
            }
            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            match std::fs::remove_file(path) {
                Ok(_) => {
                    deleted += 1;
                    freed_bytes += size;
                }
                Err(e) => failed.push(format!("{}: {}", p, e)),
            }
        }

        Ok(OrphanImageClean {
            deleted,
            freed_bytes,
            failed,
        })
    }
}

/// 从一段笔记正文中提取所有"疑似图片文件名"并塞入 set。
///
/// 规则：识别以下扩展名的 token（忽略大小写）：`png jpg jpeg gif webp svg bmp`。
/// 找到 `.<ext>` 后向前回溯到首个分隔符（空白、`/`、`\`、`"`、`'`、`(`、`)`、`<`、`>`、`[`、`]`、`!`、`#`、`?`），
/// 得到完整文件名（不含路径）。无正则依赖，一次线性扫过。
fn collect_image_filenames(text: &str, out: &mut std::collections::HashSet<String>) {
    const EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
    let lower = text.to_lowercase();
    let bytes = lower.as_bytes();

    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'.' {
            i += 1;
            continue;
        }
        // 尝试匹配 `.<ext>`（后面紧跟非字母数字或到末尾）
        let ext_start = i + 1;
        let mut matched: Option<(usize, usize)> = None; // (start, end_exclusive)
        for ext in EXTS {
            let end = ext_start + ext.len();
            if end > bytes.len() {
                continue;
            }
            if &bytes[ext_start..end] != ext.as_bytes() {
                continue;
            }
            // 后一个字符必须不是字母数字，避免把 `.pngx` 错当 `.png`
            let ok = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
            if ok {
                matched = Some((ext_start, end));
                break;
            }
        }
        let Some((_ext_s, mut end)) = matched else {
            i += 1;
            continue;
        };

        // 识别加密图片：紧跟 `.enc` 时把 end 推到 `.enc` 末尾，
        // 这样 `xxx.png.enc` 整体被当成一个文件名 token，孤儿扫描不会误判。
        if end + 4 <= bytes.len() && &bytes[end..end + 4] == b".enc" {
            let after = end + 4;
            // .enc 后紧跟非字母数字（或到末尾）才确认；防止 .encx 误判
            let ok = after == bytes.len() || !bytes[after].is_ascii_alphanumeric();
            if ok {
                end = after;
            }
        }

        // 向前回溯找到文件名起点（到首个分隔符或开头）
        let mut start = i; // i 指向 `.`
        while start > 0 {
            let b = bytes[start - 1];
            if matches!(
                b,
                b' ' | b'\t'
                    | b'\n'
                    | b'\r'
                    | b'/'
                    | b'\\'
                    | b'"'
                    | b'\''
                    | b'('
                    | b')'
                    | b'<'
                    | b'>'
                    | b'['
                    | b']'
                    | b'!'
                    | b'#'
                    | b'?'
                    | b'&'
                    | b'='
                    | b','
                    | b';'
                    | b':'
            ) {
                break;
            }
            start -= 1;
        }

        if start < i {
            // &lower[start..end] 是纯 ASCII 文件名（扩展名是 ASCII，文件名部分来自保存逻辑也是 ASCII）
            let token = &lower[start..end];
            // 限制长度防止把整段 token 都当文件名（比如异常数据里可能有超长 token）
            if token.len() <= 128 {
                out.insert(token.to_string());
            }
        }
        i = end;
    }
}
