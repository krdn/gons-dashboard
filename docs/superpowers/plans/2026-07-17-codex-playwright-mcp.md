# Codex Playwright MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pinned Playwright MCP server for Codex in this trusted repository without changing Claude Code CLI or any other MCP host.

**Architecture:** Store the server declaration only in the repository-scoped `.codex/config.toml`. Prove host isolation by comparing full-file hashes for stable non-Codex configurations and a canonical MCP-only semantic hash for Claude's mutable telemetry file, then use Codex itself to parse and enumerate the resulting MCP configuration.

**Tech Stack:** Codex CLI 0.144.5, TOML, Playwright MCP 0.0.78, `sha256sum`, `jq`, `rg`

## Global Constraints

- Do not modify `~/.codex/config.toml`; only create `/home/gon/projects/gon/gons-dashboard/.codex/config.toml`.
- Do not run `claude mcp add/remove`, `npx claude-mem install`, or any Claude plugin command.
- Do not modify Claude Code, Claude Desktop, VS Code, OpenCode, or mcporter configuration.
- Do not expose or copy GitHub PAT or Tavily key values.
- Preserve all pre-existing dirty-worktree changes.
- Pin Playwright MCP to exactly `0.0.78`; do not use `@latest`.

---

### Task 1: Add repository-scoped Codex Playwright MCP

**Files:**
- Create: `/home/gon/projects/gon/gons-dashboard/.codex/config.toml`
- Modify: `/home/gon/projects/gon/gons-dashboard/docs/superpowers/specs/2026-07-17-mcp-config-hardening-design.md`
- Create: `/home/gon/projects/gon/gons-dashboard/docs/superpowers/plans/2026-07-17-codex-playwright-mcp.md`

**Interfaces:**
- Consumes: Codex project configuration loading for trusted `.codex/config.toml` files.
- Produces: MCP server `playwright` using `npx -y @playwright/mcp@0.0.78` with 30-second startup and 120-second tool timeouts.

- [ ] **Step 1: Record non-Codex configuration hashes**

Run:

```bash
sha256sum \
  /home/gon/.claude/settings.json \
  /home/gon/.config/Claude/claude_desktop_config.json \
  /home/gon/.config/Code/User/mcp.json \
  /home/gon/.config/opencode/opencode.json \
  | sort > /tmp/gons-dashboard-non-codex-stable.before.sha256

jq -cS '
  {
    globalMcpServers: (.mcpServers // {}),
    projectMcpConfig: (
      (.projects["/home/gon/projects/gon/gons-dashboard"] // {})
      | {
          mcpServers: (.mcpServers // {}),
          enabledMcpjsonServers: (.enabledMcpjsonServers // []),
          disabledMcpjsonServers: (.disabledMcpjsonServers // []),
          disabledMcpServers: (.disabledMcpServers // []),
          mcpContextUris: (.mcpContextUris // [])
        }
    )
  }
' /home/gon/.claude.json \
  | sha256sum > /tmp/gons-dashboard-claude-mcp.before.sha256

wc -l /tmp/gons-dashboard-non-codex-stable.before.sha256
rg -q '^[0-9a-f]{64}  -$' /tmp/gons-dashboard-claude-mcp.before.sha256
```

Expected: `4 /tmp/gons-dashboard-non-codex-stable.before.sha256`; `rg` exits `0` with no output. The full hashes cover the four stable files. The canonical Claude hash covers only global `.mcpServers` and the current project's five fields: `mcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `disabledMcpServers`, and `mcpContextUris`. It excludes mutable top-level `pluginUsage` telemetry and does not claim isolation for other projects' Claude MCP configuration.

- [ ] **Step 2: Run the pre-change assertion**

Run:

```bash
test -f .codex/config.toml && \
  rg -q '^\[mcp_servers\.playwright\]$' .codex/config.toml
```

Expected: exit code `1` because the project-scoped Playwright declaration does not exist yet.

