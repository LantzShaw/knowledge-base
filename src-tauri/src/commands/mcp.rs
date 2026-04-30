//! MCP Commands：把同进程内的 in-memory MCP server 暴露给前端
//!
//! 这一组 IPC 走"双层"路径：
//!   前端 invoke("mcp_internal_call_tool", ...)
//!     → commands::mcp::* (本文件)
//!     → state.mcp_internal (rmcp client)
//!     → kb_core::KbServer (in-process MCP server，通过 tokio::io::duplex 通信)
//!     → SQL on shared db
//!
//! 看似绕了一圈，但好处：
//!   1) 自家 AI 对话页和外部 Claude Desktop 用完全同一份工具实现（kb-core 12 工具）
//!   2) 后续接外部 MCP server 时（GitHub / Filesystem / 高德地图…）可以走同样的 client API
//!   3) 协议统一，UI 不需要区分"原生工具"和"外部工具"

use std::path::PathBuf;

use rmcp::model::CallToolRequestParams;
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::state::AppState;

/// 主应用编译时被 tauri-build 注入的 target triple，
/// 用来构造 sidecar binary 名字（与 scripts/build-mcp.mjs 的命名一致）
const TARGET_TRIPLE: &str = env!("TAURI_ENV_TARGET_TRIPLE");

/// 设置页 "MCP 服务器" 卡片的运行时信息
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRuntimeInfo {
    /// in-memory MCP server 是否就绪
    pub internal_ready: bool,
    /// kb-mcp sidecar binary 在本机的绝对路径（None 表示找不到，提示用户先 pnpm build:mcp）
    pub sidecar_binary_path: Option<String>,
    /// 知识库 db 绝对路径，给 Claude Desktop config JSON 用
    pub db_path: String,
    /// Host target triple（如 x86_64-pc-windows-msvc）
    pub target_triple: String,
    /// 当前操作系统（"windows" / "macos" / "linux"），方便前端选择对应的配置示例
    pub os: String,
}

/// 设置页用：拿 sidecar 路径 + db 路径，生成客户端配置 JSON
#[tauri::command]
pub fn mcp_runtime_info(state: tauri::State<'_, AppState>) -> Result<McpRuntimeInfo, String> {
    // db 路径：与 lib.rs setup 里 Database::init 用的同一逻辑
    let prefix = if cfg!(debug_assertions) { "dev-" } else { "" };
    let db_path = state.data_dir.join(format!("{}app.db", prefix));

    Ok(McpRuntimeInfo {
        internal_ready: state.mcp_internal.is_some(),
        sidecar_binary_path: locate_sidecar_binary().map(|p| p.to_string_lossy().into_owned()),
        db_path: db_path.to_string_lossy().into_owned(),
        target_triple: TARGET_TRIPLE.to_string(),
        os: std::env::consts::OS.to_string(),
    })
}

/// 找 kb-mcp binary：优先主 exe 同目录（externalBin 打包后位置 = cargo workspace target/<profile>/）
/// dev 期主 exe 与 sidecar 都在 target/debug/，安装后 externalBin 也在主 exe 旁边
fn locate_sidecar_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let exe_suffix = if cfg!(target_os = "windows") { ".exe" } else { "" };
    // 候选 1：dev 期 cargo build -p kb-mcp 出来的产物（无 triple 后缀）
    let dev_path = dir.join(format!("kb-mcp{}", exe_suffix));
    if dev_path.exists() {
        return Some(dev_path);
    }
    // 候选 2：Tauri externalBin 打包后通常去掉 triple 直接放主 exe 旁边
    // 但少数版本会保留带 triple 的名字，加 fallback
    let triple_path = dir.join(format!("kb-mcp-{}{}", TARGET_TRIPLE, exe_suffix));
    if triple_path.exists() {
        return Some(triple_path);
    }
    None
}

/// tools/list 返回的单条工具描述（裁剪过，前端只需要必要字段）
#[derive(Debug, Serialize)]
pub struct McpToolInfo {
    /// 工具名（如 "search_notes"）
    pub name: String,
    /// 描述（喂给 LLM 用的自然语言说明）
    pub description: Option<String>,
    /// 入参 JSON Schema（前端可用 react-jsonschema-form 自动生成表单）
    pub input_schema: JsonValue,
}

/// 列出 in-memory MCP server 暴露的所有工具（kb-core 的 12 个）
#[tauri::command]
pub async fn mcp_internal_list_tools(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<McpToolInfo>, String> {
    let client = state
        .mcp_internal
        .as_ref()
        .ok_or_else(|| "in-memory MCP server 未就绪（启动初始化失败，详见 log）".to_string())?
        .clone();

    let tools = client
        .list_all_tools()
        .await
        .map_err(|e| format!("list_tools 失败: {e}"))?;

    let infos = tools
        .into_iter()
        .map(|t| McpToolInfo {
            name: t.name.into(),
            description: t.description.map(|d| d.into()),
            // input_schema 是 Arc<JsonObject>，转成 JsonValue 给前端
            input_schema: JsonValue::Object((*t.input_schema).clone()),
        })
        .collect();

    Ok(infos)
}

/// 调用 in-memory MCP server 的工具，返回 LLM 拿到的原始 JSON 字符串
///
/// 前端传 arguments 用 JSON object（serde_json::Value::Object）；
/// 返回 content 列表里的第一个 text block（kb-core 12 工具都返回单段 text）
#[tauri::command]
pub async fn mcp_internal_call_tool(
    state: tauri::State<'_, AppState>,
    name: String,
    arguments: Option<JsonValue>,
) -> Result<String, String> {
    let client = state
        .mcp_internal
        .as_ref()
        .ok_or_else(|| "in-memory MCP server 未就绪".to_string())?
        .clone();

    // arguments 必须是 JsonObject；前端传 null 或 undefined 都映射为 None
    let args_object = match arguments {
        Some(JsonValue::Object(m)) => Some(m),
        Some(JsonValue::Null) | None => None,
        Some(other) => {
            return Err(format!(
                "arguments 必须是 JSON object 或 null，收到: {}",
                other
            ));
        }
    };

    // CallToolRequestParams 是 #[non_exhaustive]，必须用 builder
    let mut req = CallToolRequestParams::new(name.clone());
    if let Some(obj) = args_object {
        req = req.with_arguments(obj);
    }

    let result = client
        .call_tool(req)
        .await
        .map_err(|e| format!("call_tool({name}) 失败: {e}"))?;

    // 把 content 列表里的 text block 拼起来返回（12 工具都是单段 text）
    let mut out = String::new();
    for c in &result.content {
        if let Some(text) = c.as_text() {
            out.push_str(&text.text);
        }
    }
    if result.is_error.unwrap_or(false) {
        return Err(format!("工具返回错误: {out}"));
    }
    Ok(out)
}
