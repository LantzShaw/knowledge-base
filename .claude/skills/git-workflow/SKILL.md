---
name: git-workflow
description: |
  Git 工作流与版本管理技能，规范分支策略、提交信息和发布流程。

  触发场景：
  - 用户需要创建分支或合并代码
  - 用户需要规范提交信息格式
  - 用户需要管理版本发布流程

  触发词：Git、分支、提交、合并、版本发布
---

# Git 工作流与版本管理

## 概述

Tauri Desktop App 的 Git 工作流与版本管理技能，规范分支命名、提交信息格式和发布流程。

---

## 🔴 双远端架构（knowledge_base 项目）

本项目有三个远端（`git remote -v`）：

| remote | 用途 | 定位 |
|--------|------|------|
| **`origin`** | **Gitee (`gitee.com/bkywksj/knowledge-base`)** | **主开发仓库**，承载每一条 commit |
| **`github`** | **GitHub (`github.com/bkywksj/knowledge-base`)** | **开源镜像**，所有 commit 是从 Gitee cherry-pick 过来的 **独立哈希**；两端 **无共同 git 祖先**（首次开源时是用 squash init 建的） |
| `upstream` | 原 tauri 框架模板 | 极少用，仅在同步模板时拉取 |

### 双端关系核心事实

- 两端 commit **subject 一一对应**但 **hash 不同**。举例：
  - Gitee `5cb19ba chore(docs): .docs-meta.json 记录 faq.md 开源状态审计同步`
  - GitHub `5efb7cc chore(docs): .docs-meta.json 记录 faq.md 开源状态审计同步`
- GitHub 上不存在 Gitee 的早期历史（被压缩成一个 `init: v1.1.0 首次开源发布` commit）
- GitHub 上也不存在一些仅开源合规相关的 commit（CLA、docs-meta 同步等）——这些是 GitHub 侧独立做的

### 同步点识别法

想把 Gitee 新改动同步到 GitHub？按 subject 匹配找同步边界：

```bash
# 1. 取 GitHub 最新 commit 的 subject
git log -1 --format='%s' github/master

# 2. 在 Gitee 分支里搜同 subject 的 commit（这就是两端对齐的最后一点）
git log --oneline -n 1 origin/master --grep='<上一步的 subject 关键词>'
# 得到 Gitee 端对应 hash，记为 SYNC_POINT

# 3. 列出 Gitee 上 SYNC_POINT 之后的所有增量
git log --oneline --reverse <SYNC_POINT>..HEAD
```

---

## 🔴 提交推送规则（knowledge_base 项目）

### 「日常 commit」— 用户说"提交推送"时

**默认只推 Gitee**：
```bash
git push origin master
```

GitHub 不自动同步。但用户可随时要求把"Gitee 上 SYNC_POINT 之后的增量"推 GitHub。

### 「同步 GitHub」— 把积压增量批量推到 GitHub

**推荐：worktree + 分支 + batch cherry-pick（实测零冲突比单条更顺）**

```bash
# 1. 在项目外新建 worktree，基于 github/master 开同步分支
git worktree add ../knowledge_base_gh_test github/master
cd ../knowledge_base_gh_test
git checkout -b gh-sync

# 2. 批量 cherry-pick Gitee 的增量（按时间序）
#    注：在 worktree 里主仓的 master 分支名可直接引用
git cherry-pick <SYNC_POINT>..master

# 3. 遇到冲突按下方"冲突处理"章节操作；全部 pick 完后验证
git diff master HEAD --stat   # 应当为空：内容 ≡ Gitee HEAD

# 4. 推 GitHub（推送分支 → master）
git push github gh-sync:master

# 5. 清理
cd <主仓目录>
git worktree remove --force ../knowledge_base_gh_test
```

**不推荐：单条 cherry-pick**。单条 patch 的 diff 锚点常常依赖"前面几条 commit 的产物"，单独应用容易冲突；批量顺序应用反而 clean。

### 冲突处理

