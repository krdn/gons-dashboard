# Claude Code 글로벌 하네스 최적화 감사 (2026-06-18, 2차)

> 1차 감사(`2026-06-18-claude-config-audit.md`)는 죽은 설정 제거(Ruflo/claude-flow) 중심.
> 이번 2차는 그 이후 남은 환경의 **성능·정합성·위생·보안·플러그인 비용·구조** 6차원 정밀 튜닝.
> 방법: 57-에이전트 읽기 전용 Workflow(차원별 감사 → 적대적 검증 → 통합). 50개 발견 중 **37 통과 / 13 반박**.

## 총평

하네스는 전반적으로 건강. 실질 조치 대상 두 가지:
1. **z.ai API 키가 평문으로 5곳 산재** (설정 2 + append-only 로그 2 + .zshrc) → **키 회전만이 완전 대응** (로그 사본은 파일 수정으로 회수 불가).
2. **Ruflo 마켓플레이스가 1차 감사 직후 114M로 재클론** → `known_marketplaces.json` 등록이 남아 좀비. **단 autoUpdate 재클론 메커니즘은 없음**(아래 검증) — 등록 제거로 영구 정리 가능.

나머지는 토큰 절감(사용자 skill 가지치기 ~7.5K tok/세션 중 gstack-family ~66%)과 디스크 위생. 대부분 가역·저위험.

`rules/ecc/**`, `plugins/**`(autoUpdate 산출물)는 어떤 항목도 삭제 대상 아님 — 설정 토글 또는 `/plugin` CLI 경로만.

## 검증된 핵심 사실 (이번 세션 1차 재현)

- **ruflo 재클론 메커니즘 = 없음**: `settings.json extraKnownMarketplaces`에 ruflo 항목 **부재**. `plugins/known_marketplaces.json`에만 등록(`repo: ruvnet/ruflo`, `lastUpdated 2026-06-18T01:39`). `pluginUsage.lastUsedAt`은 옛 epoch — 오늘 touch는 이 감사 Workflow가 경로를 읽은 흔적. → 등록 제거 시 재클론 없음.
- **A3 gitignore 갭**: `ruvector.db`(1.5M)·`bash-commands.log`(5.5M)·`cost-tracker.log`(5.8M) 모두 **untracked + NOT ignored**. 기존 `.gitignore`는 `logs/`만 무시(루트 `*.log` 누락). → gitignore 추가만으로 부작용 0, 완전 가역.

---

## 그룹 A — 즉시 적용 안전 (가역 + 부작용 0)

| # | 항목 | 변경 | 효과 |
|---|------|------|------|
| **A3** | gitignore 갭 | `~/.claude/.gitignore`에 `ruvector.db`, `bash-commands.log`, `cost-tracker.log` 추가 | dotfiles repo에 ~12.8MB 런타임 산출물 + 명령이력(프라이버시) 실수 커밋 방지 |

> A1(.zshrc chmod 600), A5(voltagent 마켓플레이스 정리)는 안전하나 **사용자 환경 부수효과 가능**하므로 그룹 B로 신중 이동(아래).

## 그룹 B — 사용자 승인/판단 필요

