//! T-013 自定义数据目录
//!
//! ## 启动期解析优先级
//!
//! 1. 环境变量 `KB_DATA_DIR`（最高优先级；CI / 命令行 / 多版本测试用）
//! 2. 指针文件 `<framework_app_data_dir>/data_dir.txt`（用户在 UI 改路径时写入）
//! 3. 默认 `<framework_app_data_dir>`（兼容旧用户）
//!
//! ## 设计要点
//!
//! - **指针文件本身永远在 framework 默认 app_data_dir**：因为这是 OS 提供的固定位置，
//!   只有这样换数据目录后下次启动才知道去哪找用户的自定义路径
//! - **单实例锁仍在 framework app_data_dir**：换数据目录不应突破单例约束
//! - **用户的"自定义路径"是数据存储根**（db / 资产 / 多开实例子目录都基于此）
//! - **不自动迁移老数据**：v1 让用户手动复制旧 `app.db + kb_assets/`，UI 给清晰指引
//! - **重启生效**：set_pending 只写指针文件，不动当前进程的 db 连接，避免连接竞态

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

/// 指针文件名（位于 framework app_data_dir 内）
pub const POINTER_FILE: &str = "data_dir.txt";

/// 自定义路径来源
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DataDirSource {
    /// 环境变量 KB_DATA_DIR 优先生效
    Env,
    /// 指针文件 data_dir.txt 生效
    Pointer,
    /// 没有自定义；用框架默认 app_data_dir
    Default,
}

/// 数据目录解析结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDataDir {
    /// 框架默认 app_data_dir（OS 给的固定位置）
    pub default_dir: String,
    /// 当前生效的数据根目录
    pub current_dir: String,
    /// 来源
    pub source: DataDirSource,
    /// 指针文件里写的路径（可能与 current_dir 不一致，比如被 env 覆盖；为空表示无指针）
    pub pending_dir: Option<String>,
}

pub struct DataDirResolver;

impl DataDirResolver {
    /// 启动早期调用：把"逻辑数据根目录"算出来
    ///
    /// 注意 `default_app_data_dir` 必须是框架的 `app.path().app_data_dir()`，
    /// 而**不是**已经被 instance-N 叠加过的实例目录。
    pub fn resolve(default_app_data_dir: &Path) -> Result<ResolvedDataDir, AppError> {
        let default_str = default_app_data_dir.to_string_lossy().to_string();

        // 1. env var 最高优先级
        if let Ok(p) = std::env::var("KB_DATA_DIR") {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                let path = PathBuf::from(trimmed);
                std::fs::create_dir_all(&path)?;
                let current = path.to_string_lossy().to_string();
                let pending = read_pointer(default_app_data_dir).ok().flatten();
                return Ok(ResolvedDataDir {
                    default_dir: default_str,
                    current_dir: current,
                    source: DataDirSource::Env,
                    pending_dir: pending,
                });
            }
        }

        // 2. 指针文件
        if let Some(target) = read_pointer(default_app_data_dir)? {
            let path = PathBuf::from(&target);
            std::fs::create_dir_all(&path)?;
            return Ok(ResolvedDataDir {
                default_dir: default_str.clone(),
                current_dir: target.clone(),
                source: DataDirSource::Pointer,
                pending_dir: Some(target),
            });
        }

        // 3. 默认
        Ok(ResolvedDataDir {
            default_dir: default_str.clone(),
            current_dir: default_str,
            source: DataDirSource::Default,
            pending_dir: None,
        })
    }

    /// 用户在 UI 里"修改数据目录"时调
    /// - 仅写指针文件 + 创建目标目录
    /// - 不动当前进程的 db / 资产，避免运行时切换的连接竞态
    /// - 下次启动才生效（前端 UI 提示用户重启）
    pub fn set_pending(
        default_app_data_dir: &Path,
        new_path: &str,
    ) -> Result<(), AppError> {
        let trimmed = new_path.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("路径不能为空".into()));
        }
        let new_path_buf = PathBuf::from(trimmed);
        if !new_path_buf.is_absolute() {
            return Err(AppError::InvalidInput(
                "请提供绝对路径（如 D:\\MyKB\\ 或 /Users/me/kb/）".into(),
            ));
        }
        // 创建目录（已存在 OK）
        std::fs::create_dir_all(&new_path_buf)?;
        // 探针：写一个临时文件测试可写
        let probe = new_path_buf.join(".kb_data_dir_writable_test");
        std::fs::write(&probe, b"ok").map_err(|e| {
            AppError::Custom(format!(
                "目标目录不可写: {} ({})",
                new_path_buf.display(),
                e
            ))
        })?;
        let _ = std::fs::remove_file(&probe);

        // 原子写指针文件：先写 .tmp 再 rename
        let pointer = default_app_data_dir.join(POINTER_FILE);
        if let Some(parent) = pointer.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = default_app_data_dir.join(format!("{}.tmp", POINTER_FILE));
        std::fs::write(&tmp, trimmed.as_bytes())?;
        // Windows 上 rename 到已存在文件会失败；先删
        if pointer.exists() {
            let _ = std::fs::remove_file(&pointer);
        }
        std::fs::rename(&tmp, &pointer)?;
        log::info!("[data_dir] 已写入新指针: {}（重启生效）", trimmed);
        Ok(())
    }

    /// 清除指针 → 下次启动恢复默认
    pub fn clear_pending(default_app_data_dir: &Path) -> Result<(), AppError> {
        let pointer = default_app_data_dir.join(POINTER_FILE);
        if pointer.exists() {
            std::fs::remove_file(&pointer)?;
            log::info!("[data_dir] 已清除指针文件，重启后回到默认目录");
        }
        Ok(())
    }
}

