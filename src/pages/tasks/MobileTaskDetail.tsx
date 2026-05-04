import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Trash2,
  Plus,
  Check,
  Clock,
  Bell,
  Repeat,
  Folder,
  Flag,
} from "lucide-react";
import { Modal, message } from "antd";
import { taskApi } from "@/lib/api";
import { useAppStore } from "@/store";
import type { Task } from "@/types";

/**
 * 移动端任务详情页（设计稿：12-task-edit.html）
 *
 * 路由 /task-detail/:id —— 移动端专用，独立顶层路由（沉浸式）
 *
 * 核心功能：
 * - 顶栏：返回 + 标题/保存状态 + 删除按钮（带确认）
 * - 主体：勾选 + 标题（input）+ 备注（textarea）
 * - 子任务：列表 + 勾选 + 添加新子任务（弹 prompt）
 * - 元数据行（暂只读）：截止时间 / 提醒 / 重复 / 分类 / 优先级
 * - 底部：推迟（snooze 30 分钟）/ 完成（toggleStatus）
 *
 * 自动保存：标题/备注 1.2s debounce 调 update。
 *
 * MVP 不做：
 * - 截止时间 / 提醒 / 重复 / 分类 完整编辑（点击只 toast「待开发」）
 * - 关联笔记 / 时间线
 * - 子任务拖拽排序
 */

const AUTOSAVE_DELAY_MS = 1200;
const SAVED_TOAST_MS = 2500;

type SaveStatus = "idle" | "dirty" | "saving" | "saved";

const PRIORITY_LABELS = ["紧急", "高", "中", "低"];

