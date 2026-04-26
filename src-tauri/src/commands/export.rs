use tauri::AppHandle;

use crate::models::{ExportResult, SingleExportResult};
use crate::services;
use crate::state::AppState;

/// 批量导出笔记为 Markdown 文件
///
/// 入参 `output_dir` 是用户选择的父目录；服务会在其下自动创建一层
/// `知识库导出_YYYYMMDD_HHmmss/` 作为实际导出根（结果中的 `root_dir`）。
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

/// 导出单篇笔记为 Markdown 文件
///
/// 入参 `parent_dir` 是用户选择的父目录；服务会在其下创建一层
/// `{标题}/` 子目录，里面放 `{标题}.md` 与 `assets/`。
///
/// - `id`: 笔记 ID
/// - `parent_dir`: 用户选择的父目录路径
#[tauri::command]
pub fn export_single_note(
    state: tauri::State<'_, AppState>,
    id: i64,
    parent_dir: String,
) -> Result<SingleExportResult, String> {
    services::export::ExportService::export_single_note(
        &state.db,
        &state.data_dir,
        id,
        &parent_dir,
    )
    .map_err(|e| e.to_string())
}
