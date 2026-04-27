use tauri::State;

use crate::services::image::ImageService;
use crate::state::AppState;

/// 保存图片（base64 数据，用于粘贴/拖放）。按笔记 is_encrypted 自动加密。
///
/// 返回保存后的绝对路径（加密笔记返回的路径以 `.enc` 结尾，前端据此走 `get_image_blob`）
#[tauri::command]
pub fn save_note_image(
    state: State<'_, AppState>,
    note_id: i64,
    file_name: String,
    base64_data: String,
) -> Result<String, String> {
    ImageService::save_from_base64(
        &state.db,
        &state.vault,
        &state.data_dir,
        note_id,
        &file_name,
        &base64_data,
    )
    .map_err(|e| e.to_string())
}

/// 从本地文件路径保存图片（用于工具栏文件选择）。按笔记 is_encrypted 自动加密。
#[tauri::command]
pub fn save_note_image_from_path(
    state: State<'_, AppState>,
    note_id: i64,
    source_path: String,
) -> Result<String, String> {
    ImageService::save_from_path(
        &state.db,
        &state.vault,
        &state.data_dir,
        note_id,
        &source_path,
    )
    .map_err(|e| e.to_string())
}

/// 删除笔记的所有图片
#[tauri::command]
pub fn delete_note_images(state: State<'_, AppState>, note_id: i64) -> Result<(), String> {
    ImageService::delete_note_images(&state.data_dir, note_id).map_err(|e| e.to_string())
}

/// 获取图片存储目录路径
#[tauri::command]
pub fn get_images_dir(state: State<'_, AppState>) -> Result<String, String> {
    let images_dir = ImageService::ensure_dir(&state.data_dir).map_err(|e| e.to_string())?;
    Ok(images_dir.to_string_lossy().into_owned())
}

/// 读取图片字节流，路径以 `.enc` 结尾时用 vault key 解密。返回原始 PNG/JPG 等字节，
/// 前端用 `new Blob([bytes])` + `URL.createObjectURL` 喂给 `<img>`。
///
/// 安全：只允许读 `kb_assets/images/` 目录下的文件，避免被当任意文件读接口滥用。
#[tauri::command]
pub fn get_image_blob(state: State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    let images_root = ImageService::images_dir(&state.data_dir);
    let images_root_str = images_root.to_string_lossy().to_string();
    let normalized = path.replace('\\', "/");
    let root_normalized = images_root_str.replace('\\', "/");
    if !normalized.starts_with(&root_normalized) {
        return Err(format!("非法路径（不在 images 目录下）: {}", path));
    }
    ImageService::read_for_render(&state.vault, &path).map_err(|e| e.to_string())
}

