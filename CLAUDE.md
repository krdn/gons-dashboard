# gons-dashboard

개인 사용자 대시보드. 도메인을 단계별로 늘려가는 통합 워크스페이스.

## 프로젝트 개요

- **목표**: 개인 생산성을 높이는 통합 대시보드
- **도메인 (현재)**:
  - **Email 분석** — Gmail 폴링 → LLM 분류(important/reply-needed) → 위젯 표시·푸시
  - **Server Infra Monitor** — 등록된 Docker host들의 컨테이너 상태·프로젝트 묶음·재시작 액션(감사 로그)
- **확장 방향**: 캘린더, 할 일, 노트 등 도메인을 점진 추가
- **아키텍처**: FSD (Feature-Sliced Design)
- **문서 언어**: 한국어 (코드·식별자는 영어)

## Quick Start

```bash
pnpm install
cp .env.example .env          # 필수 값 채우기 (아래 "환경 변수" 참조)
pnpm db:generate              # 스키마 변경 시
pnpm db:migrate               # 운영 DB(192.168.0.5:5440)에 마이그레이션 적용
pnpm db:seed:hosts            # 호스트 등록 (home-server, krdn-lenovo)
pnpm db:seed:projects         # 프로젝트 메타(한글명/카테고리/URL) 시드 — 선택
pnpm dev                      # http://localhost:3020
```

검증 명령:

```bash
pnpm typecheck                # tsc --noEmit
pnpm lint                     # ESLint (FSD boundary 규칙 포함)
pnpm test                     # vitest run (DB 통합은 TEST_DATABASE_URL 필요)
pnpm build                    # 운영 production build 검증
```

DB 정비:

```bash
pnpm db:cleanup-projects               # dry-run: 좀비 project row 식별
pnpm db:cleanup-projects --apply       # 실제 삭제
```

## 기술 스택

- **프레임워크**: Next.js 16 (App Router, RSC + Server Actions, Turbopack)
- **언어**: TypeScript (strict)
- **패키지 매니저**: pnpm
- **DB**: PostgreSQL 16 + Drizzle ORM
- **인증**: NextAuth v5 + Drizzle adapter (Google OAuth)
- **스타일링**: Tailwind CSS v4 + 디자인 토큰(`globals.css`) — **라이트 모드 고정** (`@variant dark (&:where(.dark, .dark *))` 로 미디어쿼리 dark variant 차단)
- **상태**: TanStack Query, Zustand (도입 완료)
- **검증**: Zod (`shared/config/env.ts` 부팅 시점 검증)
- **테스트**: Vitest (unit/integration) + setup hard-block (prod DB 가드)
- **알림**: web-push (VAPID)
- **AI**: Anthropic SDK → Claude Code CLI Proxy (`ANTHROPIC_BASE_URL`)

## FSD 아키텍처

`~/.claude/rules/fsd-architecture.md` + ESLint `eslint-plugin-boundaries` 로 강제.

```
src/
├── app/         # Next.js App Router (라우팅 + 레이아웃 + API routes)
├── widgets/     # 조합 컴포넌트 (host-dashboard, email-digest, important-emails, server-overview)
├── features/   # 기능 (auth, container-actions, container-list, email-analysis, gmail-sync, host-catalog)
│   └── <name>/{ui,model,api,lib}
├── entities/   # 엔티티 (container, digest, email, host, project)
│   └── <name>/{ui,model,api}
└── shared/     # 공유 (ui, lib, api, config)
```

**의존성 방향**: `app → widgets → features → entities → shared` (상위만 하위 참조).
각 슬라이스는 `index.ts` (barrel) 로 public API 노출.

**같은 레이어 예외**: `features → features` 만 의도적으로 허용 (eslint config 참조). entities 간 직접 참조는 금지.

## Gotcha (필수 — 같은 실수 반복 방지)

### 1. Client 컴포넌트에서 `entities/*` barrel 사용 금지

`entities/container/index.ts`, `entities/project/index.ts` 등 barrel은 server-only API (`listContainers` → `node:child_process`) 를 함께 export. `import type` 만 해도 Turbopack 이 barrel 전체를 client 번들로 끌어와 빌드 실패한다. **클라이언트 트리에서 쓰일 UI/타입은 깊은 경로로 직접 import**:

```ts
// ✗ "use client" 트리에서 깨짐
import { ContainerRow, type ContainerSummary } from "@/entities/container";

// ✓
import { ContainerRow } from "@/entities/container/ui/ContainerRow";
import type { ContainerSummary } from "@/entities/container/model/types";
```

### 2. 통합 테스트는 `TEST_DATABASE_URL` 필수

`tests/setup.ts` 가 `192.168.0.5` / `gons.krdn.kr` 향한 `DATABASE_URL` 을 throw 로 차단 (prod DB 오염 사고 이후 안전장치). 로컬 unit/integration 실행 시:

```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```

DB 미연결 통합 테스트는 `ECONNREFUSED` 로 fail — pure unit 테스트만 통과해도 OK.

로컬 테스트 DB가 필요하면:

