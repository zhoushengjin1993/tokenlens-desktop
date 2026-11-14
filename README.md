# TokenLens Desktop

Cross-client AI Agent per-turn token monitor companion supporting **Codex**, **Zcode**, **Claude**, **DSH**, and **Antigravity** (both Desktop GUI and CLI terminal sessions).

## Features

- **Multi-Client Log Engine (`@tokenlens/core` & `@tokenlens/adapters`)**:
  - **Codex** (`~/.codex/sessions/**/*.jsonl`)
  - **Zcode** (`~/.zcode/cli/db/db.sqlite`, strict read-only mode)
  - **Claude** (`~/.claude/projects/**/*.jsonl`, byte-offset tail + `message.id` deduplication)
  - **DSH** (`~/.dsh/sessions/**/*/session.jsonl.zstd`, native Zstd decompression + LRU cache)
  - **Antigravity** (`~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` + `conversation_summaries.db`)
- **3-State Glassmorphism UI (`@tokenlens/web`)**:
  - **Mini Pill** (`280x52`): Always-on-top status LED, turn number, total tokens, duration.
  - **Turn Drawer** (`384x604`): Client switcher tabs, Auto-Switch active client toggle, session cache hit & USD savings summary, dual-color progress bars.
  - **Turn Detail**: Reasoning tokens, sub-agent call chain, tool calls, compaction & spike (>50k) alerts.
- **Tauri v2 Desktop Companion (`@tokenlens/desktop`)**:
  - Frameless, transparent, always-on-top floating window with screen-edge clamping.
  - Global hotkeys: `Alt + T` (toggle pill/drawer), `Alt + Shift + T` (toggle click-through).
  - System tray menu.
- **Built-in MCP Server (`@tokenlens/server`)**:
  - Exposes `get_turn_usage_summary` over HTTP `POST /mcp` or stdio (`--mcp`).

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
```

### Run Backend + Web UI

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
