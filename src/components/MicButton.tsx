/**
 * 通用语音输入按钮。
 *
 * 状态机：
 *   idle ─point→ recording ─point→ transcribing ─done→ idle
 *
 * 一次完整流程：
 *   1. 首次点击：getUserMedia 拿麦克风权限，启动 MediaRecorder
 *   2. 二次点击：stop()，合并 chunks → blob → base64
 *   3. 调 asrApi.transcribe()，把识别出的文字回调给调用方
 *
 * 调用方只关心 `onTranscribed(text)` 拿文字怎么用（追加 / 替换都行）。
 * 组件挂载时读一次 ASR 配置：未启用 = 灰按钮 + tooltip 引导去设置页。
 *
 * 关于 MIME：Windows WebView2 / Chromium 默认录 webm/opus；DashScope qwen-asr
 * 文档列出的格式不含 webm，但实测对 webm/opus 也兼容（Chrome MediaRecorder 通用容器）。
 * 若实测失败，下一步加 mp3 转码 fallback；此处先按原始格式上传。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Tooltip, App as AntdApp } from "antd";
import { Mic, Square, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { asrApi } from "@/lib/api";

type Status = "idle" | "recording" | "transcribing" | "disabled";

interface Props {
  /** 转写完成回调；text 已 trim */
  onTranscribed: (text: string) => void;
  /** 按钮尺寸（与 antd Button.size 对齐） */
  size?: "small" | "middle" | "large";
  /** 自定义 tooltip 文案（可选，默认根据状态自动） */
  tooltip?: string;
  /** 语言提示（zh / en / auto），缺省 auto */
  language?: string;
  /** 受控 disabled（外部因业务原因强制禁用） */
  disabled?: boolean;
  className?: string;
}

export function MicButton({
  onTranscribed,
  size = "small",
  tooltip,
  language,
  disabled,
  className,
}: Props) {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState<boolean>(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 启动时拉一次 ASR 配置；后续可以监听 store 变更，但配置改动通常要重启录音组件，先不做
  useEffect(() => {
    let cancelled = false;
    asrApi
      .getConfig()
      .then((cfg) => {
        if (!cancelled) setEnabled(cfg.enabled && cfg.apiKey.trim().length > 0);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 卸载时确保释放麦克风（防止用户切到别的页面后红灯还亮着）
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      message.error("当前 WebView 不支持录音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        message.error("麦克风权限被拒绝，请在系统设置中允许");
      } else {
        message.error(`无法开始录音: ${msg}`);
      }
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("transcribing");
  }

  async function handleStop() {
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    if (blob.size === 0) {
      message.warning("没有录到声音");
      setStatus("idle");
      return;
    }
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await asrApi.transcribe({
        audioBase64,
        mime: blob.type || "audio/webm",
        language: language ?? "auto",
      });
      const text = (result.text ?? "").trim();
      if (!text) {
        message.warning("未识别到内容，请说话清晰一些");
      } else {
        onTranscribed(text);
      }
    } catch (e) {
      message.error(`识别失败: ${e}`);
    } finally {
      setStatus("idle");
    }
  }

  function handleClick() {
    if (!enabled) {
      message.warning({
        content: (
          <span>
            语音识别未启用，
            <a
              onClick={(ev) => {
                ev.preventDefault();
                navigate("/settings", { state: { scrollTo: "settings-asr" } });
              }}
            >
              去设置 →
            </a>
          </span>
        ),
      });
      return;
    }
    if (status === "idle") void startRecording();
    else if (status === "recording") stopRecording();
    // transcribing / disabled 状态下按钮已 disabled，不会进 onClick
  }

  const isRecording = status === "recording";
  const isBusy = status === "transcribing";
  const effectiveTooltip =
    tooltip ??
    (isRecording
      ? "再次点击结束录音"
      : isBusy
      ? "正在识别…"
      : enabled
      ? "语音输入"
      : "未启用语音识别");

  const icon = isBusy ? (
    <Loader2 size={14} className="animate-spin" />
  ) : isRecording ? (
    <Square size={14} fill="currentColor" />
  ) : (
    <Mic size={14} />
  );

  return (
    <Tooltip title={effectiveTooltip} mouseEnterDelay={0.4}>
      <Button
        type={isRecording ? "primary" : "text"}
        danger={isRecording}
        size={size}
        icon={icon}
        loading={false /* 用自定义 spinner 图标，不让 antd 替换 icon */}
        disabled={disabled || isBusy}
        onClick={handleClick}
        className={className}
        aria-label="语音输入"
      />
    </Tooltip>
  );
}

/**
 * Blob → base64（不含 data:xxx;base64, 前缀）。
 * 用 FileReader 而不是 btoa(String.fromCharCode(...))，避免大文件超出栈深度。
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader 失败"));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const idx = dataUrl.indexOf(",");
      resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}
