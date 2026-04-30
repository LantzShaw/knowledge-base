#!/usr/bin/env node
// scripts/build-mcp.mjs
// 编译 kb-mcp sidecar，并按 Tauri externalBin 命名规范复制到 src-tauri/binaries/
//
// 用法：
//   pnpm build:mcp           — 默认 release，host triple
//   pnpm build:mcp --debug   — debug 编译（更快，体积大）
//
// Tauri 要求 externalBin 文件名带 target triple 后缀，例：
//   binaries/kb-mcp-x86_64-pc-windows-msvc.exe
//   binaries/kb-mcp-aarch64-apple-darwin
//   binaries/kb-mcp-x86_64-unknown-linux-gnu

import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_TAURI = join(ROOT, "src-tauri");
const BINARIES_DIR = join(SRC_TAURI, "binaries");

const profile = process.argv.includes("--debug") ? "debug" : "release";
const profileFlag = profile === "release" ? "--release" : "";

// 1) 取 host target triple
function getHostTriple() {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error("rustc 未安装或不在 PATH 中");
  }
  const m = r.stdout.match(/^host:\s*(\S+)$/m);
  if (!m) throw new Error("无法从 rustc -vV 解析 host triple");
  return m[1];
}

// 2) 编译 kb-mcp
function buildMcp() {
  console.log(`[build-mcp] cargo build ${profileFlag} -p kb-mcp`);
  execSync(`cargo build ${profileFlag} -p kb-mcp`, {
    cwd: SRC_TAURI,
    stdio: "inherit",
  });
}

// 3) 复制到 binaries/kb-mcp-<triple>(.exe)
function copyToBinaries(triple) {
  const isWin = process.platform === "win32";
  const exeSuffix = isWin ? ".exe" : "";
  const src = join(SRC_TAURI, "target", profile, `kb-mcp${exeSuffix}`);
  if (!existsSync(src)) {
    throw new Error(`找不到产物: ${src}`);
  }
  if (!existsSync(BINARIES_DIR)) mkdirSync(BINARIES_DIR, { recursive: true });
  const dst = join(BINARIES_DIR, `kb-mcp-${triple}${exeSuffix}`);
  copyFileSync(src, dst);
  console.log(`[build-mcp] copied → ${dst}`);
}

const triple = getHostTriple();
console.log(`[build-mcp] host triple = ${triple}, profile = ${profile}`);
buildMcp();
copyToBinaries(triple);
console.log("[build-mcp] done");
