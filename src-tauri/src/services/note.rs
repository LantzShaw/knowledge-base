use crate::database::Database;
use crate::error::AppError;
use crate::models::{Note, NoteInput, NoteQuery, PageResult};

/// 笔记服务
pub struct NoteService;

impl NoteService {
    /// 创建笔记
    pub fn create(db: &Database, input: &NoteInput) -> Result<Note, AppError> {
        if input.title.trim().is_empty() {
            return Err(AppError::InvalidInput("笔记标题不能为空".into()));
        }
        db.create_note(input)
    }

    /// 更新笔记
    pub fn update(db: &Database, id: i64, input: &NoteInput) -> Result<Note, AppError> {
        if input.title.trim().is_empty() {
            return Err(AppError::InvalidInput("笔记标题不能为空".into()));
        }
        db.update_note(id, input)
    }

    /// 批量移动笔记到指定文件夹；返回实际移动的条数
    ///
    /// - `folder_id = None` → 移到根目录
    /// - folder_id 的合法性由前端（`folderApi.list()`）保证；这里不再 round-trip 校验
    pub fn move_batch(
        db: &Database,
        ids: &[i64],
        folder_id: Option<i64>,
    ) -> Result<usize, AppError> {
        if ids.is_empty() {
            return Ok(0);
        }
        db.move_notes_batch(ids, folder_id)
    }

    /// 批量软删除（移入回收站）；返回实际标记删除的条数
    pub fn trash_batch(db: &Database, ids: &[i64]) -> Result<usize, AppError> {
        if ids.is_empty() {
            return Ok(0);
        }
        db.soft_delete_notes_batch(ids)
    }

    /// 批量给多篇笔记追加标签（不清除原有标签）；返回新增的关联条数
    pub fn add_tags_batch(
        db: &Database,
        note_ids: &[i64],
        tag_ids: &[i64],
    ) -> Result<usize, AppError> {
        if note_ids.is_empty() || tag_ids.is_empty() {
            return Ok(0);
        }
        db.add_tags_to_notes_batch(note_ids, tag_ids)
    }

    /// 删除笔记（永久删除，预留给未来使用）
    #[allow(dead_code)]
    pub fn delete(db: &Database, id: i64) -> Result<(), AppError> {
        let deleted = db.delete_note(id)?;
        if !deleted {
            return Err(AppError::NotFound(format!("笔记 {} 不存在", id)));
        }
        Ok(())
    }

    /// 获取单个笔记
    pub fn get(db: &Database, id: i64) -> Result<Note, AppError> {
        db.get_note(id)?
            .ok_or_else(|| AppError::NotFound(format!("笔记 {} 不存在", id)))
    }

    /// 切换笔记置顶状态
    pub fn toggle_pin(db: &Database, id: i64) -> Result<bool, AppError> {
        db.toggle_pin(id)
    }

    /// 移动笔记到文件夹
    pub fn move_to_folder(db: &Database, note_id: i64, folder_id: Option<i64>) -> Result<(), AppError> {
        db.move_note_to_folder(note_id, folder_id)
    }

    /// 全部移到回收站（软删，可在回收站恢复）
    pub fn trash_all(db: &Database) -> Result<usize, AppError> {
        db.trash_all_notes()
    }

    /// 查询笔记列表（分页）
    pub fn list(db: &Database, query: &NoteQuery) -> Result<PageResult<Note>, AppError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).clamp(1, 100);

        let (items, total) = db.list_notes(
            query.folder_id,
            query.keyword.as_deref(),
            page,
            page_size,
        )?;

        Ok(PageResult {
            items,
            total,
            page,
            page_size,
        })
    }

    // ─── T-003 隐藏笔记 ────────────────────────────

    /// 切换笔记"隐藏"状态
    pub fn set_hidden(db: &Database, id: i64, hidden: bool) -> Result<bool, AppError> {
        db.set_note_hidden(id, hidden)
    }

    /// 列出所有隐藏笔记（分页）
    pub fn list_hidden(
        db: &Database,
        page: Option<usize>,
        page_size: Option<usize>,
    ) -> Result<PageResult<Note>, AppError> {
        let page = page.unwrap_or(1).max(1);
        let page_size = page_size.unwrap_or(20).clamp(1, 100);
        let (items, total) = db.list_hidden_notes(page, page_size)?;
        Ok(PageResult {
            items,
            total,
            page,
            page_size,
        })
    }

    // ─── T-007 笔记加密 ────────────────────────────

    /// 加密这篇笔记：读 content → vault 加密 → 写入 blob + 占位 content
    ///
    /// 要求 vault 已解锁。调用前自行检查 `VaultService::status`。
    pub fn encrypt_note(
        db: &Database,
        vault: &std::sync::RwLock<crate::services::vault::VaultState>,
        id: i64,
    ) -> Result<(), AppError> {
        // 读现有明文 content
        let note = db
            .get_note(id)?
            .ok_or_else(|| AppError::NotFound(format!("笔记 {} 不存在", id)))?;
        if note.is_encrypted {
            return Err(AppError::Custom("笔记已经处于加密态".to_string()));
        }
        let blob = crate::services::vault::VaultService::encrypt_plaintext(
            vault,
            note.content.as_bytes(),
        )?;
        // 占位符不会参与 FTS5 匹配（跟标题分隔开）；前端也用它做"已加密"提示
        const PLACEHOLDER: &str = "🔒 已加密内容——请解锁后查看";
        db.enable_note_encryption(id, PLACEHOLDER, &blob)?;
        Ok(())
    }

    /// 解密并返回明文（不改库状态）。vault 必须已解锁
    pub fn decrypt_note(
        db: &Database,
        vault: &std::sync::RwLock<crate::services::vault::VaultState>,
        id: i64,
    ) -> Result<String, AppError> {
        let blob = db
            .get_encrypted_blob(id)?
            .ok_or_else(|| AppError::NotFound(format!("笔记 {} 未加密或不存在", id)))?;
        let plaintext_bytes =
            crate::services::vault::VaultService::decrypt_blob(vault, &blob)?;
        String::from_utf8(plaintext_bytes)
            .map_err(|e| AppError::Custom(format!("密文解码为 UTF-8 失败: {}", e)))
    }

    /// 取消加密：解密后把明文写回 content + 清 blob
    pub fn disable_encrypt(
        db: &Database,
        vault: &std::sync::RwLock<crate::services::vault::VaultState>,
        id: i64,
    ) -> Result<(), AppError> {
        let plaintext = Self::decrypt_note(db, vault, id)?;
        db.disable_note_encryption(id, &plaintext)?;
        Ok(())
    }
}
