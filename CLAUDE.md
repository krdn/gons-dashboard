# gons-dashboard

개인 사용자 대시보드. 도메인을 단계별로 늘려가는 통합 워크스페이스.

## 프로젝트 개요

- **목표**: 개인 생산성을 높이는 통합 대시보드
- **도메인 (현재)**:
  - **Email 분석** — Gmail 폴링 → LLM 분류(important/reply-needed) → 위젯 표시·푸시
  - **Server Infra Monitor** — 등록된 Docker host들의 컨테이너 상태·프로젝트 묶음·재시작 액션(감사 로그)
  - **Saju (사주)** — 외부 빌더 `@krdn/saju` (github:krdn/saju) 소비 + Tri-nation (Korean / Chinese / Japanese) lifetime·yearly·monthly·daily 학파별 narrative
  - **Stock Analysis (증권 종목)** — `packages/stock-analysis` + Yahoo Finance/KRX adapter + 페르소나 5명 + consensus + lazy fetch + flip 알림 (Phase 1~8 진행 중)
  - **Calendar / Tiger Reading / Fortune Profile** — `packages/mcp-calendar` 외 보조 위젯
- **확장 방향**: 할 일, 노트 등 도메인을 점진 추가
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

운영 DB(`192.168.0.5` / `gons.krdn.kr`) 향한 `db:seed:*`, `db:cleanup-projects`, `fix-oauth-scope` 실행 시 가드가 ack 요구:

```bash
# CLI 플래그
pnpm db:seed:hosts --i-know-this-is-prod
# 또는 환경 변수
I_KNOW_THIS_IS_PROD=1 pnpm db:seed:hosts
```

dev DB (`localhost` / `127.0.0.1`) 면 가드 통과로 평소처럼 실행.

## 레포 레이아웃 (monorepo)

pnpm workspaces 모노레포. dashboard와 cron 컨테이너가 각각 `apps/` 하위 패키지.

```
gons-dashboard/
├── apps/
│   ├── dashboard/   # Next.js 앱 (@gons/dashboard)
│   └── cron/        # node-cron 컨테이너 (@gons/cron) — 매시간 /api/cron/* 호출
└── packages/        # 도메인 라이브러리 + MCP 서버
    ├── stock-analysis/      # @gons/stock-analysis — 페르소나 + consensus + adapter
    ├── mcp-calendar/        # @gons/mcp-calendar — Google Calendar MCP 서버
    ├── shared-google/       # @gons/shared-google — Google API 공통 (token mediator client)
    └── shared-mcp-runtime/  # @gons/shared-mcp-runtime — MCP stdio + in-process 공통

# 외부 GitHub 패키지 (dashboard 의존, 로컬 packages/ 아님):
#   @krdn/saju       (github:krdn/saju#v1.2.2)       — 사주 빌더 (학파별 lifetime/yearly/monthly/daily)
#   @krdn/tickerlens (github:krdn/tickerlens#v0.1.3) — stock 타임프레임 adapter
```

신규 도메인/MCP 추가 패턴은 아래 "MCP 도구 호출 정책" 섹션 참조.

root의 `pnpm <script>`는 `apps/dashboard`로 위임하는 thin proxy. CLAUDE.md
하위 명령(`pnpm dev`, `pnpm typecheck` 등)은 그대로 동작. 직접 `apps/dashboard/`에
들어가 실행해도 동일하다. cron은 Docker로만 빌드(GHA가 `apps/cron`을 컨텍스트로
`ghcr.io/krdn/gons-dashboard-cron:latest` 푸시).

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

### 1. ~~Client 컴포넌트에서 `entities/*` barrel 사용 금지~~ (해소됨)

**친구션 #3 으로 해소** — `entities/container/index.ts` 와 `entities/project/index.ts` 가 폐지되고 `server.ts` + `client.ts` 두 진입점으로 분리됨. Module interface 가 *환경 (server vs client)* 을 import path 에 명시 표현. 옛 *깊은 경로 우회* 가이드라인 불필요.

