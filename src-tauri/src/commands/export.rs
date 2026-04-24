use tauri::AppHandle;

use crate::models::ExportResult;
use crate::services;
use crate::state::AppState;

/// 批量导出笔记为 Markdown 文件（同时拷贝引用的图片/附件到 .assets/）
#[tauri::command]
pub fn export_notes(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    output_dir: String,
    folder_id: Option<i64>,
) -> Result<ExportResult, String> {
    services::export::ExportService::export_notes(
        &state.db,
        &state.data_dir,
        &output_dir,
        folder_id,
        &app,
    )
    .map_err(|e| e.to_string())
}

/// 导出单篇笔记为 Markdown 文件（同时拷贝引用的图片/附件到 .assets/）
///
/// - `id`: 笔记 ID
/// - `file_path`: 保存路径（含文件名）
#[tauri::command]
pub fn export_single_note(
    state: tauri::State<'_, AppState>,
    id: i64,
    file_path: String,
) -> Result<usize, String> {
    services::export::ExportService::export_single_note(
        &state.db,
        &state.data_dir,
        id,
        &file_path,
    )
    .map_err(|e| e.to_string())
}