```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```

### 3. Locale 의존 포맷팅은 hydration mismatch

서버 Node 는 ICU minimal 로 ko 로케일이 없어 `"오후 04:33"`, 브라우저는 `"PM 04:33"` 으로 렌더 → hydration 실패. **클라이언트에서 시각을 표시할 때는 locale-free `HH:MM:SS` 포맷** 사용. (서버 RSC 안에서만 쓰는 `toLocaleString("ko-KR")` 은 안전.)

### 4. Compose project 자동 등록 (화이트리스트 폐지)

`upsertProjectFromContainer` 가 처음 보는 compose 라벨을 즉시 DB 에 등록. `src/entities/project/config/knownComposeProjects.ts` 는 더 이상 게이트가 아니라 **메타 hint + cleanup pinned set** 용도. 한글 displayName/카테고리/URL 을 부여하고 싶을 때만 `seed-projects.ts` 와 함께 갱신.

### 5. Drizzle hidden-thrash 방지 (서버 상세 페이지)

`src/app/servers/[hostName]/page.tsx` 는 display 용 (`getProjects`, hidden=false) 과 dedup 용 (`getProjectComposeKeys`, hidden 포함) project 키 set 을 분리해야 한다. 하나만 쓰면 hidden project 가 매 요청마다 unknown 으로 분류돼 `onConflictDoUpdate` 가 트리거되는 thrash 가 재현된다.

## 환경 변수

`.env.example` 에 전체 목록. 부팅 시 `shared/config/env.ts` 가 Zod 로 검증해 빈 값/잘못된 형식이면 즉시 throw.

| 그룹 | 변수 | 필수 |
|------|------|------|
| LLM Proxy | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | ✓ |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✓ |
| NextAuth | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | ✓ |
| DB / Cache | `DATABASE_URL`, `REDIS_URL` | ✓ |
| Cron | `CRON_BEARER_TOKEN` | ✓ |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | ✓ |
| 운영 알림 | `OPS_NOTIFY_EMAIL` | ✓ (Zod email 검증) |
| pgcrypto | `PG_ENCRYPTION_KEY` | ✓ (refresh token at-rest) |
| Timezone | `TZ=Asia/Seoul` | ✓ (KST cron 정확성) |
| Server Monitor | `DOCKER_DEFAULT_CONTEXT=home-server`, `DOCKER_CMD_TIMEOUT_MS=10000`, `ADMIN_EMAILS` | ✓ |

**시크릿은 어떤 형태로도 저장소에 커밋 금지** — README, 주석, 마크다운 본문 포함.

## 운영 배포

| 항목 | 값 |
|------|-----|
| 운영 서버 | `192.168.0.5` (docker context `home-server`, alias `dserver` / `dcserver`) |
| 외부 URL | `https://gons.krdn.kr` |
| compose 경로 (서버) | `/home/gon/projects/gon/gons-dashboard/docker-compose.yml` |
| 이미지 | `ghcr.io/krdn/gons-dashboard:latest` (app), `ghcr.io/krdn/gons-dashboard-cron:latest` (cron) |
| 포트 | app `3020`, postgres `5440`, redis `6390` |
| CI | GitHub Actions `CI` 워크플로 (Lint & Type Check → Build & Push Docker Images on main) |

배포 흐름 (PR 머지 후):

```bash
gh run watch                                                              # Build & Push 완료 대기
docker --context home-server compose -f $COMPOSE pull app cron            # 새 이미지 받기
docker --context home-server compose -f $COMPOSE up -d app cron           # 교체 + healthcheck
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"            # {"status":"ok"} 확인
```

(`$COMPOSE` = `/home/gon/projects/gon/gons-dashboard/docker-compose.yml`)

## AI 호출 정책

Anthropic SDK 사용. 단, Anthropic API 직접이 아닌 **Claude Code CLI Proxy** 를 향한다. SDK가 표준 환경변수를 자동 인식하므로 추가 설정 불필요:

```typescript
// shared/lib/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
export const anthropic = new Anthropic(); // ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY 자동 인식
```

## Agent 보조 자료

- **Issue tracker**: GitHub Issues (`krdn/gons-dashboard`), `gh` CLI — 상세는 `docs/agents/issue-tracker.md`
- **Triage labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` — 상세는 `docs/agents/triage-labels.md`
- **Domain docs**: 도메인 결정·용어 — `docs/agents/domain.md`
- **운영 절차**: 시크릿 회전, OAuth 갱신 등 — `docs/RUNBOOK.md`
- **설계/계획 산출물**: `docs/superpowers/{specs,plans}/<date>-<topic>.md`
- **v0.1 후속 작업 backlog**: `TODOS.md` (의도적으로 v0.1 범위 외인 항목)

## 응답 규칙

- 한국어 응답 + 코드 영어는 글로벌 `~/.claude/rules/korean-response.md` 가 강제 (별도 명시 불필요).
- **시크릿은 메모리/메시지에 평문으로 남기지 않는다** — 항상 `.env` 와 변수명으로만 지칭.
