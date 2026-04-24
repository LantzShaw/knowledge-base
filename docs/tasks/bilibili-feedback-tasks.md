# B站视频评论反馈 — 待接入任务

> 来源：B站视频 `BV1xvosBREbr`《扔掉 Obsidian！3MB 的国产本地 AI 知识库，永久免费自带图谱》评论区用户建议
> 创建日期：2026-04-23
> 视频评论总数：244（已抓取 3 条真实用户建议；其余需登录 Cookie 才能抓全）

---

## 🔴 执行规则（继续任务前必读）

**每次要开始某条任务前，必须先走三步：**

1. **重新评估必要性**：此刻这条任务是否仍值得做？优先级是否被新情况改变？
2. **给出实现方案**：
   - 涉及哪些文件（models / database / services / commands / types / api / pages）
   - 具体改什么、新增什么
   - 数据库 schema 是否变更（如变更需写迁移）
   - 需要哪些 Tauri Capabilities / 插件
   - 预计工作量 + 潜在风险点
3. **等待用户确认**后再开始写代码。

⛔ 禁止直接跳过以上三步动手实现。

---

## 任务列表

每条任务有独立编号 (`T-xxx`)，可用 "继续任务 T-001" / "做 T-002" 的形式触发。

### ✅ 必须接入（高价值，成本可控）

---

#### T-001 · 笔记专用提示词库（AI Prompt Library）

- **状态**：`in_progress`  · 开工：2026-04-24
- **来源建议**：喝水小小能手（赞 23）"更多专门针对笔记的提示词"
- **价值**：⭐⭐⭐⭐  成本：低
- **已确认决策**：
  - ✅ 复用 `ai_write_assist` + 新增 `prompt:{id}` 分支
  - ✅ 内置 Prompt 用 DB 存（schema v19 首次写入）
  - ✅ `output_mode` 字段现在就加（replace / append / popup）
- **子任务进度**：
  - [x] 后端：schema v19 迁移 + 7 条内置 Prompt 写入
  - [x] 后端：models（PromptTemplate / PromptTemplateInput）
  - [x] 后端：database/prompt.rs（list/get/create/update/delete/setEnabled + builtin_code 查询）
  - [x] 后端：services/prompt.rs（变量替换器，3 个 unit test 通过）
  - [x] 后端：commands/prompt.rs + lib.rs 注册 6 条 Command
  - [x] 后端：services/ai.rs 改造 `write_assist` — 优先走 DB Prompt，硬编码保留为 fallback
  - [x] 前端：types + lib/api（promptApi）
  - [x] 前端：pages/prompts 管理页（表格 / 新建编辑 Modal / 复制 / 启用开关）
  - [x] 前端：Router + Sidebar（`/prompts` 路由 + "提示词"导航项）
  - [x] 前端：AiWriteMenu 改造（动态拉 prompts / 按 outputMode 预选"追加"或"替换"）
  - [x] `cargo check` 通过 + `npx tsc --noEmit` 通过 + `cargo test --lib services::prompt` 3/3 通过
  - [ ] **待用户手动验证**：启动 `pnpm tauri dev`，在笔记选中文本试各项操作；在 /prompts 新增一个自定义 Prompt 验证

---

#### T-002 · Linux 构建与发行

- **状态**：`completed`（代码维度）· 归档日期：2026-04-24
- **来源建议**：Tonkv "必须要有多端，安卓，linux 都要有"（Linux 部分）
- **价值**：⭐⭐⭐  成本：极低
- **实际发现**：代码配置**早已在前期工作中完成**，无需额外开发：
  - `.github/workflows/release.yml` matrix 含 `ubuntu-22.04 + --bundles deb,appimage`
  - Linux 系统依赖安装步骤齐全（webkit2gtk-4.1 / soup-3.0 / ayatana-appindicator3）
  - `src-tauri/tauri.conf.json` 有 `bundle.linux.deb.depends` + `appimage` 配置
  - `.claude/release-config.json` 和 `release-publish` skill 均已文档化 Linux 发布流程