- **schema.rs 冲突**：一般是版本号对不上（比如 GitHub 还在 v17，新增 v19 patch 上下文找不到 `17 =>` 分支行）。解决办法：cherry-pick 时 3-way merge 会把缺失的迁移函数（如 `migrate_v17_to_v18`）作为新增代码整段带过来，手动合并时选择保留两侧所有 match 分支 + 所有迁移函数即可。
- **Sidebar.tsx / 大幅改动的共享文件冲突**：**不要**用 `git checkout --theirs`（会整体替换为 Gitee 版，引入 GitHub 侧不存在的组件/类型依赖），而是基于 GitHub 原版手动加 T-001 真正改动的那几小行。

### 「发布版本」— 调 /release 时

仍然走下方"发布流程"章节的标准流程；CI 会自动处理 GitHub 产物。

### ⛔ 绝对禁止

1. 禁止 `git push --force github master`（用 Gitee 历史覆盖 GitHub），会毁掉 GitHub 侧独立 commit
2. 禁止 `git merge github/master` 到本地（无共同祖先的 merge 产生污染的合并图）
3. 推 GitHub 只能通过"cherry-pick 增量"路径，不能直推本地 master（本地 master 带整条 Gitee 历史）

---

## 分支策略

### 分支命名规范

| 分支类型 | 命名格式 | 示例 |
|---------|---------|------|
| 主分支 | `master` / `main` | `master` |
| 开发分支 | `dev` | `dev` |
| 功能分支 | `feature/{功能名}` | `feature/file-manager` |
| 修复分支 | `fix/{问题描述}` | `fix/window-resize-crash` |
| 发布分支 | `release/v{版本}` | `release/v0.2.0` |

---

## 提交信息规范

### Conventional Commits

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Type 定义

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(rust): 添加文件读写 Command` |
| `fix` | 修复 Bug | `fix(react): 修复状态更新不生效` |
| `refactor` | 重构 | `refactor(rust): 重构错误处理为 thiserror` |
| `docs` | 文档 | `docs: 更新 README` |
| `style` | 格式 | `style(rust): cargo fmt 格式化` |
| `test` | 测试 | `test(rust): 添加 Command 单元测试` |
| `chore` | 杂务 | `chore: 更新 Cargo.toml 依赖` |
| `build` | 构建 | `build: 配置 Tauri 打包参数` |

### Scope 建议

| Scope | 说明 |
|-------|------|
| `rust` | Rust 后端代码 |
| `react` | React 前端代码 |
| `tauri` | Tauri 配置 (tauri.conf.json) |
| `caps` | Capabilities 权限配置 |
| `deps` | 依赖更新 |

---

## 发布流程（CI 全自动模式）

> 项目已配置 GitHub Actions CI，**本地不需要执行 `pnpm tauri build`**。
> 使用 `/release` 命令可自动完成全部发布流程。

```
1. 更新版本号（三处同步）
   - package.json: version
   - src-tauri/Cargo.toml: version
   - src-tauri/tauri.conf.json: version
2. 更新 release 仓库 README.md（下载链接 + 版本历史）
3. 提交并推送 release 仓库 README 变更
4. 提交源码仓库 + 推送到 GitHub
5. 打 Git Tag（v*.*.* 格式）并推送
   → 自动触发 GitHub Actions CI
   → CI 构建 Windows/macOS/Linux 三平台安装包
   → CI 自动推送产物 + update.json 到 release 仓库
```

### 快速发布

```bash
# 使用 /release 命令一键发布
/release
```

### 手动发布（备用）

```bash
# 1. 更新版本号后提交
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
git commit -m "release: vX.Y.Z"

# 2. 推送到 GitHub
git push <github_remote> <主分支>

# 3. 打 Tag 触发 CI
git tag vX.Y.Z
git push <github_remote> vX.Y.Z
```

---

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 直接在 master 上开发 | 创建功能分支开发 |
| 提交信息写"修改代码" | 按 Conventional Commits 规范编写 |
| 版本号只改 package.json | 同步修改 Cargo.toml 和 tauri.conf.json |
| 提交 target/ 编译产物 | 确保 .gitignore 正确配置 |