**현재 권장**:
```ts
// server tree (RSC, API route, Server Action, scripts)
import { listContainers, type ContainerSummary } from "@/entities/container/server";
import { getProjects, type Project } from "@/entities/project/server";

// client tree ("use client")
import { ContainerRow, type ContainerSummary } from "@/entities/container/client";
import { ProjectCard } from "@/entities/project/client";
```

다른 entity (email, host, digest, saju-chart, fortune-profile) 는 *server/client 혼재 통증이 드러나지 않은 상태* — 현재 `index.ts` 단일 barrel 유지. 새 entity 추가 시 혼재가 발생하면 같은 패턴 (`server.ts` + `client.ts`) 권장. Design spec: `docs/superpowers/specs/2026-05-15-entity-barrel-seam-deepening.md`.

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

### 6. OAuth scope 변경은 자동 회복 — events.signIn refreshAccountTokens

`@auth/drizzle-adapter` 의 `linkAccount` 는 PK 충돌 시 silent fail (INSERT-only). 새 scope 또는 rotated refresh token 으로 재로그인해도 기존 `accounts` row 의 토큰 필드가 **자동으로 갱신되지 않는다**. `events.signIn` 에서 `refreshAccountTokens(db, account)` 를 호출해 명시 UPDATE 하도록 핫픽스 완료 (2026-05-12 Calendar MCP scope 사고 이후). NextAuth scope 배열에 새 항목을 추가할 때 사용자별 `DELETE FROM accounts; 재로그인` 절차는 더 이상 필요 없음 — 사용자가 한 번 재로그인하면 새 scope 가 자동으로 반영된다.

회복 안 될 때만 폴백: `scripts/fix-oauth-scope.ts` (accounts row DELETE → fresh INSERT).

### 7. features barrel server/client seam (Phase 6 사고 + 패턴)

`features/<name>/index.ts` 가 server-only 함수 (postgres 등 Node-only 의존) 와 `"use server"` Server Action 을 동시에 export 하면, client 컴포넌트가 그 barrel 을 import 하는 순간 next build 가 `Module not found: Can't resolve 'tls' / 'perf_hooks' / 'net'` 으로 실패한다. Server Action 의 RPC 경계 (`"use server"`) 는 함수 단위지만 import 는 모듈 단위라, 같은 barrel 의 다른 server-only export 가 함께 client bundle 그래프로 끌려간다.

