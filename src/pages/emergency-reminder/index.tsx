import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Spin, Tag } from "antd";
import { AlertOctagon, Bell, BellOff, Check, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { taskApi } from "@/lib/api";
import type { Task } from "@/types";
import { startBeepLoop } from "@/lib/audio/beep";

/**
 * 紧急待办「全屏接管」窗口的承载页面。
 *
 * 进入条件：后端 task_reminder 检测到 priority==0 任务到点 → 创建 label=emergency-{id}
 * 的最大化 + 无边框 + always-on-top 窗口指向本路由。
 *
 * 行为：
 * - 自动启动循环蜂鸣（页面挂载即响，用户没交互过的也会响 —— 因为这是新打开的窗口
 *   主动 focus 拿权了，浏览器 autoplay 策略对 Tauri WebView 通常不严格）
 * - 用户点任意按钮 / 关闭页面 → 停铃 + 关窗
 * - 关窗刻意走 closeSelf，而不是 hide：让 Rust 侧的 label 释放，下次同任务可重开
 */
export default function EmergencyReminderPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = id ? Number(id) : NaN;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const stopBeepRef = useRef<(() => void) | null>(null);

  // 拉任务详情
  useEffect(() => {
    if (!Number.isFinite(taskId)) {
      setErrorText("无效的任务 ID");
      setLoading(false);
      return;
    }
    let cancelled = false;
    taskApi
      .get(taskId)
      .then((t) => {
        if (cancelled) return;
        setTask(t);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorText(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // 启动循环铃（任务加载后再响，避免铃响但页面空白显得诡异）
  useEffect(() => {
    if (!task || muted) return;
    const stop = startBeepLoop(1500);
    stopBeepRef.current = stop;
    return () => {
      stop();
      stopBeepRef.current = null;
    };
  }, [task, muted]);

  // 关窗前确保停铃
  useEffect(() => {
    return () => {
      stopBeepRef.current?.();
    };
  }, []);

  async function closeSelf() {
    stopBeepRef.current?.();
    try {
      await getCurrentWindow().close();
    } catch {
      // 关闭失败也别再轰炸用户
    }
  }

  async function handleSnooze(minutes: number) {
    if (!task) return;
    try {
      await taskApi.snooze(task.id, minutes);
    } finally {
      await closeSelf();
    }
  }

  async function handleComplete() {
    if (!task) return;
    try {
      await taskApi.completeOccurrence(task.id);
    } finally {
      await closeSelf();
    }
  }

  async function handleEndSeries() {
    if (!task) return;
    try {
      await taskApi.toggleStatus(task.id);
    } finally {
      await closeSelf();
    }
  }

  const isRepeating = !!task && task.repeat_kind !== "none";

  // 根据当前时间和 due_date 计算是否已逾期，用于头部文案
  const overdueText = useMemo(() => {
    if (!task?.due_date) return null;
    const dueMs = parseDueMs(task.due_date);
    if (Number.isNaN(dueMs)) return null;
    const diffMin = Math.round((Date.now() - dueMs) / 60000);
    if (diffMin > 0) {
      return `已逾期 ${formatMinutes(diffMin)}`;
    }
    if (diffMin > -60) {
      return `${Math.abs(diffMin)} 分钟内到期`;
    }
    return null;
  }, [task]);

  return (
    <div
      data-tauri-drag-region
      className="emergency-reminder-root flex h-screen w-screen items-center justify-center"
      style={{
        background:
          "radial-gradient(circle at 30% 20%, rgba(220,38,38,0.35) 0%, rgba(15,23,42,0.92) 60%, rgba(2,6,23,0.98) 100%)",
        color: "#fff",
        userSelect: "none",
      }}
    >
      <button
        onClick={closeSelf}
        title="关闭"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.18)",
          cursor: "pointer",
        }}
      >
        <X size={18} />
      </button>

      <button
        onClick={() => setMuted((m) => !m)}
        title={muted ? "恢复响铃" : "静音"}
        className="absolute right-16 top-4 flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.18)",
          cursor: "pointer",
        }}
      >
        {muted ? <BellOff size={18} /> : <Bell size={18} />}
      </button>

      <div
        className="flex w-full max-w-3xl flex-col gap-6 rounded-2xl px-12 py-10"
        style={{
          background: "rgba(15,23,42,0.78)",
          border: "1px solid rgba(248,113,113,0.45)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(248,113,113,0.15)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-3" style={{ color: "#fca5a5" }}>
          <AlertOctagon size={28} />
          <span style={{ fontSize: 20, letterSpacing: 2, fontWeight: 600 }}>
            紧急待办提醒
          </span>
          {overdueText && (
            <Tag color="red" style={{ fontSize: 13, padding: "2px 10px" }}>
              {overdueText}
            </Tag>
          )}
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : errorText ? (
          <div style={{ color: "#fca5a5", fontSize: 16 }}>
            加载任务失败：{errorText}
          </div>
        ) : task ? (
          <>
            <div className="flex flex-col gap-3">
              <div
                style={{
                  fontSize: 36,
                  lineHeight: 1.2,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {task.title}
              </div>
              <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 14 }}>
                <Tag color="red">紧急</Tag>
                {task.important && <Tag color="gold">重要</Tag>}
                {isRepeating && <Tag color="blue">{describeRepeat(task)}</Tag>}
                {task.due_date && (
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>
                    截止 {task.due_date}
                  </span>
                )}
              </div>
              {task.description && (
                <div
                  style={{
                    fontSize: 15,
                    color: "rgba(255,255,255,0.78)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {task.description}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                  推迟提醒
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => handleSnooze(5)}>5 分钟</Button>
                  <Button onClick={() => handleSnooze(15)}>15 分钟</Button>
                  <Button onClick={() => handleSnooze(60)}>1 小时</Button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                {isRepeating && (
                  <Button danger size="large" onClick={handleEndSeries}>
                    结束循环
                  </Button>
                )}
                <Button
                  type="primary"
                  size="large"
                  icon={<Check size={16} />}
                  onClick={handleComplete}
                  style={{ minWidth: 160, height: 44, fontSize: 16 }}
                >
                  {isRepeating ? "完成本次" : "标记完成"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function parseDueMs(due: string): number {
  // 后端约定：'YYYY-MM-DD' 视作当天 23:59:59；'YYYY-MM-DD HH:MM:SS' 精确到秒
  const compact = due.length === 10 ? `${due} 23:59:59` : due;
  // 走本地时区解析（与 chrono::Local 对齐）
  return new Date(compact.replace(" ", "T")).getTime();
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} 分钟`;
  if (m < 1440) return `${Math.round(m / 60)} 小时`;
  return `${Math.round(m / 1440)} 天`;
}

const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function describeRepeat(task: Task): string {
  const { repeat_kind, repeat_interval, repeat_weekdays } = task;
  if (repeat_kind === "none") return "";
  const iv = Math.max(1, repeat_interval);
  if (repeat_kind === "daily") return iv === 1 ? "每天" : `每 ${iv} 天`;
  if (repeat_kind === "monthly") return iv === 1 ? "每月" : `每 ${iv} 月`;
  if (repeat_weekdays) {
    const days = repeat_weekdays
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 7)
      .sort((a, b) => a - b);
    if (days.length === 5 && days.join(",") === "1,2,3,4,5") return "工作日";
    return days.map((d) => WEEKDAY_LABELS[d]).join("/");
  }
  return iv === 1 ? "每周" : `每 ${iv} 周`;
}
