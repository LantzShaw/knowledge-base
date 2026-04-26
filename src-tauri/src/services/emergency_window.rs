//! 紧急待办的全屏接管窗口
//!
//! 当 priority == 0（紧急）的任务到点时，开一个独立的「最大化 + 无边框 + always-on-top」
//! 窗口直接抢用户注意，配合前端循环铃声。窗口 URL 走 HashRouter
//! `#/emergency-reminder/:taskId`，前端按 id 拉数据并提供完成 / 推迟按钮。
//!
//! 设计要点：
//! - 同一任务已存在窗口直接 set_focus 前置，避免重复弹
//! - label = `emergency-{task_id}`，对应 capabilities/emergency.json 的窗口 glob
//! - 用 maximized + decorations:false 模拟「全屏接管」，比真 fullscreen 安全
//!   （不切显示模式、Alt+Tab 仍可用、不会抢游戏 fullscreen 焦点）

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::AppError;

/// 给指定任务打开紧急提醒窗口；已存在则前置
pub fn open_for_task(app: &AppHandle, task_id: i64) -> Result<(), AppError> {
    let label = format!("emergency-{}", task_id);

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_focus();
        return Ok(());
    }

    let url = format!("index.html#/emergency-reminder/{}", task_id);
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("紧急待办提醒")
        .inner_size(1200.0, 800.0)
        .min_inner_size(640.0, 420.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(false)
        .focused(true)
        .maximized(true)
        .visible(true)
        .build()
        .map_err(|e| AppError::Custom(format!("紧急提醒窗口创建失败: {}", e)))?;

    Ok(())
}