export function MobileTaskDetail() {
  const navigate = useNavigate();
  const { id: idParam } = useParams<{ id: string }>();
  const taskId = Number(idParam);

  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [snoozing, setSnoozing] = useState(false);

  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savedHideTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!taskId || Number.isNaN(taskId)) return;
    try {
      const [t, subs] = await Promise.all([
        taskApi.get(taskId),
        taskApi.listSubtasks(taskId).catch(() => [] as Task[]),
      ]);
      setTask(t);
      setTitle(t.title);
      setDescription(t.description ?? "");
      setSubtasks(subs);
      dirtyRef.current = false;
      setStatus("idle");
    } catch (e) {
      message.error(`加载失败: ${e}`);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doSave = useCallback(async () => {
    if (!task || !dirtyRef.current) return;
    setStatus("saving");
    try {
      await taskApi.update(task.id, {
        title,
        description: description || null,
      });
      dirtyRef.current = false;
      setStatus("saved");
      if (savedHideTimerRef.current) {
        window.clearTimeout(savedHideTimerRef.current);
      }
      savedHideTimerRef.current = window.setTimeout(() => {
        setStatus((s) => (s === "saved" ? "idle" : s));
      }, SAVED_TOAST_MS);
    } catch (e) {
      message.error(`保存失败: ${e}`);
      setStatus("idle");
    }
  }, [task, title, description]);

  function scheduleSave() {
    dirtyRef.current = true;
    setStatus("dirty");
    if (savedHideTimerRef.current) {
      window.clearTimeout(savedHideTimerRef.current);
      savedHideTimerRef.current = null;
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DELAY_MS);
  }

  async function flushAndExit() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (dirtyRef.current) await doSave();
    useAppStore.getState().refreshTaskStats();
    navigate(-1);
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (savedHideTimerRef.current)
        window.clearTimeout(savedHideTimerRef.current);
      if (dirtyRef.current) {
        void doSave().then(() => {
          useAppStore.getState().refreshTaskStats();
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleSelf() {
    if (!task) return;
    try {
      await taskApi.toggleStatus(task.id);
      await load();
      useAppStore.getState().refreshTaskStats();
    } catch (e) {
      message.error(`切换失败: ${e}`);
    }
  }

  async function toggleSubtask(sub: Task) {
    try {
      await taskApi.toggleStatus(sub.id);
      const subs = await taskApi.listSubtasks(taskId);
      setSubtasks(subs);
    } catch (e) {
      message.error(`切换失败: ${e}`);
    }
  }

  async function addSubtask() {
    const t = window.prompt("子任务标题");
    if (!t?.trim() || !task) return;
    try {
      await taskApi.create({
        title: t.trim(),
        parent_task_id: task.id,
      });
      const subs = await taskApi.listSubtasks(taskId);
      setSubtasks(subs);
    } catch (e) {
      message.error(`添加失败: ${e}`);
    }
  }

  async function snooze() {
    if (!task || snoozing) return;
    setSnoozing(true);
    try {
      await taskApi.snooze(task.id, 30);
      message.success("已推迟 30 分钟");
      await load();
    } catch (e) {
      message.error(`推迟失败: ${e}`);
    } finally {
      setSnoozing(false);
    }
  }

  function deleteTask() {
    if (!task) return;
    Modal.confirm({
      title: `删除任务「${task.title || "未命名"}」？`,
      content: "此操作不可撤销。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await taskApi.delete(task.id);
          message.success("已删除");
          useAppStore.getState().refreshTaskStats();
          navigate(-1);
        } catch (e) {
          message.error(`删除失败: ${e}`);
        }
      },
    });
  }

  if (Number.isNaN(taskId)) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">任务 ID 无效</div>
    );
  }

  const dueLabel = task?.due_date
    ? new Date(task.due_date).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未设置";
  const overdue =
    task?.due_date &&
    new Date(task.due_date).getTime() < Date.now() &&
    task.status === 0;

  const completedSubs = subtasks.filter((s) => s.status === 1).length;
  const isDone = task?.status === 1;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-50"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/* 顶栏 */}
      <header className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-2 shrink-0">
        <button
          onClick={() => void flushAndExit()}
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center"
        >
          <ChevronLeft size={24} className="text-slate-700" />
        </button>
        <div className="flex flex-col items-center min-w-0 flex-1 leading-tight">
          <span className="text-sm font-semibold text-slate-900">任务详情</span>
          <SaveBadge status={status} />
        </div>
        <button
          onClick={deleteTask}
          aria-label="删除"
          className="flex h-10 w-10 items-center justify-center"
        >
          <Trash2 size={20} className="text-red-500" />
        </button>
      </header>

      {/* 主体 */}
      <main className="flex-1 overflow-y-auto pb-4">
        {/* 标题 + 备注 */}
        <div className="border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex items-start gap-3">
            <button
              onClick={toggleSelf}
              aria-label={isDone ? "标记未完成" : "标记完成"}
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 ${
                isDone
                  ? "border-[#1677FF] bg-[#1677FF] text-white"
                  : "border-slate-300"
              }`}
            >
              {isDone && <Check size={14} />}
            </button>
            <div className="min-w-0 flex-1">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  scheduleSave();
                }}
                placeholder="任务标题"
                className={`w-full bg-transparent text-lg font-semibold outline-none placeholder:text-slate-300 ${
                  isDone ? "text-slate-400 line-through" : "text-slate-900"
                }`}
              />
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  scheduleSave();
                }}
                placeholder="备注…"
                rows={2}
                className="mt-1 w-full resize-none bg-transparent text-sm text-slate-500 outline-none placeholder:text-slate-300"
              />
            </div>
          </div>
        </div>

        {/* 子任务 */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-400">
            <span>
              子任务 · {completedSubs}/{subtasks.length}
            </span>
            <button
              onClick={addSubtask}
              className="flex items-center gap-0.5 text-[#1677FF]"
            >
              <Plus size={12} /> 添加
            </button>
          </div>
          {subtasks.length === 0 ? (
            <div className="rounded-2xl bg-white py-6 text-center text-xs text-slate-400 shadow-sm">
              还没有子任务
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl bg-white">
              {subtasks.map((sub) => {
                const subDone = sub.status === 1;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={subDone}
                      onChange={() => toggleSubtask(sub)}
                      className="h-4 w-4 rounded"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        subDone ? "text-slate-400 line-through" : "text-slate-700"
                      }`}
                    >
                      {sub.title}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 元属性（暂只读） */}
        <div className="px-4 py-2">
          <div className="divide-y divide-slate-100 rounded-2xl bg-white">
            <MetaRow
              icon={<Clock size={18} className="text-red-500" />}
              label="截止时间"
              value={
                <span
                  className={
                    overdue
                      ? "text-xs font-medium text-red-500"
                      : "text-xs text-slate-500"
                  }
                >
                  {overdue ? "⏰ 已逾期 " : ""}
                  {dueLabel}
                </span>
              }
              onClick={() => message.info("移动端日期选择器待开发")}
            />
            <MetaRow
              icon={<Bell size={18} className="text-amber-500" />}
              label="提醒"
              value={
                <span className="text-xs text-slate-500">
                  {task?.remind_before_minutes
                    ? `提前 ${task.remind_before_minutes} 分钟`
                    : "不提醒"}
                </span>
              }
              onClick={() => message.info("提醒设置待开发")}
            />
            <MetaRow
              icon={<Repeat size={18} className="text-blue-500" />}
              label="重复"
              value={
                <span className="text-xs text-slate-400">
                  {task?.repeat_kind && task.repeat_kind !== "none"
                    ? task.repeat_kind
                    : "不重复"}
                </span>
              }
              onClick={() => message.info("重复规则待开发")}
            />
            <MetaRow
              icon={<Folder size={18} className="text-orange-500" />}
              label="分类"
              value={<span className="text-xs text-slate-400">未分类</span>}
              onClick={() => message.info("分类选择待开发")}
            />
            <MetaRow
              icon={<Flag size={18} className="text-red-500" />}
              label="优先级"
              value={
                <span className="text-xs text-slate-500">
                  {PRIORITY_LABELS[task?.priority ?? 2] ?? "中"}
                </span>
              }
              onClick={() => message.info("优先级编辑待开发")}
            />
          </div>
        </div>

        {/* 元信息 */}
        {task && (
          <div className="px-4 py-2 text-center text-[11px] text-slate-400">
            创建于 {new Date(task.created_at).toLocaleString("zh-CN")}
            {task.completed_at && (
              <>
                <br />完成于 {new Date(task.completed_at).toLocaleString("zh-CN")}
              </>
            )}
          </div>
        )}
      </main>

      {/* 底部操作栏 */}
      <footer
        className="border-t border-slate-200 bg-white px-4 py-3 shrink-0"
        style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex gap-2">
          <button
            onClick={snooze}
            disabled={snoozing}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-slate-100 text-sm font-medium text-slate-700 active:bg-slate-200 disabled:opacity-50"
          >
            推迟 30 分钟
          </button>
          <button
            onClick={toggleSelf}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-[#1677FF] text-sm font-medium text-white active:scale-95 transition-transform"
          >
            {isDone ? "标记未完成" : "完成"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function MetaRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 active:bg-slate-50"
    >
      {icon}
      <span className="flex-1 text-left text-sm text-slate-800">{label}</span>
      {value}
    </button>
  );
}

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === "saving")
    return <span className="mt-0.5 text-[10px] text-orange-600">保存中…</span>;
  if (status === "saved")
    return (
      <span className="mt-0.5 text-[10px] text-green-600">已保存 · 刚刚</span>
    );
  return <span className="mt-0.5 h-3.5 text-[10px]" aria-hidden />;
}