- **遗留运维项（非代码）**：
  - ⚠️ 首次 Linux CI 尚未真正触发过（`knowledge-base-release/update.json` 还没有 `linux-x86_64` 条目；`releases/v1.1.0/` 下无 Linux 产物）
  - 下次 `/release` 发版会自动跑 Linux CI，按 `release-publish` skill 步骤 7~10 将 Linux 产物复制到 release 仓库 + 上传 R2 + 更新 update.json 即可闭环

---

#### T-003 · 笔记"隐藏"标记（B1 轻量版）

- **状态**：`in_progress`  · 开工：2026-04-24
- **来源建议**：鹏钧九派 "有些文章需要进行加密或者设置一个隐藏，因为存在他人使用电脑的问题"
- **价值**：⭐⭐⭐⭐  成本：中
- **已确认决策**：
  - ✅ 独立路由 `/hidden`（类似 `/trash`），主界面完全看不到隐藏笔记
  - ✅ 标记入口：编辑器顶部按钮；`/hidden` 页"取消隐藏"按钮
  - ✅ 过滤范围：列表/搜索/图谱/反向链接全过滤；wiki link 跳转保留
  - ✅ v1 不加 PIN（留给 T-007 加密）
  - ✅ daily / 模板不支持隐藏
- **子任务进度**：
  - [x] 后端 schema v21：notes.is_hidden + 部分索引（activeonly）
  - [x] 后端 models：Note.is_hidden
  - [x] 后端 database/notes.rs：list_notes 加过滤；8 个 Note 构造位置全部同步新列；新增 list_hidden_notes + set_note_hidden
  - [x] 后端 database/search.rs (全文搜索)、links.rs (search_link_targets / get_backlinks / get_graph_data)、ai.rs (RAG)、tags.rs (list_notes_by_tag) 都加 is_hidden=0 过滤
  - [x] 后端 services/note.rs + commands/notes.rs + lib.rs 注册 set_note_hidden / list_hidden_notes
  - [x] 前端 types.Note.is_hidden + lib/api (noteApi.setHidden + hiddenApi.list)
  - [x] 前端 pages/hidden/index.tsx（列表 + 取消隐藏 + 点标题跳编辑器）
  - [x] 前端编辑器顶部"Eye/EyeOff"按钮 + handleToggleHidden
  - [x] 前端 Router + Sidebar 底部快捷入口"隐藏笔记"
  - [x] cargo check + tsc --noEmit 全通过
  - [ ] **待用户手动验证**：
        1. 编辑器点"隐藏"按钮 → 主列表 / 搜索 / 图谱 / AI 问答都看不到这条
        2. 侧栏"隐藏笔记"入口能看到，点"取消隐藏"后主列表恢复可见
        3. `[[被隐藏笔记标题]]` 仍可点击跳转（弱隐藏设计）

---

#### T-004 · Skills 框架 v1（AI 操作软件）

- **状态**：`in_progress`  · 开工：2026-04-24
- **来源建议**：喝水小小能手（赞 23）"软件内置 skills，让 AI 能够操作软件"
- **价值**：⭐⭐⭐⭐⭐  成本：中
- **已确认决策**：
  - ✅ 仅 OpenAI 兼容协议族（OpenAI/DeepSeek/智谱/Claude 代理）；Ollama 放 v2
  - ✅ v1 只做 5 个只读 skill：search_notes / get_note / list_tags / find_related / get_today_tasks
  - ✅ tool-use 最大轮数 3 轮
  - ✅ UI 内联展示 SkillCall（折叠卡片）
  - ✅ 启用 skills 时默认关 RAG（AI 自己调 search_notes）
  - ✅ SkillCall 持久化到 ai_messages.skill_calls_json（schema v19→v20）
- **子任务进度**：
  - [x] schema v20 迁移 + AiMessage.skill_calls 字段
  - [x] models：SkillCall 定义
  - [x] database/ai.rs：add_ai_message_full + list 携带 skill_calls_json
  - [x] services/skills.rs：5 个只读 skill + tool_schemas + dispatch（4 单元测试通过）
  - [x] services/ai.rs：chat_stream_with_skills + tool_calls delta 累加解析 + 最多 3 轮
  - [x] commands/ai.rs：send_ai_message 加 use_skills 参数
  - [x] 前端：types + api + AI 对话页 Skills 开关 + SkillCallList 折叠卡片 + ai:tool_call 监听
  - [x] `cargo check` 通过 + `npx tsc --noEmit` 通过 + `cargo test services::skills` 4/4 通过
  - [ ] **待用户手动验证**：在 /ai 开启 Skills 开关，问"我最近有什么笔记在讲 Tauri？"测 search_notes；
        再问"今天有什么待办"测 get_today_tasks；验证"工具调用卡片"能展开看 args + result

