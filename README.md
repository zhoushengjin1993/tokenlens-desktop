# TokenLens Desktop

Cross-client AI Agent per-turn token monitor companion supporting **Codex**, **Zcode**, **Claude**, **DSH**, and **Antigravity** (both Desktop GUI and CLI sessions).

## Workspace Structure

- `packages/core` — `UnifiedTurnUsage` types, `BaseLogAdapter`, `TurnAggregator`, `PathResolver`
- `packages/adapters` — Log adapters for Codex, Zcode, Claude, DSH, and Antigravity
- `packages/simulator` — `LogReplaySimulator` for 0.5s/line streaming replay
- `test/fixtures` — Anonymized golden log fixtures

## Quick Start

```bash
pnpm install
pnpm test
```
