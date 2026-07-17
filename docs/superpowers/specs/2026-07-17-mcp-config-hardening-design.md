# MCP 구성 하드닝 설계

**날짜:** 2026-07-17  
**범위:** Codex, Claude Code/Desktop, VS Code, OpenCode, mcporter의 사용자·프로젝트 MCP 구성

## 목표

현재 5개 호스트에 분산된 MCP 등록을 최소 권한과 재현 가능한 버전으로 정리한다. 구형 서버와 과도한 파일·Docker 권한을 축소하고, 설정 및 편집기 동기화 영역에 남은 평문 자격증명을 제거한다. `gons-dashboard`의 브라우저 검증과 프로젝트 전용 캘린더 도구는 유지한다.

## 비목표

- GitHub 또는 Tavily 웹 콘솔에서 토큰을 실제 폐기·재발급하지 않는다.
- 사용자의 Slack, Google Drive, Zapier 연결을 사용 여부 확인 없이 해제하지 않는다.
- PostgreSQL, Redis, Sentry, Exa 등 새로운 외부 MCP를 추측으로 추가하지 않는다.
- 기존 저장소의 미커밋 작업을 수정하거나 정리하지 않는다.

## 접근법 비교

### 1. 단계적 하드닝 — 채택

고위험 구성을 먼저 제거하거나 비활성화하고, 실제 사용 근거가 있는 서버는 유지한다. 토큰의 외부 회전은 별도 체크포인트로 남긴다. 변경은 가역적인 `enabled: false`와 범위 축소를 우선 사용한다.

장점은 서비스 중단과 과잉 삭제 가능성이 가장 낮다는 점이다. 단점은 비활성 항목이 설정 파일에 일부 남는다는 점이다.

### 2. 공격적 최소화

최근 호출이 없는 모든 MCP와 사용 근거가 약한 원격 커넥터를 즉시 삭제한다. 도구 표면은 가장 작아지지만, 다른 프로젝트나 개인 워크플로에서 사용하는 연결을 끊을 위험이 크다.

### 3. 보안 항목만 수정

평문 키와 구형 GitHub MCP만 정리한다. 중단 위험은 가장 낮지만 Docker context 오조작, 전역 프로젝트 도구, `@latest` 공급망 드리프트가 남는다.

## 설계

### 자격증명

- Claude Desktop의 구형 `@modelcontextprotocol/server-github` 등록을 제거한다.
- 현재 GitHub PAT 문자열을 Claude Desktop 설정과 VS Code History에서 제거한다. 원격 계정의 토큰 폐기는 사용자 체크포인트로 보고한다.
- VS Code Tavily는 평문 키 대신 secret input 참조를 사용한다. 현재 키 문자열은 `mcp.json`과 로컬 Settings Sync 사본에서 제거한다.
- 비밀값은 백업 파일에 복제하지 않는다. 구조 백업이 필요하면 값이 제거된 설정만 보존한다.

### 권한과 범위

- Claude Desktop filesystem 허용 범위를 `/home/gon`에서 현재 저장소로 축소한다.
- OpenCode Docker MCP는 삭제 대신 기본 비활성화한다. 운영 Docker는 저장소 RUNBOOK의 `docker --context home-server` CLI 경로만 사용한다.
- `gons-calendar`는 글로벌 사용자 범위에서 현재 프로젝트의 로컬 범위로 이동한다.

### 중복과 버전

- Playwright를 기본 브라우저 자동화 서버로 유지한다.
- Chrome DevTools는 Claude Code의 명시적 플러그인만 유지하고 VS Code에서는 제거, OpenCode에서는 비활성화한다.
- Claude Code Context7는 제거하지 않고 유지한다. 다른 프로젝트 사용 가능성이 있어 이번 단계에서는 전역 플러그인 상태를 바꾸지 않는다.
- VS Code/OpenCode의 직접 `npx` 등록은 감사 시점의 검증 버전으로 고정한다: Playwright `0.0.78`, Tavily `0.2.21`, Chrome DevTools `1.6.0`, Context7 `3.2.3`.

### 필요한 추가와 복구

- Codex에 Playwright `0.0.78`을 저장소 범위 `.codex/config.toml`로 추가한다.
- claude-mem은 사용 근거가 있으므로 제거하지 않고 공식 설치 명령으로 런타임을 복구한다.
- 공식 GitHub 원격 MCP는 VS Code/OpenCode에서 유지한다. Claude Desktop에는 자동으로 대체 등록하지 않는다. 필요 시 OAuth 연결을 별도 수행한다.

## 오류 처리와 롤백

- JSON/TOML 문법 검증 실패 시 해당 호스트 재시작이나 후속 변경을 중단한다.
- 서버 비활성화는 원래 설정 항목을 보존해 `enabled: true`로 되돌릴 수 있게 한다.
- 비밀값은 롤백 대상으로 보존하지 않는다. 토큰 재연결은 새 자격증명으로만 수행한다.
- claude-mem 설치가 대화형 인증 또는 외부 계정 작업을 요구하면 중단하고 필요한 사용자 작업을 보고한다.

## 검증

1. 모든 변경 JSON을 `jq empty`, TOML을 Codex 자체 목록 명령으로 파싱 검증한다.
2. `codex mcp list --json`, `claude mcp list`, `opencode mcp list`로 최종 등록·연결 상태를 확인한다.
3. 기존 GitHub PAT와 Tavily 키의 정확 문자열이 검사 대상 설정·History·Sync에 0건인지 확인한다. 값 자체는 출력하지 않는다.
4. Codex Playwright와 프로젝트 범위 `gons-calendar`이 보이는지 확인한다.
5. OpenCode Docker·Chrome DevTools가 비활성이고 공식 GitHub·Playwright·Tavily가 연결되는지 확인한다.
6. 기존 저장소 미커밋 변경은 건드리지 않았음을 변경 경로 기준으로 확인한다.

## 외부 체크포인트

로컬 정리 완료 후 사용자가 해야 할 작업은 두 가지다.

1. GitHub 설정에서 노출됐던 PAT를 폐기한다.
2. Tavily 키를 회전하고 VS Code의 secret input 요청에 새 키를 입력한다.

두 작업 전까지 로컬 평문은 제거되지만 기존 토큰 자체는 외부 서비스에서 유효할 수 있다.
