//! 外部 MCP server 客户端管理（M5-2）
//!
//! 用户在「设置 → MCP 服务器」里加的每个 server 都对应一个独立子进程。
//! 频繁调用时不能每次都 spawn（握手 1-2s 太贵），所以做进程级缓存：
//!   - 第一次访问 server X → spawn + 握手 + 存到 HashMap<id, Arc<RunningService>>
//!   - 后续调用 → 直接拿 Arc 复用
//!   - server 改配置 / 禁用 / 删除 → 调 disconnect(id) 清缓存（下次访问会重新 spawn）

use std::collections::HashMap;
use std::sync::Arc;

use rmcp::ServiceExt;
use rmcp::transport::TokioChildProcess;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::McpServer;

/// 与 in-memory client 同类型：RoleClient + 不响应 server-initiated 请求
type ExternalClient = Arc<rmcp::service::RunningService<rmcp::RoleClient, ()>>;

/// 全局 MCP client 池。AppState 持一份。
#[derive(Default)]
pub struct McpClientManager {
    clients: Mutex<HashMap<i64, ExternalClient>>,
}

impl McpClientManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 取（或首次 spawn）指定 server 的 client。
    ///
    /// 错误场景：
    /// - server.enabled = false → InvalidInput
    /// - command 不存在 / spawn 失败 → IO error 包裹
    /// - 子进程握手失败（不是合规 MCP server）→ Custom error
    pub async fn get_or_spawn(&self, server: &McpServer) -> Result<ExternalClient, AppError> {
        if !server.enabled {
            return Err(AppError::Custom(format!(
                "MCP server {} 已禁用",
                server.name
            )));
        }

        let mut guard = self.clients.lock().await;
        if let Some(c) = guard.get(&server.id) {
            return Ok(c.clone());
        }

        // 第一次访问：spawn 子进程
        let mut cmd = tokio::process::Command::new(&server.command);
        cmd.args(&server.args);
        for (k, v) in &server.env {
            cmd.env(k, v);
        }

        // Windows 必须设 CREATE_NO_WINDOW，否则打包后每次 spawn 都弹 CMD 黑窗
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let transport = TokioChildProcess::new(cmd)
            .map_err(|e| AppError::Custom(format!("spawn {} 失败: {}", server.command, e)))?;

        let client = ()
            .serve(transport)
            .await
            .map_err(|e| AppError::Custom(format!("MCP 握手失败: {e}")))?;

        let arc = Arc::new(client);
        guard.insert(server.id, arc.clone());
        log::info!(
            "[mcp-external] spawned id={} name={} command={}",
            server.id,
            server.name,
            server.command
        );
        Ok(arc)
    }

    /// 关闭指定 server 的 client + 清缓存。改配置 / 禁用 / 删除时调用。
    pub async fn disconnect(&self, id: i64) {
        let mut guard = self.clients.lock().await;
        if guard.remove(&id).is_some() {
            log::info!("[mcp-external] disconnected id={}", id);
        }
    }

    /// 应用退出 / 实例切换时全部断开
    #[allow(dead_code)]
    pub async fn disconnect_all(&self) {
        let mut guard = self.clients.lock().await;
        let count = guard.len();
        guard.clear();
        log::info!("[mcp-external] disconnected all ({} clients)", count);
    }
}
