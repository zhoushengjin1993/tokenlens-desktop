# TokenLens Desktop

[English](README.md) | **简体中文**

> 一款轻量、桌面置顶、**100% 纯本地只读解析**的 AI 编程助手 Token 实时监控伴侣（支持 **Windows** 与 **macOS**）。

实时追踪 **Codex**、**Zcode**、**Claude Code**、**DSH**、**Antigravity** 与 **Cursor** 的每轮 Token 消耗、提示词缓存命中率、估算节省费用与上下文高耗预警——所有日志均在本地解析，绝不上传任何代码或对话内容。

---

## 核心特性

- **纯本地只读，隐私安全**：本地引擎运行于 `127.0.0.1:4789`，以只读方式解析日志与 SQLite 数据库，不修改原始数据、不上传云端。
- **悬浮胶囊与全局热键**：闲置时收起为 `260×36` 极简胶囊，按 **`Alt + T`**（macOS 为 `Option + T`）一键展开/收起面板，按 **`Alt + Shift + T`** 切换鼠标穿透模式。
- **四级面包屑下钻**：`工具标签 → 活跃/已归档 → 项目 → 会话 → 逐轮明细`（展示推理 Token、子 Agent 调用链、工具调用与上下文压缩标记）。
- **高耗预警与缓存命中**：单轮输入达到自定义阈值（`30k / 50k / 80k / 100k`）时触发橙色 Spike 预警，帮你及时精简上下文或新开会话。
- **高度可定制**：
  - 支持 **English / 简体中文** 一键切换（默认英文，可在顶部栏或设置中切换）。
  - 支持**自定义顶部工具栏显示列表**（例如本地只用 `Codex` 和 `Cursor`，可仅勾选这两项）。
  - 支持**项目卡片内联重命名**（例如将 Antigravity 的 `ag-xxxxxxxx` 分组重命名为可读项目名）。

---

## 安装指南（Windows & macOS）

### 运行环境要求
- **Node.js `>= 22.0.0`**（需提前在本地安装，`node -v` 可查）：TokenLens 依赖 Node 内置的 `node:sqlite` 模块免编译读取本地数据库。安装包仅约 4 MB，**不会**内置或覆盖你本地已有的 Node.js 环境。
- **Windows 10 / 11**：系统内置 WebView2 运行时即可直接运行。
- **macOS（Apple Silicon / Intel 通用版）**：macOS 11+。（若首次打开提示“无法验证开发者”，请在**系统设置 → 隐私与安全性**中允许打开，或执行 `xattr -cr "/Applications/TokenLens Desktop.app"`。）

### 下载安装包
1. 前往 [**GitHub Releases**](../../releases) 下载对应系统安装包：
   - **Windows**：`.msi` 或 `-setup.exe`
   - **macOS（Universal 通用包）**：`.dmg` 或 `.app.tar.gz`
2. 启动 **TokenLens Desktop** 后，软件会自动拉起本地只读引擎并吸附在屏幕右上角。

---

## 支持的客户端

| 客户端 | 本地只读数据源 | 说明 |
| --- | --- | --- |
| **Codex** | `~/.codex/sessions/**/*.jsonl`、`archived_sessions`、`state_5.sqlite` | 支持桌面端与 CLI |
| **Zcode** | `~/.zcode/cli/db/db.sqlite` | 只读 SQLite |
| **Claude** | `~/.claude/projects/**/*.jsonl` | 字节偏移增量读取 + `message.id` 去重 |
| **DSH** | `~/.dsh/sessions/**/*/session.jsonl.zstd` | 原生 Zstd 解压 + LRU 缓存 |
| **Antigravity** | `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript_full.jsonl` 与 `conversation_summaries.db` | 自动按工作区路径或 `project_id` 分组 |
| **Cursor** | Cursor `workspaceStorage` 与 `globalStorage` 中的 `state.vscdb` | 兼容 Windows (`%APPDATA%/Cursor`) 与 macOS (`~/Library/Application Support/Cursor`) |

---

## 内置 MCP Server

`@tokenlens/server` 同时提供 `get_turn_usage_summary` 工具，支持 HTTP（`POST http://127.0.0.1:4789/mcp`）与 stdio（`--mcp`）：

```json
{
  "mcpServers": {
    "tokenlens": {
      "command": "node",
      "args": ["/path/to/tokenlens-desktop/packages/server/dist/cli.js", "--mcp"]
    }
  }
}
```

---

## 本地开发与构建

需提前安装 **Node.js >= 22** 与 **pnpm >= 10**。

```bash
pnpm install
pnpm build
pnpm test
```

### 浏览器调试模式

```bash
# 1. 启动本地日志采集后端（端口 4789）
pnpm --filter @tokenlens/server start

# 或启动内置回放模拟器进行演示
pnpm --filter @tokenlens/server start -- --sim

# 2. 启动前端 Vite 开发服务（端口 4790）
pnpm --filter @tokenlens/web dev -- --host 127.0.0.1
```

在浏览器访问 `http://127.0.0.1:4790` 即可预览。

### 从源码打包桌面端

需安装 Rust（`rustup`），以及 Visual Studio C++ 生成工具（Windows）或 Xcode Command Line Tools（macOS）：

```bash
pnpm --filter @tokenlens/desktop tauri build
```

---

## 参与贡献

欢迎阅读 [docs/CONTRIBUTING_ADAPTER.md](docs/CONTRIBUTING_ADAPTER.md)，约 50 行代码即可接入新的 AI 工具适配器。