- [ ] **Step 3: Create the minimal Codex project configuration**

Create `.codex/config.toml` with exactly:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@0.0.78"]
startup_timeout_sec = 30
tool_timeout_sec = 120
```

- [ ] **Step 4: Verify Codex parses and merges the server**

Run:

```bash
codex mcp list --json | jq -e '
  (map(.name) | index("playwright")) != null and
  (map(.name) | index("mcp-search")) != null and
  (map(.name) | index("openaiDeveloperDocs")) != null
'
```

Expected: output `true` and exit code `0`. Codex itself successfully parses the TOML, existing global Codex servers remain present, and the project Playwright server is added.

- [ ] **Step 5: Verify the pinned Playwright package is executable**

Run:

```bash
npx -y @playwright/mcp@0.0.78 --help >/tmp/playwright-mcp-help.txt
test -s /tmp/playwright-mcp-help.txt
```

Expected: both commands exit `0`; the help output file is non-empty.

- [ ] **Step 6: Prove the scoped non-Codex MCP configurations are unchanged**

Run:

```bash
sha256sum \
  /home/gon/.claude/settings.json \
  /home/gon/.config/Claude/claude_desktop_config.json \
  /home/gon/.config/Code/User/mcp.json \
  /home/gon/.config/opencode/opencode.json \
  | sort > /tmp/gons-dashboard-non-codex-stable.after.sha256

jq -cS '
  {
    globalMcpServers: (.mcpServers // {}),
    projectMcpConfig: (
      (.projects["/home/gon/projects/gon/gons-dashboard"] // {})
      | {
          mcpServers: (.mcpServers // {}),
          enabledMcpjsonServers: (.enabledMcpjsonServers // []),
          disabledMcpjsonServers: (.disabledMcpjsonServers // []),
          disabledMcpServers: (.disabledMcpServers // []),
          mcpContextUris: (.mcpContextUris // [])
        }
    )
  }
' /home/gon/.claude.json \
  | sha256sum > /tmp/gons-dashboard-claude-mcp.after.sha256

diff -u \
  /tmp/gons-dashboard-non-codex-stable.before.sha256 \
  /tmp/gons-dashboard-non-codex-stable.after.sha256
diff -u \
  /tmp/gons-dashboard-claude-mcp.before.sha256 \
  /tmp/gons-dashboard-claude-mcp.after.sha256
```

Expected: both `diff` commands exit `0` with no output. Changes to unrelated Claude telemetry cannot create a false isolation failure, while any change to the global or current-project MCP fields still fails the semantic comparison. This comparison makes no claim about other projects' Claude MCP configuration.

- [ ] **Step 7: Verify the scoped diff**

Run:

```bash
git diff --check -- \
  .codex/config.toml \
  docs/superpowers/specs/2026-07-17-mcp-config-hardening-design.md \
  docs/superpowers/plans/2026-07-17-codex-playwright-mcp.md
git status --short -- \
  .codex/config.toml \
  docs/superpowers/specs/2026-07-17-mcp-config-hardening-design.md \
  docs/superpowers/plans/2026-07-17-codex-playwright-mcp.md
```

Expected: no whitespace errors. Only the Codex config, revised design, and this plan appear in the scoped status.

- [ ] **Step 8: Commit only the Codex-scoped change**

Run:

```bash
git add \
  .codex/config.toml \
  docs/superpowers/specs/2026-07-17-mcp-config-hardening-design.md \
  docs/superpowers/plans/2026-07-17-codex-playwright-mcp.md
git commit --only -m "chore: Codex Playwright MCP 추가" -- \
  .codex/config.toml \
  docs/superpowers/specs/2026-07-17-mcp-config-hardening-design.md \
  docs/superpowers/plans/2026-07-17-codex-playwright-mcp.md
```

Expected: one commit containing only the three listed paths. Existing staged or unstaged user changes remain outside the commit.