/// 读指针文件；不存在返回 Ok(None)；空白内容也视为 None
fn read_pointer(default_app_data_dir: &Path) -> Result<Option<String>, AppError> {
    let pointer = default_app_data_dir.join(POINTER_FILE);
    if !pointer.exists() {
        return Ok(None);
    }
    let s = std::fs::read_to_string(&pointer)?
        .trim()
        .to_string();
    if s.is_empty() {
        return Ok(None);
    }
    Ok(Some(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_app_data() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "kb_data_dir_test_{}_{}",
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_default_when_no_pointer() {
        let app_data = temp_app_data();
        // 清环境变量避免污染
        std::env::remove_var("KB_DATA_DIR");
        let r = DataDirResolver::resolve(&app_data).unwrap();
        assert_eq!(r.source, DataDirSource::Default);
        assert_eq!(r.current_dir, app_data.to_string_lossy());
        assert!(r.pending_dir.is_none());
    }

    #[test]
    fn set_pending_then_resolve_uses_pointer() {
        let app_data = temp_app_data();
        let target = temp_app_data().join("custom-target");
        std::env::remove_var("KB_DATA_DIR");

        DataDirResolver::set_pending(&app_data, target.to_str().unwrap()).unwrap();
        let r = DataDirResolver::resolve(&app_data).unwrap();
        assert_eq!(r.source, DataDirSource::Pointer);
        assert_eq!(r.current_dir, target.to_string_lossy());
        assert_eq!(r.pending_dir.as_deref(), Some(target.to_str().unwrap()));
    }

    #[test]
    fn clear_pending_restores_default() {
        let app_data = temp_app_data();
        let target = temp_app_data().join("will-be-cleared");
        std::env::remove_var("KB_DATA_DIR");

        DataDirResolver::set_pending(&app_data, target.to_str().unwrap()).unwrap();
        DataDirResolver::clear_pending(&app_data).unwrap();

        let r = DataDirResolver::resolve(&app_data).unwrap();
        assert_eq!(r.source, DataDirSource::Default);
        assert!(r.pending_dir.is_none());
    }

    #[test]
    fn set_pending_rejects_relative_path() {
        let app_data = temp_app_data();
        let r = DataDirResolver::set_pending(&app_data, "relative/path");
        assert!(r.is_err());
    }

    #[test]
    fn set_pending_rejects_empty() {
        let app_data = temp_app_data();
        assert!(DataDirResolver::set_pending(&app_data, "").is_err());
        assert!(DataDirResolver::set_pending(&app_data, "   ").is_err());
    }

    // 注意：env 变量测试单独跑（otherwise 会干扰其他测试），这里用 #[ignore] 标记，需要时手动跑
    #[test]
    #[ignore = "env var test, run with --ignored"]
    fn env_var_overrides_pointer() {
        let app_data = temp_app_data();
        let target_pointer = temp_app_data().join("from-pointer");
        let target_env = temp_app_data().join("from-env");

        DataDirResolver::set_pending(&app_data, target_pointer.to_str().unwrap()).unwrap();
        std::env::set_var("KB_DATA_DIR", target_env.to_str().unwrap());

        let r = DataDirResolver::resolve(&app_data).unwrap();
        assert_eq!(r.source, DataDirSource::Env);
        assert_eq!(r.current_dir, target_env.to_string_lossy());
        // pending_dir 仍报告指针文件里的内容（让 UI 能展示"环境变量临时覆盖了你的设置"）
        assert_eq!(
            r.pending_dir.as_deref(),
            Some(target_pointer.to_str().unwrap())
        );

        std::env::remove_var("KB_DATA_DIR");
    }
}