**해결 패턴**: entity barrel seam (Gotcha #1 의 server.ts + client.ts) 을 features 에도 미러:
- `features/<name>/index.ts` — server entrypoint (`import "server-only"` + server-only 함수 export)
- `features/<name>/client.ts` — RPC 경계가 있는 Server Action 만 re-export
- `"use client"` 컴포넌트 는 `@/features/<name>/client` 로만 import

**적용 예시**: `features/stock-analysis-server/` 가 `analyzeStock` (server-only) + `triggerAnalysis` ("use server") 동시 export → Phase 6 PR-back 사고. 이후 server.ts + client.ts 분리 패턴 적용.

**검증**: `pnpm typecheck && pnpm lint` 만으로는 못 잡는다 — `cd apps/dashboard && pnpm build` 를 PR 전 1회 실행 필수. CI 에서 잡히면 PR-back fix 사이클이 추가됨.

### 8. 운영 compose+env 백업 필수 — working_dir 실종 시 다운

운영 서버 `192.168.0.5:/home/gon/projects/gon/gons-dashboard/` 의 `docker-compose.yml` + `.env` 가 사라지면 `docker compose up` 시 빈 env 로 컨테이너가 재생성되어 Zod 검증 실패 → 운영 다운. 2026-05-21 발생 사고 — 원인 불명, 디렉토리 root 소유로 root 권한 cleanup 가능성.

**백업 위치**: `~/.gstack/projects/gons-dashboard/secrets/prod.env.YYYYMMDD-HHMMSS` (mode 600). 1Password Secure Note 에 추가 보관 권장.

**복구 절차**:
1. 로컬 레포 `docker-compose.yml` 을 운영 working_dir 에 `scp` + `sudo cp` (root 소유 디렉토리)
2. 백업 .env 동일 위치로 복원
3. `docker exec gons-dashboard-postgres psql -U gons -c "ALTER USER gons WITH PASSWORD '<env-pw>'"` (pg_hba.conf `local all all trust` 덕에 비밀번호 없이 접근 가능 — DB 비밀번호 잃어도 회복 가능)
4. `docker compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml --env-file /home/gon/projects/gon/gons-dashboard/.env up -d --force-recreate`
5. `curl http://localhost:3020/api/health` → 200 확인

⚠️ ssh 한 줄 `cd && docker compose` 는 cwd 인식 안 됨 — **`-f <abs-path> --env-file <abs-path>` 명시** 필수.

### 9. PostgreSQL timestamptz::date 는 IMMUTABLE 아님 — expression index 거부

`CREATE INDEX ... ON tbl ((some_timestamptz::date))` 는 `functions in index expression must be marked IMMUTABLE` 로 거부. timestamptz 의 `::date` 캐스트는 timezone 의존이라 IMMUTABLE 못 만족.

**해결 패턴 (Phase 7 stock_consensus_flips 적용)**: KST 자정 기준 generated column 추가 후 그 컬럼에 index.

```sql
ALTER TABLE tbl ADD COLUMN d date
  GENERATED ALWAYS AS (((ts AT TIME ZONE 'Asia/Seoul')::date)) STORED;
CREATE UNIQUE INDEX uq ON tbl (... , d);
```

Drizzle 0.30+ 의 `generatedAlwaysAs(sql\`...\`)` API 로 schema 표현 가능. 단, drizzle-kit 가 generated 속성을 인지하려면 `generatedAlwaysAs` 명시 필수 — 빠뜨리면 다음 db:generate 가 DROP+ADD 의 spurious diff 생성.

### 10. LLM Proxy ≠ NextAuth Google OAuth

`ANTHROPIC_BASE_URL=http://192.168.0.5:8317` 의 cli-proxy-api 는 **LLM 추론 통합 endpoint** (Claude/Gemini/Codex 라우팅). `GOOGLE_CLIENT_ID/SECRET` 의 NextAuth Google OAuth 는 **사용자 웹 로그인 + Gmail/Calendar scope** — 둘은 서로 대체 불가. 자세한 차이는 "AI 호출 정책 — LLM Proxy 정의" 섹션의 비교 표 참조.

자주 헷갈리는 시나리오: LLM 추론은 정상 동작하는데 (proxy 통해) NextAuth 로그인은 `changeme-*` placeholder 라 안 됨 → 둘은 별개 흐름이라 로그인 안 돼도 LLM 호출은 정상.

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
| Saju LLM | `SAJU_LLM_MODEL`, `SAJU_LLM_TEMPERATURE`, `SAJU_LLM_DAILY_BUDGET_KRW` | ✓ (saju 도메인 활성 시) |
| Stock | `KRX_DATA_GO_KR_API_KEY` (KRX 종목 마스터) | ✓ (stock-analysis 활성 시) |
| MCP / PlayMCP | `MCP_DASHBOARD_TOKEN`, `PLAYMCP_GATEWAY_URL`, `PLAYMCP_CLIENT_ID`, `PLAYMCP_BOOTSTRAP_OTT` | ✓ (MCP stdio + PlayMCP 게이트웨이 사용 시) |

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

## AI 호출 정책 — LLM Proxy 정의

### LLM Proxy 란

운영 서버에서 도는 **`cli-proxy-api`** 컨테이너 (`192.168.0.5:8317`, image `eceasy/cli-proxy-api`). Claude / Codex / Gemini 셋을 **단일 OpenAI/Anthropic 호환 endpoint** 로 묶어 제공.

- **인증 방식**: 각 모델의 CLI tool (Claude Code CLI, Codex CLI, Gemini CLI) 이 사전에 OAuth 로 로그인해 발급한 **auth file** (`/home/gon/projects/cli-proxy-api/auths/{claude,gemini,codex}-krdn.net@gmail.com-*.json`) 을 proxy 가 읽어 토큰 자동 갱신.
- **결과**: dashboard 는 **API key 발급 없이** Claude/Gemini/Codex 모두 사용. 토큰 비용은 CLI 의 사용 한도 (예: Claude Code 의 Pro/Max plan) 안에서 처리.
- **dashboard `.env`** 의 `ANTHROPIC_BASE_URL=http://192.168.0.5:8317` + `ANTHROPIC_API_KEY=my-proxy-key` 만 설정 → Anthropic SDK 가 표준 환경변수를 인식해 자동으로 proxy 로 라우팅.

```typescript
// shared/lib/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
export const anthropic = new Anthropic(); // ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY 자동 인식
```

### 모델 라우팅 — proxy 가 `model` 문자열로 분기

- `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` → Claude Code CLI auth
- `gpt-5.3-codex` → Codex CLI auth
- `gemini-2.5-pro` → Gemini CLI auth

`SAJU_LLM_MODEL_CLAUDE/CODEX/GEMINI` 가 페르소나/학파별로 분기. saju 는 [`shared/lib/llm/saju-model-registry.ts`](apps/dashboard/src/shared/lib/llm/saju-model-registry.ts) + `features/saju-model-picker` 가 모델 선택, stock-analysis 는 [`entities/stock-analysis/api/persona-router.ts`](apps/dashboard/src/entities/stock-analysis/api/persona-router.ts) 가 페르소나별 override 적용.

### ⚠️ NextAuth Google OAuth 와 LLM Proxy 는 **완전히 별개**

같이 헷갈리지 말 것 — 두 흐름은 목적도 인증 주체도 다르다:

| 항목 | NextAuth Google OAuth | LLM Proxy (cli-proxy-api) |
|---|---|---|
| 환경변수 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` |
| 목적 | 사용자 웹 **로그인** + Gmail/Calendar API scope | LLM **추론** API 호출 (Claude/Gemini/Codex) |
| 인증 주체 | 사용자 본인 브라우저 | 운영 컨테이너 (server-to-server) |
| OAuth Client | Google Cloud Console 에 별도 발급 | (proxy 내부에서 Gemini CLI 가 자체 발급한 Client 와 token 사용) |
| 만료/갱신 | refresh token 으로 events.signIn 시 자동 갱신 | proxy 가 auth file watch + 15분 주기 자동 갱신 |
| Down 시 영향 | 사용자 로그인 불가 | LLM 호출 불가 (페르소나 분석, 사주 narrative 모두 fail) |

**한 쪽을 다른 쪽으로 대체할 수 없다.** LLM Proxy 의 auth file 에 들어있는 `client_id` / `client_secret` 은 Gemini CLI 가 자체 발급한 OAuth Client 의 자격이라 redirect URI 가 NextAuth 와 다르고, scope 도 (`cloud-platform`, `userinfo.email`) NextAuth Google provider 의 (`openid email profile`) 와 다름. 재사용 시도하면 redirect URI 추가가 필요한데 그 Client 자체가 Gemini CLI 가 관리하는 자동 생성 프로젝트라 수정 위험.

## MCP 도구 호출 정책

`packages/mcp-*` 의 도구 함수는 두 경로로 호출된다:

1. **In-process (대시보드 RSC)**: 위젯이 `import { makeXxxTool } from "@gons/mcp-xxx"` → 토큰은 같은 프로세스의 mediator 라우트(`/api/mcp/credentials/*`)에서 받아옴 (절대 URL — `NEXTAUTH_URL` 베이스).
2. **Stdio (Claude Code)**: `packages/mcp-*/dist/cli.js`가 자식 프로세스로 spawn → `MCP_DASHBOARD_URL` 환경변수로 mediator HTTPS 호출.

OAuth refresh token은 `apps/dashboard`의 `accounts` 테이블에만 존재 (pgcrypto). MCP 패키지는 절대 refresh token을 보지 못한다 — mediator가 발급하는 5분 access token만 사용.

신규 도메인 MCP 추가 시: `packages/mcp-<domain>` + `packages/shared-<provider>` (이미 있으면 재사용) + dashboard에 `/api/mcp/credentials/<provider>` mediator. spec 패턴 — `docs/superpowers/specs/2026-05-12-hybrid-mcp-api-domains-design.md`.

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

## Health Stack

`/health` 스킬이 사용하는 도구 목록.

- typecheck: `pnpm typecheck`
- lint: `pnpm lint`
- test: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test` (로컬 DB 미기동 시 통합 13개 ECONNREFUSED — Gotcha #2 참조)