| # | 항목 | 변경 | 판단 포인트 |
|---|------|------|------------|
| **A2** | **z.ai 키 회전 (사용자 액션, Claude 불가)** | z.ai 콘솔에서 rotate → `settings.zai.json` `env.ANTHROPIC_AUTH_TOKEN` + `.zshrc` `export ZAI_API_KEY=` 새 값 (또는 `source ~/.zai-secret` 600 분리) | append-only 로그 평문 사본은 회전만이 무력화. **다른 모든 보안 보조책의 선행 조건** |
| **A1** | .zshrc 권한 | `chmod 600 ~/.zshrc` (현재 644) | A2 보조. 단독 불충분 |
| **B4** | 로그 절단 | `: > bash-commands.log`, `: > cost-tracker.log` (가역 아님) | **A2 회전 선행 필수**(로그에 평문 키) |
| **B1** | Ruflo 재제거 | `/plugin marketplace remove ruflo` → `known_marketplaces.json` 등록 + `marketplaces/ruflo`(114M) 정리 | autoUpdate 없음 확인됨 → 안전. `github:ruvnet/ruflo` 재클론 가능(가역) |
| **A5** | voltagent 고아 마켓플레이스 | `/plugin marketplace remove voltagent-subagents` + stale 레코드 | enabledPlugins 0건. 디스크 ~2.1M |
| **B2** | 사용자 skill 가지치기 (최대 토큰 레버) | 안 쓰는 skill을 `~/.claude/skills/`에서 제거. 1순위 gstack-family ~35개(desc ~19.9KB) | ⚠️ **글로벌 결정 — 다른 repo의 frontend 작업서 쓸 수 있음. 사용자 확인 필수**. gstack 런타임(`~/.gstack/` 운영 백업)은 건드리지 말 것 |
| **A4** | GSD 삭제 커밋 (advisor 교정: 안전 아님) | working tree의 GSD 경로만 명시 커밋 | ⚠️ **6/12 cleanup의 미커밋 잔재(내가 만든 것 아님)**. `git add -A` 금지(시크릿/autoUpdate 휩쓸림 — `env-bak-secret-scanning-gotcha`). 사용자 명시 요청 시에만 |
| **B3** | stale 백업 정리 | `rm -rf _audit-backup-20260618`(19M, 오늘 생성) + `_context-cleanup-20260612`(8M) | _audit-backup은 1차 감사 롤백 안전망 → 1~2주 안정 후 |
| **B5** | stale 파일 | `strings_dump.txt`(29M), `backups/credentials-archive/` OAuth 백업 3건 | 사용 여부 확인 |

## 그룹 C — 정보성 (행동 불필요)

- **allow가 ask 게이트 우회** (LOW): `settings.json` ask=[docker,curl]가 `settings.local.json`의 `Bash(bash *)` 등으로 우회. deny 0 + `defaultMode:auto`+`skipAutoPermissionPrompt:true`라 게이트 효력 제한적. 정직하게 하려면 ask 2줄 제거 또는 deny 승격.
- **글로벌 CLAUDE.md L5 rules 글로브 서술 오해**: "`rules/**/*.md` 자동 로드"는 산문 — 실제론 frontmatter `paths:` 조건부 스택 로드.
- **pluginUsage=0 ≠ 미사용** (방법론 가드, MEDIUM): 9개 플러그인이 2026-06-05 06:56 동일 ms로 일괄 0 리셋. **향후 비활성 판정은 `pluginUsage=0 AND skillUsage 0 AND enabledPlugins 부재` 3중 교차** — 단일 카운터 오제거 금지(rtk dead-file 오판과 동형).

### 확인 완료 — 손대지 말 것 (오판 방지)

- `homunculus/`(1.3M): session-start.js 활성 참조 — 고아 아님
- `backups/`(980K): .claude.json 네이티브 로테이션(5개 캡)
- `security/agent-sdk-venv`(299M): security-guidance 런타임 venv, 라이브 hook
- `ecc`(261 skills+64 agents): 최대 입력원이나 대부분 name-only 렌더 + autoUpdate 불가침 → 조치 불가, B2가 우선
- `ENABLE_TOOL_SEARCH=true`: MCP 도구 수백 개 name-only(스키마 미로드) — 잘 된 설정, 유지
- chrome-devtools(882M)·vercel(353M)·temp_git*·ecc dual-install: autoUpdate plugins/** 불가침 → 반박됨

## 권장 실행 순서

A2(키 회전, 사용자) → A1 → B4(회전 후) → **A3(즉시)** → A5/B1 → B2(확인 후) → A4/B3/B5(안정화·확인 후).

> Claude의 즉시 안전 적용 가능 범위 = **A3뿐**. 나머지는 사용자 액션(A2) 또는 승인 대기.
