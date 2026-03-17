# Claude-Mem Review

**Repo**: github.com/thedotmack/claude-mem
**Reviewed**: 2026-03-17
**Version**: 10.5.6 (619 files, 37k+ stars)

## What it does

A Claude Code plugin that hooks into lifecycle events (SessionStart, PostToolUse, SessionEnd) to capture tool usage as "observations." Stores in SQLite + Chroma vector DB, compresses via Claude Agent SDK, injects relevant context into future sessions.

## Architecture

- 5 lifecycle hooks capture tool usage
- Express worker service on port 37777 (Bun-managed)
- SQLite for sessions/observations/summaries
- Chroma vector DB for semantic search
- MCP server with 4 search tools
- React viewer UI
- Multiple AI backends (Claude SDK, Gemini, OpenRouter)

## Critique

1. **Records actions, not insights** - "Claude edited file X" has limited future value vs "this codebase requires X because Y"
2. **Stale data is inevitable** - observations about code state become misleading as code changes, with no invalidation mechanism
3. **Token tax on every session** - retrieval costs tokens whether the retrieved context is useful or not
4. **Massive complexity** - 619 files, SQLite + Chroma + Express + Bun + React + tree-sitter for what is fundamentally an activity log with search
5. **No reflection or learning** - captures episodic memory but never distills it into semantic knowledge or behavioral corrections

## Key insight

It's a search engine over a diary. Real memory is lossy on purpose - you forget irrelevant details and retain distilled understanding. Claude-Mem does the opposite.
