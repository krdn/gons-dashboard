# Codex 전용 MCP 구성 설계

**날짜:** 2026-07-17  
**범위:** `gons-dashboard`를 신뢰된 저장소로 연 Codex CLI·IDE·앱의 프로젝트 MCP 구성

## 목표

현재 Codex에는 문서와 메모리 MCP만 등록되어 있다. Next.js 대시보드의 브라우저 검증을 위해 Playwright MCP를 저장소 범위로 추가하되, Claude Code CLI를 포함한 다른 MCP 호스트에는 어떤 구성 변화도 주지 않는다.

## 사용자 승인 제약

- Claude Code CLI에 영향을 주지 않는다.
- Claude Desktop, VS Code, OpenCode, mcporter 설정을 수정하지 않는다.
- Codex의 글로벌 설정 `~/.codex/config.toml`도 수정하지 않는다.
- 저장소 범위 `.codex/config.toml`만 새로 만든다.
- 기존 저장소 미커밋 변경을 수정하거나 정리하지 않는다.

## 접근법

### 저장소 범위 Codex MCP — 채택

신뢰된 저장소의 `.codex/config.toml`에 Playwright STDIO 서버를 선언한다. Codex 공식 구성 모델에서 프로젝트 설정은 현재 저장소에만 적용되며 Claude Code는 이 파일을 MCP 설정으로 읽지 않는다.

글로벌 `codex mcp add`는 모든 저장소의 Codex에 영향을 주므로 사용하지 않는다. Claude의 `.mcp.json`, `~/.claude.json`, 플러그인 설정도 사용하지 않는다.

## 구성

생성할 파일은 `.codex/config.toml` 하나다.

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@0.0.78"]
startup_timeout_sec = 30
tool_timeout_sec = 120
```

- `0.0.78`은 감사 시점에 확인한 공식 Playwright MCP 버전이다.
- `@latest`를 사용하지 않아 최상위 MCP 패키지 버전이 실행 시점마다 바뀌는 드리프트를 막는다.
- 첫 `npx` 해석 시간을 고려해 시작 제한은 30초로 둔다.
- 브라우저 상호작용을 고려해 도구 제한은 120초로 둔다.
- 인증정보나 환경변수는 추가하지 않는다.

## 명시적 비변경 항목

- Codex 글로벌 `openaiDeveloperDocs`, `mcp-search`, claude-mem 플러그인 상태
- Claude Code의 PlayMCP, Slack, Gmail, Calendar, Drive, Zapier, Context7, Playwright, Chrome DevTools, claude-mem, `gons-calendar`
- Claude Desktop의 filesystem·GitHub 구성과 PAT
- VS Code의 GitHub·Zapier·Playwright·Tavily·Chrome DevTools 구성과 Tavily 키
- OpenCode의 7개 MCP 구성

기존 보안 감사에서 확인된 비-Codex 자격증명 문제는 이번 승인 범위 밖이므로 보고만 유지하고 수정하지 않는다.

## 검증

1. 변경 전 안정적인 비-Codex 설정 파일 4개의 전체 SHA-256과 `~/.claude.json`의 전역 및 현재 프로젝트 MCP 관련 필드만 정규화한 의미 SHA-256을 기록한다.
2. Codex 자체가 `.codex/config.toml`을 파싱하고 병합하는지 `codex mcp list --json`으로 검증한다.
3. 프로젝트 디렉터리에서 Codex MCP 목록에 `playwright`, `mcp-search`, `openaiDeveloperDocs`가 표시되는지 확인한다.
4. Playwright 패키지 `0.0.78`의 실행 가능 여부를 확인한다.
5. 변경 후 안정적인 비-Codex 설정 파일의 전체 SHA-256과 `~/.claude.json`의 전역 및 현재 프로젝트 MCP 의미 SHA-256이 변경 전과 모두 같은지 비교한다.
6. Git diff가 `.codex/config.toml`, 이 설계 문서, 구현 계획 외 기존 사용자 변경을 포함하지 않는지 경로 기준으로 확인한다.

비-Codex 무변경 검증 대상은 다음과 같다. 아래의 안정적인 파일 4개는 전체 파일 SHA-256으로 비교한다.

- `/home/gon/.claude/settings.json`
- `/home/gon/.config/Claude/claude_desktop_config.json`
- `/home/gon/.config/Code/User/mcp.json`
- `/home/gon/.config/opencode/opencode.json`

`/home/gon/.claude.json`은 Claude가 최상위 `pluginUsage` 텔레메트리를 실행 중 갱신하므로 전체 파일 해시로 비교하지 않는다. 기준선 직전 백업 `/home/gon/.claude/backups/.claude.json.backup.1784255546833`과 기준선을 비교했을 때도 바뀐 것은 `pluginUsage`뿐이며, 전역 `.mcpServers`와 현재 프로젝트의 `mcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `disabledMcpServers`, `mcpContextUris` 의미 해시는 같았다. 따라서 전역 필드 1개와 현재 프로젝트 필드 5개만 `jq -cS`로 정규화해 SHA-256을 비교한다. 다른 프로젝트의 Claude MCP 구성까지 무변경이라고 주장하지 않는다.

## 롤백

`.codex/config.toml`의 Playwright 테이블 또는 파일 자체를 제거하면 이전 Codex 구성으로 돌아간다. 다른 호스트 설정은 처음부터 변경하지 않으므로 별도 롤백이 없다.
