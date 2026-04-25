/**
 * T-013 自定义数据目录设置区
 *
 * 让用户把 db + 附件搬到自己的 D 盘 / 大磁盘，避免占 C 盘。
 *
 * 设计：
 * - 修改路径只写指针文件（`<framework_app_data_dir>/data_dir.txt`），**重启生效**
 * - 不自动迁移老数据；明确提示用户手动复制 `app.db + kb_assets/`
 * - 显示当前 / 默认 / 待生效路径 + 来源 tag（env / pointer / default）
 */
import { useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import {
  HardDrive,
  FolderOpen,
  RotateCcw,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dataDirApi } from "@/lib/api";
import type { DataDirSource, ResolvedDataDir } from "@/types";

const { Text, Paragraph } = Typography;

const SOURCE_LABEL: Record<DataDirSource, { label: string; color: string }> = {
  env: { label: "环境变量", color: "purple" },
  pointer: { label: "自定义路径", color: "geekblue" },
  default: { label: "默认", color: "default" },
};

export function DataDirSection() {
  const { token } = antdTheme.useToken();
  const { message } = AntdApp.useApp();
  const [info, setInfo] = useState<ResolvedDataDir | null>(null);
  const [loading, setLoading] = useState(false);
  const [restartHint, setRestartHint] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      setInfo(await dataDirApi.getInfo());
    } catch (e) {
      message.error(`读取数据目录信息失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePick() {
    const sel = await openDialog({
      directory: true,
      multiple: false,
      title: "选择新的数据目录",
    });
    if (typeof sel !== "string") return;

    if (info && sel === info.currentDir) {
      message.info("和当前数据目录相同，无需修改");
      return;
    }

    Modal.confirm({
      title: "修改数据目录",
      width: 580,
      icon: <AlertTriangle size={20} style={{ color: token.colorWarning }} />,
      content: (
        <div className="text-sm leading-6">
          <Paragraph>
            将把数据根设为：<Text code>{sel}</Text>
          </Paragraph>
          <Alert
            type="warning"
            showIcon
            className="mt-2"
            message="重要：本操作只写一个指针文件，重启后生效"
            description={
              <div>
                <div>
                  <Text strong>不会自动迁移老数据</Text>
                  。如果你已有笔记，重启后看到的是空库（指向新目录里没有 db）。
                </div>
                <div className="mt-2">建议步骤：</div>
                <ol className="pl-5 mt-1" style={{ fontSize: 13 }}>
                  <li>
                    手动复制 <Text code>app.db</Text>{" "}
                    + 资产目录（<Text code>kb_assets/</Text>{" "}
                    <Text code>attachments/</Text>{" "}
                    <Text code>pdfs/</Text>{" "}
                    <Text code>sources/</Text>）
                    <br />从 <Text code>{info?.currentDir}</Text>
                    <br />到 <Text code>{sel}</Text>
                  </li>
                  <li>关闭应用</li>
                  <li>重新启动 → 用新路径</li>
                </ol>
                <Alert
                  type="info"
                  showIcon={false}
                  className="mt-2"
                  message={
                    <span style={{ fontSize: 12 }}>
                      💡 想反悔？随时点"恢复默认"清除指针，重启后回到默认路径。
                    </span>
                  }
                />
              </div>
            }
          />
        </div>
      ),
      okText: "确认修改（写入指针文件）",
      cancelText: "取消",
      onOk: async () => {
        try {
          await dataDirApi.setPending(sel);
          message.success("已记录新数据目录，关闭应用后重启生效");
          setRestartHint(sel);
          await load();
        } catch (e) {
          message.error(`保存失败: ${e}`);
        }
      },
    });
  }

  async function handleClear() {
    try {
      await dataDirApi.clearPending();
      message.success("已清除指针，重启后回到默认数据目录");
      setRestartHint(info?.defaultDir ?? null);
      await load();
    } catch (e) {
      message.error(`清除失败: ${e}`);
    }
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      message.success("路径已复制到剪贴板");
    } catch (e) {
      message.error(`复制失败: ${e}`);
    }
  }

  const sourceTag = info ? SOURCE_LABEL[info.source] : null;
  const isEnvOverride = info?.source === "env";
  const hasPending = info?.pendingDir != null;

  return (
    <Card
      size="small"
      className="mt-4"
      title={
        <span className="flex items-center gap-2">
          <HardDrive size={16} style={{ color: token.colorPrimary }} />
          数据目录（数据库 + 附件存储位置）
        </span>
      }
      loading={loading}
    >
      <Alert
        type="info"
        showIcon
        className="mb-3"
        message="把数据搬到自己选的目录（如 D 盘），避免占 C 盘 + 防重装系统丢数据"
        description={
          <span style={{ fontSize: 12 }}>
            修改后**重启生效**；不自动迁移老数据，需手动复制 <Text code>app.db</Text> +{" "}
            资产目录到新位置。
          </span>
        }
      />

      {info && (
        <div className="space-y-2">
          {/* 当前 */}
          <PathRow
            label="当前数据目录"
            path={info.currentDir}
            tag={sourceTag}
            onCopy={copyPath}
          />

          {/* 默认 */}
          {info.source !== "default" && (
            <PathRow
              label="默认目录"
              path={info.defaultDir}
              dim
              onCopy={copyPath}
            />
          )}

          {/* 待生效 */}
          {hasPending && info.pendingDir !== info.currentDir && (
            <Alert
              type="warning"
              showIcon
              className="mt-1"
              message="环境变量 KB_DATA_DIR 临时覆盖了你的设置"
              description={
                <span style={{ fontSize: 12 }}>
                  指针文件里记的是{" "}
                  <Text code>{info.pendingDir}</Text>
                  ；当前进程被环境变量临时覆盖到{" "}
                  <Text code>{info.currentDir}</Text>。
                  下次启动如果环境变量没设，会回到指针文件的路径。
                </span>
              }
            />
          )}

          {/* 重启提示 */}
          {restartHint && (
            <Alert
              type="success"
              showIcon
              className="mt-2"
              message="指针已写入，下次重启使用："
              description={<Text code>{restartHint}</Text>}
            />
          )}

          <Space className="mt-3" wrap>
            <Button
              type="primary"
              icon={<FolderOpen size={14} />}
              onClick={handlePick}
              disabled={isEnvOverride}
            >
              {info.source === "default" ? "选择新数据目录…" : "更换数据目录…"}
            </Button>
            {info.source === "pointer" && (
              <Popconfirm
                title="恢复默认数据目录?"
                description="清除指针文件，重启后回到默认 app_data 路径。本地数据不会被删除。"
                onConfirm={handleClear}
                okText="恢复默认"
                cancelText="取消"
              >
                <Button icon={<RotateCcw size={14} />}>恢复默认</Button>
              </Popconfirm>
            )}
            {isEnvOverride && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                提示：当前由 <Text code>KB_DATA_DIR</Text>{" "}
                环境变量驱动，UI 不允许覆盖；要修改请先 unset 该环境变量
              </Text>
            )}
          </Space>
        </div>
      )}
    </Card>
  );
}

function PathRow({
  label,
  path,
  tag,
  dim,
  onCopy,
}: {
  label: string;
  path: string;
  tag?: { label: string; color: string } | null;
  dim?: boolean;
  onCopy: (p: string) => void;
}) {
  const { token } = antdTheme.useToken();
  return (
    <div className="flex items-start gap-2" style={{ fontSize: 13 }}>
      <span
        style={{
          color: dim ? token.colorTextTertiary : token.colorTextSecondary,
          minWidth: 88,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <code
        className="flex-1 break-all"
        style={{
          background: token.colorFillTertiary,
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 12,
          color: dim ? token.colorTextTertiary : token.colorText,
        }}
      >
        {path}
      </code>
      {tag && <Tag color={tag.color}>{tag.label}</Tag>}
      <Button
        type="text"
        size="small"
        icon={<Copy size={12} />}
        onClick={() => onCopy(path)}
        title="复制路径"
      />
    </div>
  );
}
