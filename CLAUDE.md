# gons-dashboard

개인 사용자 대시보드. 도메인을 단계별로 늘려가는 통합 워크스페이스.

## 프로젝트 개요

**FSD** 구조. 문서는 한국어, 코드·식별자는 영어. 도메인을 점진 추가한다 (다음 후보: 할 일, 노트).

| 도메인 | 핵심 흐름 / 진입점 |
|---|---|
| Email 분석 | Gmail 폴링 → LLM 분류(important/reply-needed) → 위젯 표시·푸시 |
| Server Infra Monitor | Docker host 컨테이너 상태·프로젝트 묶음·재시작 액션(감사 로그) |
| 실시간 관제 | 호스트 에이전트 push(vitals+checks) + docker stats cron + `cron_runs` 계측 + 이벤트 타임라인 + HTTP/SSL·systemd·호스트 cron 판정 + critical 알림(텔레그램/web-push) → `/monitoring`, `/monitoring/github` (에이전트: `scripts/monitoring-agent/`) |
| Saju (사주) | 외부 빌더 `@krdn/saju` 소비 + Tri-nation(한/중/일) lifetime·yearly·monthly·daily 학파별 narrative |
| Stock Analysis | `packages/stock-analysis` + Yahoo Finance/KRX adapter + 페르소나 5명 + consensus + lazy fetch + flip 알림 |
| Memo | 작성·관리 + LLM 변환 프리셋 (`features/memo-*`) |
| 카탈로그 (Skill/Plugin/Agent) | `~/.claude` 자산의 build-time JSON snapshot (`pnpm skills:snapshot` 등) + 한글화 overlay → `widgets/*-catalog` |
| 보조 위젯 | Calendar / Tiger Reading / Fortune Profile / Supplement Checker / Autopilot |

## Quick Start

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env   # 필수 값 채우기 (아래 "환경 변수" 참조)
                              # dev 는 apps/dashboard/.env, 운영 compose 는 루트 .env (별개 파일)
pnpm db:generate              # 스키마 변경 시
pnpm db:migrate               # dev DB 마이그레이션. ⚠️ 운영 DB 는 drizzle tracking 미인식 —
                              # 새 마이그레이션은 psql BEGIN/COMMIT 로 수동 선적용 후 이미지 배포
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

# 외부 GitHub 패키지 (dashboard 의존, 로컬 packages/ 아님 — 버전 핀은 package.json 이 권위):
#   @krdn/saju        — 사주 빌더 (학파별 lifetime/yearly/monthly/daily)
#   @krdn/tickerlens  — stock 타임프레임 adapter
#   @krdn/llm-gateway — LLM 호출 게이트웨이 (provider "claude-cli" → cli-proxy).
#                       GHA auto-update-llm-gateway 가 버전을 자동 갱신하므로 문서에 핀을 적지 않는다
#   @krdn/email       — 이메일 도메인 타입/스키마 공용
#   @krdn/gons-health — 영양제 상호작용 (supplement-checker 위젯)
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
- **상태**: RSC + 로컬 컴포넌트 상태 (TanStack Query·Zustand 는 실사용 없어 2026-07-16 의존성 제거)
- **검증**: Zod (`shared/config/env.ts` 부팅 시점 검증)
- **테스트**: Vitest (unit/integration) + setup hard-block (prod DB 가드)
- **알림**: web-push (VAPID)
- **AI**: `@krdn/llm-gateway` (provider `claude-cli`) → cli-proxy-api (`ANTHROPIC_BASE_URL`) — tier 별 최신 모델은 `resolveLatestModel` 런타임 선택

## FSD 아키텍처

`~/.claude/rules/fsd-architecture.md` + ESLint `eslint-plugin-boundaries` 로 강제.

```
src/
├── app/         # Next.js App Router (라우팅 + 레이아웃 + API routes)
├── widgets/     # 조합 컴포넌트 (host-dashboard, email-digest, saju-tri-*, stock-analysis, memo, skill-catalog …)
├── features/    # 기능 (auth, email-reply, memo-transform, saju-*-tri, stock-*, container-* …)
│   └── <name>/{ui,model,api,lib}
├── entities/    # 엔티티 (container, email, host, project, memo, stock-analysis, saju-chart …)
│   └── <name>/{ui,model,api}
└── shared/     # 공유 (ui, lib, api, config)
```

