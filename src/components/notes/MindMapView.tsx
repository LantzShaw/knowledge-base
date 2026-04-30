import { useEffect, useRef } from "react";
import { Modal, Button, Space, Tooltip, App as AntdApp, theme as antdTheme } from "antd";
import { ZoomIn, ZoomOut, Maximize2, Download } from "lucide-react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { save } from "@tauri-apps/plugin-dialog";
import { systemApi } from "@/lib/api";

interface Props {
  /** Modal open 状态 */
  open: boolean;
  onClose: () => void;
  /** 笔记 markdown 原文 */
  markdown: string;
  /** 笔记标题（用作根节点 fallback / 导出文件名） */
  title: string;
}

/**
 * 思维导图视图（只读）
 *
 * 把笔记的 markdown 标题层级实时渲染成思维导图。基于 markmap-view（D3 SVG）。
 *
 * 设计取舍（参见对比 Notion/Logseq/Obsidian）：
 * - **只读**：不支持节点拖拽 / 富文本编辑。原始数据仍然是 markdown，避免双数据源同步问题。
 * - **从 markdown 而非 HTML**：tiptap 内容已是 markdown，markmap 直接吃，零损耗。
 * - **不持久化**：思维导图是 markdown 的"另一种视图"，不存数据库。
 */
// 同一笔记反复打开 Modal 时复用 transformer（避免每次重建 plugin 注册）
const transformer = new Transformer();

export function MindMapView({ open, onClose, markdown, title }: Props) {
  const { token } = antdTheme.useToken();
  const { message } = AntdApp.useApp();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<Markmap | null>(null);

  // Modal 打开后初始化 / 更新 markmap；关闭时销毁，避免内存泄漏
  useEffect(() => {
    if (!open) {
      if (mmRef.current) {
        mmRef.current.destroy();
        mmRef.current = null;
      }
      return;
    }

    // Modal 内容是 portal 渲染，open 切到 true 后下一帧 svgRef 才挂上
    const raf = requestAnimationFrame(() => {
      if (!svgRef.current) return;

      // markdown 没有任何 # 标题时，markmap 会渲染成只有一个根节点的"光秃树"。
      // 用笔记标题作为 H1 兜底，让用户至少看到一个有意义的节点。
      const md = markdown.trim()
        ? markdown
        : `# ${title || "未命名笔记"}\n`;
      const { root } = transformer.transform(md);

      if (mmRef.current) {
        mmRef.current.setData(root);
        void mmRef.current.fit();
      } else {
        mmRef.current = Markmap.create(svgRef.current, undefined, root);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [open, markdown, title]);

  function handleZoom(factor: number) {
    const mm = mmRef.current;
    if (!mm) return;
    // markmap 的 rescale 接受相对缩放系数（>1 放大，<1 缩小）
    void mm.rescale(factor);
  }

  function handleFit() {
    void mmRef.current?.fit();
  }

  async function handleExportSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      // Tauri 2 WebView 默认拦截 `<a download>`，必须经 save 对话框 + Rust 写盘
      const targetPath = await save({
        title: "导出思维导图为 SVG",
        defaultPath: `${title || "mindmap"}.svg`,
        filters: [{ name: "SVG 矢量图", extensions: ["svg"] }],
      });
      if (!targetPath) return;
      const xml = new XMLSerializer().serializeToString(svg);
      const content = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
      await systemApi.writeTextFile(targetPath, content);
      message.success("已导出 SVG");
    } catch (e) {
      message.error(`导出失败：${e}`);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div className="flex items-center justify-between pr-6">
          <span>思维导图 · {title || "未命名"}</span>
          <Space size="small">
            <Tooltip title="放大">
              <Button
                size="small"
                type="text"
                icon={<ZoomIn size={14} />}
                onClick={() => handleZoom(1.25)}
              />
            </Tooltip>
            <Tooltip title="缩小">
              <Button
                size="small"
                type="text"
                icon={<ZoomOut size={14} />}
                onClick={() => handleZoom(0.8)}
              />
            </Tooltip>
            <Tooltip title="自适应">
              <Button
                size="small"
                type="text"
                icon={<Maximize2 size={14} />}
                onClick={handleFit}
              />
            </Tooltip>
            <Tooltip title="导出 SVG">
              <Button
                size="small"
                type="text"
                icon={<Download size={14} />}
                onClick={() => void handleExportSvg()}
              />
            </Tooltip>
          </Space>
        </div>
      }
      footer={null}
      width="80vw"
      // 顶部留小一些空间，让 svg 占满 Modal body
      styles={{ body: { padding: 0, height: "70vh" } }}
      destroyOnHidden
    >
      <svg
        ref={svgRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: token.colorBgContainer,
        }}
      />
    </Modal>
  );
}
