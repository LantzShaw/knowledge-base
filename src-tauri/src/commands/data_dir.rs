//! T-013 自定义数据目录 — Tauri Commands
//!
//! 暴露给前端：
//! - `get_data_dir_info` 读当前/默认/指针/来源（设置页 UI 显示用）
//! - `set_pending_data_dir` 写指针文件（重启生效）
//! - `clear_pending_data_dir` 清指针文件（恢复默认；重启生效）

use tauri::Manager;

use crate::services::data_dir::{DataDirResolver, ResolvedDataDir};

#[tauri::command]
pub fn get_data_dir_info(app: tauri::AppHandle) -> Result<ResolvedDataDir, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    DataDirResolver::resolve(&app_data_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pending_data_dir(
    app: tauri::AppHandle,
    new_path: String,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    DataDirResolver::set_pending(&app_data_dir, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_pending_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    DataDirResolver::clear_pending(&app_data_dir).map_err(|e| e.to_string())
}
