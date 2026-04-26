import { useEffect } from "react";
import { ConfigProvider, theme, App as AntdApp, message } from "antd";
import zhCN from "antd/locale/zh_CN";
import { listen } from "@tauri-apps/api/event";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useAppStore } from "@/store";
import { AppRouter } from "@/Router";
import { getAntdTokens } from "@/theme/tokens";
import { TaskReminderListener } from "@/components/tasks/TaskReminderListener";

function App() {
  const themeCategory = useAppStore((s) => s.themeCategory);
  const lightTheme = useAppStore((s) => s.lightTheme);
  const darkTheme = useAppStore((s) => s.darkTheme);
  const activeTheme = themeCategory === "light" ? lightTheme : darkTheme;
  const tokens = getAntdTokens(activeTheme);

  // 同步主题到 DOM，供 CSS 选择器使用
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeTheme);
    document.documentElement.setAttribute("data-theme-category", themeCategory);
  }, [activeTheme, themeCategory]);

  // 监听 db:reloaded：从 zip 导入快照后 Rust 侧会热重载 Connection 并 emit 此事件，
  // 前端收到后批量 bump 各 refresh tick，让所有视图（笔记列表 / 文件夹 / 标签 / 任务）
  // 自动重拉数据。无需重启应用。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("db:reloaded", () => {
      const s = useAppStore.getState();
      s.bumpNotesRefresh();
      s.bumpFoldersRefresh();
      s.bumpTagsRefresh();
      s.refreshTaskStats();
      message.success("数据已重载");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          themeCategory === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: tokens,
      }}
    >
      <AntdApp style={{ height: "100%" }}>
        <ErrorBoundary>
          <AppRouter />
          <TaskReminderListener />
        </ErrorBoundary>
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