---

#### T-005 · AI 自动规划今日待办

- **状态**：`in_progress`  · 开工：2026-04-24 · 依赖：T-004 ✅
- **来源建议**：喝水小小能手（赞 23）"AI 可以自动规划今日待办事项"
- **价值**：⭐⭐⭐⭐  成本：低
- **已确认决策**：
  - ✅ 不扩 Skills 框架（写入类走独立"AI 提议 → 用户确认"路径，Skills 保持只读）
  - ✅ 入口同时放 /daily 和 /tasks（Sparkles "AI 规划今日"按钮）
  - ✅ 支持用户输入"今日目标"（可选 textarea）
  - ✅ AI 返回 JSON（`response_format: json_object`）后前端弹 Modal 让用户勾选/编辑/保存
  - ✅ 保存默认 due_date=今天，用户可逐条改；展示 reason；不支持 Ollama
- **子任务进度**：
  - [x] 后端 models：PlanTodayRequest / TaskSuggestion / PlanTodayResponse
  - [x] 后端 services/ai.rs：plan_today（聚合昨/今 daily + 过期任务 + 今日已有 → 非流式 + JSON + markdown 代码块兜底；3 单测通过）
  - [x] 后端 commands/ai.rs：ai_plan_today Command + lib.rs 注册
  - [x] 前端 types + lib/api.aiPlanApi
  - [x] 前端 components/ai/PlanTodayModal.tsx（idle/loading/review 三阶段 + 勾选/编辑/删除/重新生成/批量保存）
  - [x] 前端 daily（仅今日显示）+ tasks 页各加"AI 规划今日"按钮
  - [x] cargo check + tsc + cargo test plan_today 3/3 全通过
  - [ ] **待用户手动验证**：/daily 或 /tasks 点"AI 规划今日" → 填目标（可选）→ 生成 →
        勾选建议 → 保存 → 列表出现新待办

---

### ⚠️ 谨慎接入（价值有但风险/成本偏高）

---

#### T-006 · AI 自动撰写笔记并归档（半自动版）

- **状态**：`in_progress` · 开工 2026-04-24 · 依赖：T-004 ✅ T-005 ✅
- **来源建议**：喝水小小能手（赞 23）"笔记也是 AI 编写并保存在对应目录"
- **价值**：⭐⭐⭐  成本：中
- **已确认决策**：
  - ✅ 侧栏"AI 写笔记"全局按钮 + /notes 列表头按钮（二选一后续再精修）
  - ✅ 仅新建笔记（v1 不支持追加到现有笔记）
  - ✅ 输入：主题 / 参考材料（可选）/ 目标长度（简短·中等·长篇）
  - ✅ AI 拿**扁平化目录路径**（不喂笔记内容，避免过度泄露）→ 返回建议路径
  - ✅ 保存前三栏 Modal：输入 / Markdown 预览 / 目录 + 标题编辑
  - ✅ 一次性 JSON 响应：`{title, content, folderPath, reason}`
  - ✅ 仅 OpenAI 兼容（不支持 Ollama）
  - ✅ 目录不存在时自动递归创建（ensure_folder_path_str）