**의존성 방향**: `app → widgets → features → entities → shared` (상위만 하위 참조).
각 슬라이스는 `index.ts` (barrel) 로 public API 노출.

**같은 레이어 예외**: `features → features` 만 의도적으로 허용 (eslint config 참조). entities 간 직접 참조는 금지.

## Gotcha (필수 — 같은 실수 반복 방지)

### 1. entity barrel — 환경(server/client)을 import path 로 분리

`container` / `project` / `fortune-profile` 은 `index.ts` 가 **없다.** `server.ts` + `client.ts` 두 진입점뿐이다 — server 함수(db 의존)와 client 가 쓰는 타입·상수를 한 barrel 에 섞으면 client bundle 그래프로 함께 끌려간다.

```ts
// server tree (RSC, API route, Server Action, scripts)
import { listContainers, type ContainerSummary } from "@/entities/container/server";
// client tree ("use client")
import { ContainerRow } from "@/entities/container/client";
```

다른 entity (email, host, digest, saju-chart) 는 혼재 통증이 드러나지 않아 `index.ts` 단일 barrel 을 유지한다. 새 entity 에서 혼재가 생기면 같은 패턴을 적용할 것. Design spec: `docs/superpowers/specs/2026-05-15-entity-barrel-seam-deepening.md`. (features 레이어의 같은 문제는 #7)

⚠️ **옛 인용 주의**: 2026-05-15 이전 문서 (tiger-playmcp, saju-phase1 등) 가 "Gotcha #1" 을 *"UI 는 barrel 대신 깊은 경로로 직접 import"* 로 인용한다. 그 정책은 위 deepening 으로 **폐지됐다** — 지금은 `server.ts`/`client.ts` 진입점을 쓴다. 옛 문서의 그 지시는 따르지 말 것.

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

`src/app/(dashboard)/servers/[hostName]/page.tsx` 는 display 용 (`getProjects`, hidden=false) 과 dedup 용 (`getProjectComposeKeys`, hidden 포함) project 키 set 을 분리해야 한다. 하나만 쓰면 hidden project 가 매 요청마다 unknown 으로 분류돼 `onConflictDoUpdate` 가 트리거되는 thrash 가 재현된다.

### 6. OAuth scope 변경은 자동 회복 — events.signIn refreshAccountTokens

`@auth/drizzle-adapter` 의 `linkAccount` 는 PK 충돌 시 silent fail (INSERT-only). 새 scope 또는 rotated refresh token 으로 재로그인해도 기존 `accounts` row 의 토큰 필드가 **자동으로 갱신되지 않는다**. `events.signIn` 에서 `refreshAccountTokens(db, account)` 를 호출해 명시 UPDATE 하도록 핫픽스 완료 (2026-05-12 Calendar MCP scope 사고 이후). NextAuth scope 배열에 새 항목을 추가할 때 사용자별 `DELETE FROM accounts; 재로그인` 절차는 더 이상 필요 없음 — 사용자가 한 번 재로그인하면 새 scope 가 자동으로 반영된다.

회복 안 될 때만 폴백: `apps/dashboard/src/scripts/fix-oauth-scope.ts` (accounts row DELETE → fresh INSERT).

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
3. `docker exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c "ALTER USER gons WITH PASSWORD '<env-pw>'"` (pg_hba.conf `local all all trust` 덕에 비밀번호 없이 접근 가능 — DB 비밀번호 잃어도 회복 가능). **`-d gons_dashboard` 생략 금지** — psql 이 유저명과 같은 db("gons")를 찾다 `database "gons" does not exist` 로 실패한다
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

`ANTHROPIC_BASE_URL` 의 cli-proxy-api 는 **LLM 추론** endpoint, `GOOGLE_CLIENT_ID/SECRET` 의 NextAuth 는 **사용자 로그인 + Gmail/Calendar scope** — 서로 대체 불가다. 그래서 "LLM 호출은 정상인데 로그인만 안 됨" (또는 그 반대) 이 정상적으로 존재한다. 차이 전문 → [`docs/ARCHITECTURE-llm-proxy.md`](docs/ARCHITECTURE-llm-proxy.md)

## 환경 변수

전체 목록·기본값은 `apps/dashboard/.env.example`, **권위는 [`shared/config/env.ts`](apps/dashboard/src/shared/config/env.ts)** (Zod) — 부팅 시 검증에 실패하면 즉시 throw 한다. 새 변수는 두 파일을 함께 갱신한다.

스키마에서 `.default()` 도 `.optional()` 도 없는 항목이 필수다. **단 `.optional()` 이 "비워도 된다" 를 뜻하지는 않는다** — Zod 에서 `""` 는 `undefined` 가 아니라 `.optional()` 이 적용되지 않고 뒤의 제약(`min(1)`·`email()`·`startsWith()`)이 그대로 검사된다. 즉 키를 **아예 없애야**(undefined) 선택이 되고, **빈 문자열로 존재하면** 부팅이 죽는다.

두 경로가 모두 "빈 문자열로 존재" 를 만들기 때문에 자주 물린다:

- **운영**: compose 가 `${VAR:-}` 로 넘긴다 → `.env` 에서 줄을 지워도 `""` 가 주입된다
- **dev**: `.env.example` 이 `KEY=` 로 비어 있다 → 복사하면 그대로 `""`

| 변수 | 빈 문자열로 두면 |
|---|---|
| `VAPID_PUBLIC_KEY`·`_PRIVATE_KEY`·`_SUBJECT`, `OPS_NOTIFY_EMAIL`, `DART_OPENAPI_AUTH_KEY` | **부팅 실패** — `min(1)`·`email()`·`startsWith()` 가 `""` 를 거부하는데 preprocess 가 없다 |
| `TELEGRAM_BOT_TOKEN`·`_CHAT_ID` | 텔레그램 발송만 skip (`shared/lib/telegram.ts` 는 throw 하지 않는다). critical 알림이 web-push 로만 간다 |
| `HTTP_CHECK_CONNECT_IP` | HTTP/SSL 체크는 **계속 돈다** — `probeSite.ts` 가 `connectIp ?? domain` 이라 도메인으로 접속한다. hairpin NAT 회피만 못 하는 것 |
| `GITHUB_MONITOR_TOKEN` | 동기화 cron skip + 보드가 "동기화 비활성" 을 표시한다 (기존 스냅샷은 유지) |
| `PLAYMCP_BOOTSTRAP_OTT` | 정상 상태다 — `tiger:bootstrap` 1회 실행 후 `.env` 에서 제거하도록 설계됐다 |

즉 "optional 이면 비워도 그 기능만 죽는다" 로 뭉뚱그릴 수 없다 — 위 표처럼 변수마다 다르다.

⚠️ `DART_OPENAPI_AUTH_KEY` 는 "키 없으면 skip" 으로 알려져 있지만 preprocess 가 없어 **빈 값이면 부팅이 죽는다.** env.ts 주석(`관제 Phase 2` 블록)이 DART 를 이 함정의 *예외* 로 적어둔 것은 사실과 다르다 — compose 108행이 DART 키도 `${VAR:-}` 로 넘긴다. 새 optional 변수는 preprocess 패턴을 쓸 것. 안 쓰면 문서에 "선택" 이라 적어도 실제로는 필수가 된다.

`.env` 만 고치면 안 되는 변수 — 값이 한 파일 밖으로 새는 것들:

| 변수 | 동시에 갱신할 곳 |
|---|---|
| `METRICS_INGEST_TOKEN` | 호스트 에이전트 `/etc/default/gons-monitoring-agent` |
| `MCP_DASHBOARD_TOKEN` | 4곳 — 운영 `.env`, 사용자 `~/.claude.json`, 로컬·서버 `~/.config/gons-dashboard/ingest.env` (절차: `docs/RUNBOOK.md`) |
| `APP_IMAGE_REF` | 이 값을 옮기는 것이 배포 그 자체 — 아래 "운영 배포" 참조 |

`GITHUB_MONITOR_TOKEN` 은 fine-grained PAT, read-only (Issues·PR·Actions·Metadata).

`PG_ENCRYPTION_KEY` 는 PlayMCP creds 에만 적용된다 — Gmail accounts 토큰은 평문 (아래 "MCP 도구 호출 정책" 참조).

⚠️ **운영에서 안 먹는 env 가 있다.** `*_LLM_MODEL_*` 계열은 `docker-compose.yml` app `environment:` 블록에 전달 행이 없어 **운영 `.env` 에 넣어도 컨테이너에 도달하지 않는다** — env.ts 의 `.default()` 가 그대로 쓰인다. (폴백 전용이라 실질 영향은 작지만 "값을 바꿨는데 안 바뀐다" 함정이다.) `SAJU_LLM_DAILY_BUDGET_KRW` 는 전달되며 compose 기본값 `20000` 이 env.ts 기본값 `1000` 을 덮는다.

**시크릿은 어떤 형태로도 저장소에 커밋 금지** — README, 주석, 마크다운 본문 포함.

## 운영 배포

| 항목 | 값 |
|------|-----|
| 운영 서버 | `192.168.0.5` (docker context `home-server`, alias `dserver` / `dcserver`) |
| 외부 URL | `https://gons.krdn.kr` |
| compose 경로 (서버) | `/home/gon/projects/gon/gons-dashboard/docker-compose.yml` |
| 이미지 | app = `.env` 의 `APP_IMAGE_REF` **digest 핀** (compose 57행), cron = `:${APP_IMAGE_TAG:-latest}` 태그 (129행) |
| 포트 | app `3020`, postgres `5440`, redis `6390` |
| CI | GitHub Actions `CI` 워크플로 (Lint & Type Check → Build & Push Docker Images on main) |

⚠️ **`pull` 은 배포가 아니다.** app 이미지는 digest 로 핀 고정돼 있어 `compose pull app` 은 같은 digest 를 재획득할 뿐이다. **배포 = `.env` 의 `APP_IMAGE_REF` 를 새 digest 로 옮기는 것.** 빠뜨리면 "PR 머지됨 + CI 빌드 성공 + 그런데 운영은 며칠 전 이미지" 가 조용히 유지된다 (2026-07-27 PR #344 — 신규 UI 가 안 보였다). cron 은 태그라 pull 만으로 갱신된다 — **app 과 cron 의 배포 방식이 다르다.**

⚠️ **compose 명령은 서버에서 실행한다.** `--context` 는 데몬 접속만 원격화하고 `-f` / `--env-file` 은 로컬 CLI 가 읽는다. 로컬에서 `dcserver up -d app` 을 돌리면 **로컬 레포의 compose + 로컬 `.env`** 로 운영 컨테이너가 재생성돼 env 가 비고 Zod 검증이 실패한다 → 운영 다운 (Gotcha #8 과 같은 결과).

절차 전문 (digest 획득, `.env` in-place 갱신, 검증) — `docs/RUNBOOK.md` "배포 (정상 경로)".
무인 배포는 cron 컨테이너의 `autopilot/deploy-watcher.js` 담당, `AUTOPILOT_DEPLOY` 기본 `off`.

## AI 호출 정책

모든 LLM 추론은 운영 서버의 `cli-proxy-api` (`ANTHROPIC_BASE_URL`) 를 지난다 — Claude/Codex/Gemini 를 단일 endpoint 로 묶은 프록시로, API key 없이 각 CLI 의 OAuth auth file 로 동작한다.

편집 시 틀리기 쉬운 두 가지:

- **`provider` 는 `"claude-cli"`** 여야 한다 (`shared/lib/llm/anthropic.ts`). `"anthropic"` 으로 두면 `/v1` 경로가 누락돼 404.
- **모델 ID 를 코드에 박지 않는다.** 프록시 사정으로 소멸한다 (2026-07-05 `gpt-5.3-codex` 사고). `resolveLatestModel(tier)` 가 런타임 선택하고 `*_LLM_MODEL_*` env 는 조회 실패 시 폴백일 뿐이다. 모델 선택 지점 — saju: [`saju-model-registry.ts`](apps/dashboard/src/shared/lib/llm/saju-model-registry.ts) + `features/saju-model-picker`, stock: [`persona-router.ts`](apps/dashboard/src/entities/stock-analysis/api/persona-router.ts).

proxy 구조·인증 방식·NextAuth Google OAuth 와의 차이 전문 → [`docs/ARCHITECTURE-llm-proxy.md`](docs/ARCHITECTURE-llm-proxy.md)

## MCP 도구 호출 정책

`packages/mcp-*` 의 도구 함수는 두 경로로 호출된다:

1. **In-process (대시보드 RSC)**: 위젯이 `import { makeXxxTool } from "@gons/mcp-xxx"` → 토큰은 같은 프로세스의 mediator 라우트(`/api/mcp/credentials/*`)에서 받아옴 (절대 URL — `NEXTAUTH_URL` 베이스).
2. **Stdio (Claude Code)**: `packages/mcp-*/dist/cli.js`가 자식 프로세스로 spawn → `MCP_DASHBOARD_URL` 환경변수로 mediator HTTPS 호출.

OAuth refresh token은 `apps/dashboard`의 `accounts` 테이블에만 존재. MCP 패키지는 절대 refresh token을 보지 못한다 — mediator가 발급하는 5분 access token만 사용.

⚠️ **at-rest 암호화 현황**: `accounts`의 Google refresh/access/id token은 **평문 `text()` 저장** (NextAuth `@auth/drizzle-adapter` 표준 동작 — adapter 가 `linkAccount` 로 평문을 직접 INSERT). `PG_ENCRYPTION_KEY` + `encryptToken`/`decryptToken`(pgcrypto.ts)은 **PlayMCP creds (`playmcp_credentials.*_enc` bytea)에만** 적용되고 Gmail accounts 토큰에는 미적용. 따라서 accounts 토큰 기밀성은 DB 접근 통제(네트워크·OS 권한)에 의존한다. adapter 레벨 암호화는 NextAuth 비표준 작업이라 의도적으로 보류 — 감사 #15 (`docs/research/2026-06-18-email-widget-audit.md`).

신규 도메인 MCP 추가 시: `packages/mcp-<domain>` + `packages/shared-<provider>` (이미 있으면 재사용) + dashboard에 `/api/mcp/credentials/<provider>` mediator. spec 패턴 — `docs/superpowers/specs/2026-05-12-hybrid-mcp-api-domains-design.md`.

## Agent 보조 자료

- **Issue tracker**: GitHub Issues (`krdn/gons-dashboard`), `gh` CLI — 상세는 `docs/agents/issue-tracker.md`
- **Triage labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` — 상세는 `docs/agents/triage-labels.md`
- **Domain docs**: 도메인 결정·용어 — `docs/agents/domain.md`
- **운영 절차**: 시크릿 회전, OAuth 갱신 등 — `docs/RUNBOOK.md`
- **설계/계획 산출물**: `docs/superpowers/{specs,plans}/<date>-<topic>.md`
- **v0.1 후속 작업 backlog**: `TODOS.md` (의도적으로 v0.1 범위 외인 항목)

## 응답 규칙

**시크릿은 메모리/메시지에 평문으로 남기지 않는다** — 항상 `.env` 와 변수명으로만 지칭. (한국어 응답·코드 영어는 글로벌 `~/.claude/rules/korean-response.md` 가 이미 강제.)

## 이메일 분류 정확도 평가 (eval)

분류기(답장 필요 / 중요) 정확도 회귀를 잡는 2계층 시스템 (`apps/dashboard/tests/eval/`). 설계: `docs/superpowers/specs/2026-06-17-email-classification-eval-design.md`.

- **Layer 1 (매 PR, 자동)**: deterministic recall + severity 스냅샷 + mailing-list 컷 회귀. `pnpm test`에 포함 (별도 명령 불필요). LLM 미호출이라 결정적.
- **Layer 2 (on-prem 수동)**: `pnpm --filter @gons/dashboard eval:llm` — 실제 Haiku 호출로 precision/recall/F1 측정 + `tests/eval/reports/<date>.json` 리포트. **cli-proxy 내부망(`ANTHROPIC_BASE_URL`) 접근 필요**, GHA에서는 못 돈다. PR 차단 안 함(리포트만).
- 임계치: `tests/eval/thresholds.json` (베이스라인 측정 후 확정 — 현재 placeholder).
