import { useEffect, useMemo, useState } from "react";
import {
  Card,
  Typography,
  Tag,
  Button,
  Space,
  Collapse,
  Tabs,
  Alert,
  message,
  Tooltip,
  List,
  Empty,
} from "antd";
import { CheckCircleFilled, CloseCircleFilled, CopyOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { ExternalLink, Folder } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

// 用浏览器原生 clipboard，省一个 npm 依赖；webview 在 https / tauri:// 协议下都允许
async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

const { Text, Paragraph } = Typography;

interface McpRuntimeInfo {
  internalReady: boolean;
  sidecarBinaryPath: string | null;
  dbPath: string;
  targetTriple: string;
  os: string;
}

interface McpToolInfo {
  name: string;
  description: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: any;
}

/**
 * 设置页 · MCP 服务器面板
 *
 * 功能：
 * - 显示内置 in-memory MCP server 状态 + 12 工具
 * - 测试 ping（验证活体）
 * - 一键生成 Claude Desktop / Cursor / Cherry Studio 配置 JSON
 * - 一键打开 sidecar binary 所在目录（方便复制路径）
 */
export function MCPServerSection() {
  const [info, setInfo] = useState<McpRuntimeInfo | null>(null);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [i, t] = await Promise.all([
        invoke<McpRuntimeInfo>("mcp_runtime_info"),
        invoke<McpToolInfo[]>("mcp_internal_list_tools").catch(() => [] as McpToolInfo[]),
      ]);
      setInfo(i);
      setTools(t);
    } catch (e) {
      message.error(`加载 MCP 信息失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePing() {
    setPinging(true);
    setPingResult(null);
    try {
      const t0 = performance.now();
      const r = await invoke<string>("mcp_internal_call_tool", {
        name: "ping",
        arguments: {},
      });
      const ms = Math.round(performance.now() - t0);
      setPingResult(`${r} · ${ms}ms`);
    } catch (e) {
      setPingResult(`错误: ${e}`);
    } finally {
      setPinging(false);
    }
  }

  async function copyConfig(json: string, label: string) {
    try {
      await writeClipboard(json);
      message.success(`已复制 ${label} 配置到剪贴板`);
    } catch (e) {
      message.error(`复制失败: ${e}`);
    }
  }

  async function openBinaryDir() {
    if (!info?.sidecarBinaryPath) return;
    try {
      await revealItemInDir(info.sidecarBinaryPath);
    } catch (e) {
      message.error(`打开目录失败: ${e}`);
    }
  }

  // 生成三种客户端的配置 JSON
  const configs = useMemo(() => {
    if (!info?.sidecarBinaryPath) return null;
    // JSON 字符串里 Windows 路径需要转义反斜杠
    const escapedBinary = info.sidecarBinaryPath.replace(/\\/g, "\\\\");
    const escapedDb = info.dbPath.replace(/\\/g, "\\\\");
    const claudeConfig = JSON.stringify(
      {
        mcpServers: {
          "knowledge-base": {
            command: escapedBinary,
            args: ["--db-path", escapedDb],
          },
        },
      },
      null,
      2,
    );
    const claudeWritable = JSON.stringify(
      {
        mcpServers: {
          "knowledge-base": {
            command: escapedBinary,
            args: ["--db-path", escapedDb, "--writable"],
          },
        },
      },
      null,
      2,
    );
    // Cursor 用 forward slash 也行
    const cursorConfig = JSON.stringify(
      {
        mcpServers: {
          "knowledge-base": {
            command: info.sidecarBinaryPath.replace(/\\/g, "/"),
            args: ["--db-path", info.dbPath.replace(/\\/g, "/")],
          },
        },
      },
      null,
      2,
    );
    return { claudeConfig, claudeWritable, cursorConfig };
  }, [info]);

  return (
    <Card
      id="settings-mcp"
      title={
        <span className="flex items-center gap-2">
          🔌 MCP 服务器（接入 Claude Desktop / Cursor / Cherry Studio）
        </span>
      }
      className="mb-4"
      loading={loading}
      extra={
        <Button size="small" onClick={() => void load()}>
          刷新
        </Button>
      }
    >
      {!info ? (
        <Empty description="未加载到 MCP 信息" />
      ) : (
        <>
          {/* ─── 状态行 ─────────────────────────────── */}
          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <Tag
              icon={info.internalReady ? <CheckCircleFilled /> : <CloseCircleFilled />}
              color={info.internalReady ? "success" : "error"}
            >
              内置 MCP Server {info.internalReady ? "已就绪" : "未就绪"}
            </Tag>
            <Tag>{tools.length} 个工具</Tag>
            <Tag>{info.targetTriple}</Tag>
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={pinging}
              onClick={() => void handlePing()}
              disabled={!info.internalReady}
            >
              测试 ping
            </Button>
            {pingResult && (
              <Text
                type={pingResult.startsWith("错误") ? "danger" : "secondary"}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              >
                {pingResult}
              </Text>
            )}
          </div>

          {/* ─── 路径信息 ─────────────────────────────── */}
          <div className="mb-4 space-y-2">
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Sidecar binary
              </Text>
              <div className="flex items-center gap-2">
                {info.sidecarBinaryPath ? (
                  <>
                    <Paragraph
                      copyable={{ text: info.sidecarBinaryPath }}
                      style={{
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 12,
                        flex: 1,
                        wordBreak: "break-all",
                      }}
                    >
                      {info.sidecarBinaryPath}
                    </Paragraph>
                    <Tooltip title="在文件管理器中显示">
                      <Button
                        size="small"
                        icon={<Folder size={14} />}
                        onClick={() => void openBinaryDir()}
                      />
                    </Tooltip>
                  </>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="未找到 kb-mcp binary"
                    description={
                      <span>
                        开发期请先运行 <code>pnpm build:mcp</code> 编译 sidecar；
                        正式安装包应自带（如果没有，重新打一遍）
                      </span>
                    }
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            </div>

            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                知识库 db
              </Text>
              <Paragraph
                copyable={{ text: info.dbPath }}
                style={{
                  margin: 0,
                  fontFamily: "monospace",
                  fontSize: 12,
                  wordBreak: "break-all",
                }}
              >
                {info.dbPath}
              </Paragraph>
            </div>
          </div>

          {/* ─── 客户端配置 JSON ─────────────────────── */}
          {configs && (
            <div className="mb-4">
              <Text strong>外部客户端配置</Text>
              <Tabs
                size="small"
                items={[
                  {
                    key: "claude-ro",
                    label: "Claude Desktop（只读）",
                    children: (
                      <ConfigBlock
                        json={configs.claudeConfig}
                        label="Claude Desktop 只读"
                        onCopy={copyConfig}
                        hint="抄到 %APPDATA%\\Claude\\claude_desktop_config.json，重启即可。LLM 只能搜不能改你的笔记。"
                      />
                    ),
                  },
                  {
                    key: "claude-rw",
                    label: "Claude Desktop（可写）",
                    children: (
                      <ConfigBlock
                        json={configs.claudeWritable}
                        label="Claude Desktop 可写"
                        onCopy={copyConfig}
                        hint="加 --writable 后 LLM 能调用 create_note / update_note / add_tag_to_note 修改你的知识库。"
                      />
                    ),
                  },
                  {
                    key: "cursor",
                    label: "Cursor",
                    children: (
                      <ConfigBlock
                        json={configs.cursorConfig}
                        label="Cursor"
                        onCopy={copyConfig}
                        hint="抄到 ~/.cursor/mcp.json"
                      />
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* ─── 12 工具列表（折叠） ─────────────────── */}
          <Collapse
            size="small"
            items={[
              {
                key: "tools",
                label: `内置工具 · ${tools.length} 个（kb-core 实现，sidecar 与自家 AI 对话页共享）`,
                children: tools.length === 0 ? (
                  <Empty description="未加载到工具" />
                ) : (
                  <List
                    size="small"
                    dataSource={tools}
                    renderItem={(t) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <Space>
                              <code style={{ fontSize: 13 }}>{t.name}</code>
                              {t.name.startsWith("create_") ||
                              t.name.startsWith("update_") ||
                              t.name.startsWith("add_") ? (
                                <Tag color="orange">写</Tag>
                              ) : (
                                <Tag color="blue">读</Tag>
                              )}
                            </Space>
                          }
                          description={
                            <Text style={{ fontSize: 12 }} type="secondary">
                              {t.description || "（无说明）"}
                            </Text>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />

          {/* ─── 文档链接 ─────────────────────────────── */}
          <div className="mt-4 text-right">
            <Button
              type="link"
              size="small"
              icon={<ExternalLink size={12} />}
              onClick={() =>
                void invoke("greet", { name: "noop" }).catch(() => {
                  /* 占位，未来可接 docs */
                })
              }
            >
              详细文档：docs/mcp-setup.md
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

interface ConfigBlockProps {
  json: string;
  label: string;
  hint: string;
  onCopy: (json: string, label: string) => void;
}

function ConfigBlock({ json, label, hint, onCopy }: ConfigBlockProps) {
  return (
    <div>
      <Alert type="info" showIcon message={hint} className="mb-2" />
      <pre
        style={{
          background: "var(--ant-color-fill-quaternary)",
          padding: 12,
          borderRadius: 6,
          fontSize: 12,
          maxHeight: 200,
          overflow: "auto",
          margin: 0,
        }}
      >
        {json}
      </pre>
      <div className="mt-2 text-right">
        <Button size="small" icon={<CopyOutlined />} onClick={() => onCopy(json, label)}>
          复制 JSON
        </Button>
      </div>
    </div>
  );
}