- **子任务进度**：
  - [x] 后端 models：DraftNoteRequest / DraftNoteResponse / TargetLength
  - [x] 后端 services/ai.rs::draft_note（扁平化目录 + 非流式 JSON + 两轮兜底；3 单测通过）
  - [x] 后端 services/folder.rs::ensure_path（"工作/周报" → folder_id 递归创建）
  - [x] 后端 commands/ai.rs::ai_draft_note + commands/folders.rs::ensure_folder_path + lib.rs 注册
  - [x] 前端 types（DraftNoteRequest / DraftNoteResponse / TargetLength）+ lib/api（aiPlanApi.draftNote + folderApi.ensurePath）
  - [x] 前端 components/ai/DraftNoteModal.tsx（idle / loading / review 三阶段；review 为三栏布局 + Markdown 预览）
  - [x] 前端侧栏全局"✨"按钮入口
  - [x] cargo check + tsc --noEmit + cargo test draft_note 3/3 全通过
  - [ ] **待用户手动验证**：
        1. 侧栏"+ 新建笔记"旁 Sparkles 按钮 → 填主题（如"Rust 所有权"）→ 生成
        2. Modal 三栏显示预览 + 标题/路径/正文可编辑
        3. 点"保存并打开" → 自动跳转到新笔记编辑器，目录被自动创建

---

#### T-007 · 笔记加密（完整版）

- **状态**：`in_progress`（T-007a 后端 + 前端已落地，待用户手动验证）  · 开工：2026-04-23
- **依赖**：T-003 ✅（过滤链路已跑通可复用）
- **来源建议**：鹏钧九派 "有些文章需要进行加密"
- **价值**：⭐⭐⭐⭐  成本：**高（4~7 天，跨多会话）**，建议按 a/b/c 三段拆分

##### 已拟定决策（等用户确认启动）

| # | 决策 | 推荐 |
|---|------|------|
| ① | 加密粒度 | **A2 加密保险库**（一个主密码锁一组笔记，跟 T-003 hidden 的分组思路衔接） |
| ② | 加密层 | **B1 App 层加密**（`notes.content/title` 密文存 DB；不换 SQLCipher） |
| ③ | 算法组合 | **Argon2id（KDF）+ XChaCha20-Poly1305（AEAD）** — 两者都有纯 Rust crate |
| ④ | 忘记密码 | **E1 数据丢失**（UI 强提示 + 首次设置时 3 次二次确认 + 建议导出 Markdown 备份） |
| ⑤ | 加密笔记的搜索/图谱/反链 | v1 **完全排除**（复用 T-003 过滤链路） |

##### 拆分（3 段）

###### T-007a · 核心加密基础设施（2~3 天） — **已完成，待手动验证**
- [x] 后端 `services/crypto.rs`：Argon2id KDF（19456 KiB / 2 iter / 1 par） + AES-256-GCM AEAD 封装；5 个单测通过
  - 注：算法最终落地为 AES-256-GCM（`aes-gcm` crate 已在 WebDAV 流程中使用，减少额外依赖；若后续有审计诉求再切 XChaCha20-Poly1305）
- [x] 后端 `services/vault.rs`：`VaultState`（`Zeroizing<[u8;32]>` 内存 key，不落盘）+ 状态机 `NotSet/Locked/Unlocked` + 1 个单测通过
- [x] schema v23：`notes.is_encrypted INTEGER DEFAULT 0` + `notes.encrypted_blob BLOB` + `idx_notes_encrypted`（部分索引）
- [x] vault 验证器模式：`app_config.vault.salt` + `app_config.vault.verifier`（用常量明文加密的校验串，解锁时再解密验证）
- [x] DAO 改造：所有 8 处 `Note` 构造点加 `is_encrypted` 字段；新增 `enable/disable_note_encryption` / `get/update_encrypted_blob`
- [x] Commands：`vault_status / vault_setup / vault_unlock / vault_lock / encrypt_note / decrypt_note / disable_note_encrypt`（共 7 个，已在 lib.rs 注册）
- [x] 前端 `VaultModal`（setup 三勾选确认 / unlock 单输入）+ `useVaultStatus` hook
- [x] 前端 `types/index.ts` 加 `is_encrypted` 字段 + `VaultStatus` 类型
- [x] 前端 `lib/api/index.ts` 加 `vaultApi`
- [x] 前端编辑器 `editor.tsx` 顶部新增 Lock/Unlock 图标按钮 + `handleToggleEncrypt` 逻辑（vault 未设置 → 拉起 setup Modal；已锁 → 拉起 unlock Modal；已解锁 → 直接加/解密）+ 渲染 `<VaultModal>`
- [x] `npx tsc --noEmit` + `cargo check` 全绿
- [ ] 待用户手动验证：(1) 首次点锁 → 主密码设置流程 → 加密 → 主列表占位符显示；(2) 重启应用验证自动锁；(3) 解锁后能编辑加密笔记

