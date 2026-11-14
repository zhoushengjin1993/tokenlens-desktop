# TokenLens Desktop

**English** | [简体中文](README.zh-CN.md)

> A lightweight, always-on-top, 100% local & read-only AI coding agent token monitor for **Windows** and **macOS**.

Track real-time per-turn token usage, prompt cache hit rates, estimated USD savings, and context spikes across **Codex**, **Zcode**, **Claude Code**, **DSH**, **Antigravity**, and **Cursor** — without touching your code or uploading any logs.

---

## Why TokenLens?

- **Zero Cloud Upload**: Strictly read-only local log/SQLite parsing (`127.0.0.1:4789`). Your prompts and code never leave your machine.
- **Floating Capsule & Hotkeys**: Collapses into a sleek `260×36` floating pill when idle; press **`Alt + T`** (or `Option + T`) to expand/collapse, and **`Alt + Shift + T`** to toggle click-through.
- **4-Level Breadcrumb Drill-Down**: `Client Tab → Active / Archived → Project → Session → Turn Detail` (with Reasoning tokens, Sub-agent calls, Tool calls, and Context Compaction badges).
- **Spike Alerts & Cache Hit Tracking**: Highlights turns whose input tokens exceed your configurable threshold (`30k / 50k / 80k / 100k`) so you can trim context or start a fresh session before burning through quota.
- **Customizable Workspace**:
  - Toggle **English / 简体中文** directly from the top bar or Settings (defaults to English).
  - Show/hide specific tools in the top toolbar (e.g., show only `Codex` and `Cursor`).
  - Inline-rename projects (e.g., rename Antigravity `ag-xxxxxxxx` project IDs to friendly names).

---

## Installation (Windows & macOS)

### Prerequisites
- **Node.js `>= 22.0.0`** (`node -v`) — required at runtime because TokenLens uses Node's built-in `node:sqlite` module to read local agent databases cleanly without native binary rebuilds. The installers are ~4 MB and do **not** bundle or overwrite your local Node.js installation.
- **Windows 10 / 11**: WebView2 runtime (pre-installed on Windows 10/11).
- **macOS (Apple Silicon & Intel)**: macOS 11+. (If Gatekeeper warns on an unsigned app, run `xattr -cr "/Applications/TokenLens Desktop.app"` or allow it in **System Settings → Privacy & Security**.)

### Download Installer
1. Download the latest installer from [**GitHub Releases**](../../releases):
   - **Windows**: `.msi` or `-setup.exe`
   - **macOS (Universal)**: `.dmg` or `.app.tar.gz`
2. Launch **TokenLens Desktop** — it automatically starts the local read-only log engine (`127.0.0.1:4789`) and docks to the top-right corner of your screen.

---

## Supported Clients

| Client | Local Data Source (Read-Only) | Notes |
| --- | --- | --- |
| **Codex** | `~/.codex/sessions/**/*.jsonl`, `archived_sessions`, `state_5.sqlite` | Desktop & CLI |
| **Zcode** | `~/.zcode/cli/db/db.sqlite` | Read-only SQLite |
| **Claude** | `~/.claude/projects/**/*.jsonl` | Byte-offset tail + `message.id` deduplication |
| **DSH** | `~/.dsh/sessions/**/*/session.jsonl.zstd` | Native Zstd decompression + LRU cache |
| **Antigravity** | `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript_full.jsonl` & `conversation_summaries.db` | Groups by workspace URI or `project_id` |
| **Cursor** | `state.vscdb` in Cursor `workspaceStorage` & `globalStorage` | Windows (`%APPDATA%/Cursor`) & macOS (`~/Library/Application Support/Cursor`) |

---

## Built-in MCP Server

`@tokenlens/server` also exposes `get_turn_usage_summary` over HTTP (`POST http://127.0.0.1:4789/mcp`) or stdio (`--mcp`):

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

## Development Quick Start

Requires **Node.js >= 22** and **pnpm >= 10**.

```bash
pnpm install
pnpm build
pnpm test
```

### Browser Dev Mode

```bash
# 1. Start local log engine (port 4789)
pnpm --filter @tokenlens/server start

# Or start with built-in replay simulator
pnpm --filter @tokenlens/server start -- --sim

# 2. Start Vite web UI (port 4790)
pnpm --filter @tokenlens/web dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:4790` in your browser.

### Build Desktop App from Source

Requires Rust (`rustup`) plus Visual Studio C++ Build Tools (Windows) or Xcode Command Line Tools (macOS):

```bash
pnpm --filter @tokenlens/desktop tauri build
```

---

## Contributing

See [docs/CONTRIBUTING_ADAPTER.md](docs/CONTRIBUTING_ADAPTER.md) to add a new client adapter in ~50 lines.
