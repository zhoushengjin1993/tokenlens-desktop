# TokenLens Desktop

Cross-client AI Agent per-turn token monitor companion supporting **Codex**, **Zcode**, **Claude**, **DSH**, **Antigravity**, and **Cursor** (both Desktop GUI and CLI terminal sessions).

## Environment Requirements

- **Node.js `>= 22.0.0`** (required at runtime because TokenLens uses Node's built-in `node:sqlite` to read local agent databases cleanly without native binary rebuilds; the Windows installer does **not** bundle Node.js and will not touch your local Node installation).
- **Windows 10 / 11**: WebView2 runtime (pre-installed on Windows 10/11).
- *Optional (only if building Tauri from source)*: Rust (`stable-x86_64-pc-windows-msvc`), Visual Studio C++ Build Tools, and `pnpm >= 10`.

## Desktop Installer (Recommended)

1. Ensure **Node.js >= 22** is installed (`node -v`).
2. Download the `.msi` or `-setup.exe` installer (~4 MB) from [GitHub Releases](../../releases).
3. Launch **TokenLens Desktop** — it automatically starts the local read-only log engine (`127.0.0.1:4789`), docks to the top-right corner, and supports `Alt + T` (toggle pill/drawer) and `Alt + Shift + T` (click-through).

## Features

- **Multi-Client Log Engine (`@tokenlens/core` & `@tokenlens/adapters`)**:
  - **Codex** (`~/.codex/sessions/**/*.jsonl` + `archived_sessions` + `state_5.sqlite`)
  - **Zcode** (`~/.zcode/cli/db/db.sqlite`, strict read-only mode)
  - **Claude** (`~/.claude/projects/**/*.jsonl`, byte-offset tail + `message.id` deduplication)
  - **DSH** (`~/.dsh/sessions/**/*/session.jsonl.zstd`, native Zstd decompression + LRU cache)
  - **Antigravity** (`~/.gemini/antigravity/brain/*/.system_generated/logs/transcript_full.jsonl` + `conversation_summaries.db`)
  - **Cursor** (`%APPDATA%/Cursor/User/workspaceStorage/*/state.vscdb` & `globalStorage/state.vscdb`, read-only SQLite)
- **4-Level Breadcrumb Drill-Down UI (`@tokenlens/web`)**:
  - **Mini Pill** (`280x52`): Always-on-top status LED, turn number, total tokens, duration.
  - **Turn Drawer** (`400x610`): `Tool Tab → Active / Archived → Project → Session → Turns`, `Today / All` & `Spike` filters, configurable Spike threshold (`30k / 50k / 80k / 100k`), session cache hit & USD savings summary.
  - **Turn Detail**: Reasoning tokens, sub-agent call chain, tool calls, compaction & spike alerts.
- **Tauri v2 Desktop Companion (`@tokenlens/desktop`)**:
  - Frameless, transparent, always-on-top floating window with screen-edge clamping and auto-managed backend process.
  - Global hotkeys: `Alt + T` (toggle pill/drawer), `Alt + Shift + T` (toggle click-through).
  - System tray menu.
- **Built-in MCP Server (`@tokenlens/server`)**:
  - Exposes `get_turn_usage_summary` over HTTP `POST /mcp` or stdio (`--mcp`).

## Development Quick Start

```bash
pnpm install
pnpm build
pnpm test
```

### Run Backend + Web UI (Browser Dev)

```bash
# Watch real local agent logs (port 4789)
pnpm --filter @tokenlens/server start

# Or run with streaming fixture simulator
pnpm --filter @tokenlens/server start -- --sim

# Start Vite dev UI (port 4790)
pnpm --filter @tokenlens/web dev
```

Open `http://127.0.0.1:4790` in your browser.

### One-Command `npx` / CLI Mode

```bash
node ./packages/server/dist/cli.js
# Serves Web UI + WebSocket + POST /mcp on http://127.0.0.1:4789
```

### MCP Stdio Mode

```json
{
  "mcpServers": {
    "tokenlens": {
      "command": "node",
      "args": ["D:/tokenlens-desktop/packages/server/dist/cli.js", "--mcp"]
    }
  }
}
```

### Desktop App (Tauri v2)

Requires Rust (`rustup`) and Visual Studio C++ Build Tools (on Windows) or Xcode (on macOS):

```bash
pnpm --filter @tokenlens/desktop tauri:build
```

## Contributing

See [docs/CONTRIBUTING_ADAPTER.md](docs/CONTRIBUTING_ADAPTER.md) to add a new client adapter in ~50 lines.