###### T-007b · UI 打磨 + 边界（1~2 天）
- 编辑器顶部"锁/开锁"图标 + 加密状态指示
- `/hidden` 页对加密笔记的特殊标记
- 设置页"更换主密码" / "空闲自动锁定时长"配置
- 导出 Markdown 时对加密笔记的处理（跳过 / 明文导出警告）
- 批量加密现有笔记的 UI 入口（可选）

###### T-007c · 搜索兼容（v2 可选）
解锁态下的加密笔记也能参与搜索：检索时在内存里临时解密，不落盘。
暂缓到 v2，T-007 主版本不做。

##### 风险清单

| 风险 | 缓解 |
|------|------|
| 用户忘记主密码 → 数据永久不可读 | 首次设置时 3 次"我确认会记住，忘了数据丢失"+ 建议导出 Markdown 备份 |
| 内存里的 key 被本地进程扒 | 空闲 N 分钟自动锁定（可配置）；Tauri WebView 隔离一定程度保护 |
| 老用户的"隐藏笔记"是否一键升级为"加密"？ | v1 **不做**自动升级；用户逐条勾选转化 |
| Markdown 导出 / WebDAV 同步 | 导出明文会弹警告；WebDAV 同步保持密文形式（不解密） |

##### 依赖 crate

- `argon2 = "0.5"` — Argon2id 密码派生
- `chacha20poly1305 = "0.10"` — XChaCha20-Poly1305 AEAD
- `zeroize = "1"` — 主密钥在 drop 时清零内存（敏感数据防 swap）
- `rand = "0.8"`（项目已有） — 盐/nonce 生成

---

### 🕳️ 待确认细节（信息不全）

---

#### T-008 · 追问鹏钧九派评论里"以下问题"的具体内容

- **状态**：`pending`
- **来源建议**：鹏钧九派 "有以下问题需要博主后续改善一下"（具体问题没展开）
- **动作**：在 B 站评论区回复一条追问，拿到具体问题清单后再拆任务
- **开工前需确认**：你来回复还是我拟一条回复草稿？

---

### ⛔ 暂不接入（记录理由，避免重复讨论）

---

#### T-X01 · Android 端（Tonkv 建议的"安卓"部分）

- **状态**：`wont_do`
- **理由**：
  - 当前项目定位是"桌面应用"（README、落地页、视频标题都这么说）
  - Tauri 2.x 虽支持移动端，但 SQLite 文件路径 / 权限模型 / UI 断点都要重写
  - 成本超过"新建一个孪生项目"的规模
- **如需重启**：作为独立项目 `knowledge-base-mobile` 立项，而非主仓库内实现

---

## 附录 · 本次抓取的原始评论

### 喝水小小能手（赞 23 · 目前最高赞）
> 基础功能体验了，功能挺丰富的。不过有几点建议，AI时代的笔记知识软件，既然可以接入 agent，那么可以实现更智能的功能，比如 AI 可以自动规划今日待办事项，不需要自己去一个个写，还有笔记也是 AI 编写并保存在对应目录。也就是软件内置 skills，让 AI 能够操作软件，还有更多专门针对笔记的提示词。

→ 拆为 T-001 / T-004 / T-005 / T-006

### 鹏钧九派（赞 1）
> 有以下问题需要博主后续改善一下。另外还有一种场景希望博主改进一下，有些文章需要进行加密或者设置一个隐藏，因为存在他人使用电脑的问题，仅仅是个人建议。

→ 拆为 T-003 / T-007 / T-008

### Tonkv（赞 1）
> 必须要有多端，安卓，linux 都要有

→ 拆为 T-002 / T-X01

---

## 抓取状态

- ✅ 已抓 4 条（1 置顶 + 3 用户建议）
- ❌ 未抓到的 240 条：B 站未登录 API 强制风控，`is_end` 第一页就返回 true
- 🔑 **如需抓全**：提供 B 站登录 Cookie 的 `SESSDATA` 字段即可重跑，跑完清理
