# gons-dashboard 작업 지침

개인 통합 대시보드: 이메일 분석, 서버·GitHub 관제, 사주·주식 분석, 메모, Calendar 및 Skill/Plugin/Agent 카탈로그를 제공한다. 응답과 문서는 한국어, 코드 식별자는 영어로 작성한다.

## 적용 기준

- 공통 개인 지침과 함께 적용한다. 변경은 요청 범위로 제한하고, 단일 문서·사소한 수정에는 전체 빌드나 외부 리뷰 절차를 붙이지 않는다.
- 실행 명령·의존성은 각 `package.json`, FSD 규칙은 `apps/dashboard/eslint.config.mjs`, CI 범위는 `.github/workflows/ci.yml`을 기준으로 한다. 버전과 모델 ID를 문서에 중복 고정하지 않는다.
- `CLAUDE.md`는 도메인 배경과 과거 장애 참고 자료, `docs/RUNBOOK.md`는 운영 절차 참고 자료다. 오래된 설명과 현재 코드가 다르면 차이를 밝히고 현재 구현을 확인한다. Claude 전용 로컬 설정 경로를 Codex 설정으로 해석하지 않는다.

## 구조와 진입점

| 경로 | 역할 |
| --- | --- |
| `apps/dashboard` | `@gons/dashboard`, Next.js App Router·RSC·Server Actions |
| `apps/cron` | `gons-dashboard-cron`, JavaScript node-cron 스케줄러와 `autopilot/` 배포 watcher |
| `packages/stock-analysis` | 주식 분석 타입·데이터 어댑터, browser용 `./client` 진입점 |
| `packages/mcp-calendar` | Calendar 도구, in-process API와 stdio CLI |
| `packages/shared-google` | Google API 공통 기능 |
| `packages/shared-mcp-runtime` | MCP 공통 런타임 |
| `scripts/monitoring-agent` | 호스트 관제 에이전트와 Bash 회귀 테스트 |
| `apps/dashboard/src/shared/lib/db/schema.ts` | Drizzle 스키마; 생성 SQL·메타데이터는 `apps/dashboard/drizzle/` |
| `apps/dashboard/src/shared/config/env.ts` | 환경 변수 Zod 검증 |
| `docs/agents`, `docs/superpowers` | 도메인·이슈 운영 자료, 설계·계획 |

`@krdn/saju`, `@krdn/llm-gateway`, `@krdn/tickerlens`, `@krdn/email`, `@krdn/gons-health`는 외부 의존성이다. README에 남은 `packages/saju` 경로를 생성하거나 로컬 패키지로 취급하지 않는다. GitHub 태그 의존성 갱신은 manifest와 `pnpm-lock.yaml`을 함께 반영한다.

## 개발 명령

루트에서 실행한다. pnpm 버전은 루트 `packageManager`, Node 버전은 CI/Dockerfile과 맞춘다.

| 명령 | 실제 범위 |
| --- | --- |
| `pnpm install` | workspace 의존성 설치; CI는 `--frozen-lockfile` |
| `pnpm dev` | dashboard Turbopack 개발 서버, `http://localhost:3020` |
| `pnpm build` / `pnpm start` | dashboard 프로덕션 빌드 / 실행 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 해당 script가 있는 workspace 패키지들을 재귀 실행 |
| `pnpm format` | dashboard의 `src/**/*.{ts,tsx,css,md}`만 포맷; 저장소 전체가 아님 |
| `pnpm db:generate` / `pnpm db:migrate` | dashboard Drizzle 마이그레이션 생성 / 대상 DB 적용 |
| `pnpm --filter @gons/mcp-calendar build` | MCP stdio CLI 빌드; 루트 build에 포함되지 않음 |
| `bash scripts/monitoring-agent/agent.test.sh` | 호스트 관제 에이전트 테스트; pnpm test에 포함되지 않음 |

로컬 환경 파일은 `apps/dashboard/.env.example`을 **기존 파일이 없을 때만** `apps/dashboard/.env`로 복사해 준비한다. 운영 Compose의 루트 `.env`와 별개다. 실제 값은 출력하지 않는다.

## 코드 경계와 스타일

- `apps/dashboard/src`는 FSD: `app → widgets → features → entities → shared`. 현재 ESLint는 `widgets → widgets`, `features → features`도 허용한다. 이 예외를 다른 레이어로 확대하지 않는다.
- 슬라이스가 제공하는 `index.ts`, `server.ts`, `client.ts` 공개 진입점을 사용한다. 기존 패턴을 확인하고 불필요한 barrel을 추가하지 않는다.
- Client Component에서 DB·Node 전용 코드를 끌어오는 server barrel을 import하지 않는다. 예: `@/entities/container/client`, `@/features/stock-analysis-server/client`. Server Action 재노출과 일반 server-only 함수는 별도 진입점을 유지한다.
- TypeScript, 2칸 들여쓰기, 세미콜론, 큰따옴표, trailing comma를 기존 Prettier 스타일에 맞춘다. 컴포넌트·타입은 PascalCase, 함수·변수는 camelCase, 슬라이스 디렉터리는 kebab-case다.
- UI는 Tailwind v4와 기존 `globals.css` 디자인 토큰, 라이트 모드 정책을 따른다. SSR·브라우저 간 locale 의존 시간 문자열로 hydration 차이를 만들지 않는다.

## 검증

- 코드 동작 변경에는 관련 회귀 테스트를 추가한다. Vitest 테스트는 dashboard의 `tests/` 또는 `src/` 아래 `*.test.ts(x)`, 패키지는 각 테스트 설정을 따른다.
- dashboard `tests/setup.ts`는 `TEST_DATABASE_URL`이 있으면 `DATABASE_URL`을 덮어쓰고 로컬 호스트 허용 목록을 검사한다. 단순히 비운영 주소라는 이유로 원격 테스트 DB가 허용되는 것은 아니다. 가드를 해제하지 않는다.
- DB 통합 테스트는 별도 로컬 PostgreSQL과 마이그레이션된 스키마가 필요하다. CI 예시 주소는 `postgres://test:test@127.0.0.1:5999/test_dummy`이며, 마이그레이션에는 `DATABASE_URL`, 테스트에는 `TEST_DATABASE_URL`을 지정한다. 나머지 필수 테스트 환경 변수는 CI 설정을 참고한다.
- 집중 실행 예: `pnpm --filter @gons/dashboard test tests/<name>.test.ts`. dashboard 테스트는 DB 공유 때문에 파일 병렬 실행이 꺼져 있고 시간대는 `Asia/Seoul`이다.
- 코드 PR 전에는 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`를 실행한다. 특히 server/client 경계 변경은 Next.js build가 필요하다. MCP·관제 에이전트 변경에는 위의 별도 검증을 더한다.
- 문서만 변경하면 경로·명령 대조와 `git diff --check`로 검증한다. 테스트 실패·인프라 미준비·미실행을 통과로 보고하지 않는다. UI 변경은 실제 화면을 확인하고, 로컬·fixture 결과와 인증된 운영 결과를 구분한다.

## 도메인별 주의점

- LLM 호출은 `@krdn/llm-gateway`와 `shared/lib/llm/`의 기존 설정을 사용한다. 현재 proxy provider는 `claude-cli`다. 모델은 기존 resolver/registry를 따르며 임의 ID를 하드코딩하지 않는다. proxy 인증과 NextAuth Google OAuth는 별개다.
- MCP 패키지는 dashboard credential mediator를 통해 access token을 받는다. Google refresh token을 패키지나 클라이언트로 전달하지 않는다.
- Docker Compose 프로젝트는 라벨 발견 시 자동 등록한다. `knownComposeProjects.ts`는 메타데이터 힌트·cleanup pinned set이며 등록 화이트리스트가 아니다. 표시용 목록과 hidden을 포함한 중복 판정용 키를 구분한다.
- 스케줄 변경은 `apps/cron/scheduler.js`와 대응하는 `app/api/cron/` 라우트를 함께 확인한다. KST, 타임아웃, 재실행 멱등성을 유지하며 알림 작업에 일괄 재시도를 추가하지 않는다.

## 운영·데이터 변경

- 운영 관련 기준 파일은 `docker-compose.yml`, `apps/cron/autopilot/`, `docs/RUNBOOK.md`다. 문서상 대상은 `192.168.0.5:/home/gon/projects/gon/gons-dashboard/`; 작업 시 현재 대상을 확인한다.
- Compose 변경 명령은 서버에서 서버의 compose와 `.env`를 명시해 실행한다. 로컬 `docker --context home-server compose`는 로컬 파일을 읽으므로 같은 의미가 아니다.
- app은 `APP_IMAGE_REF` 전체 참조(운영 절차는 digest 핀), cron은 `APP_IMAGE_TAG`를 사용한다. 이미지 pull·CI 성공만으로 배포 완료라 하지 않는다. 실행 중 이미지와 health를 확인하고, 롤백 시 autopilot 재배포 차단 절차도 따른다.
- 운영 seed·cleanup·OAuth reset은 승인된 범위에서만 실행한다. `_lib/prodGuard.ts`의 확인 플래그를 임의로 붙이지 않는다. `db:cleanup-projects`는 기본 dry-run, `--apply`가 실제 삭제다.
- **운영 마이그레이션 안내가 상충한다:** CLAUDE.md는 tracking 미인식에 따른 수동 적용을, RUNBOOK은 `db:migrate`를 안내한다. 실제 DB의 migration 이력·스키마·백업을 확인해 적용 방식을 정한다. 어느 문서도 근거 없이 그대로 실행하지 않는다. 개발 DB에는 생성 SQL을 검토한 뒤 정상 migrate를 사용한다.
- 환경 파일·OAuth 토큰·Bearer·개인 이메일 본문을 커밋, 로그, 리뷰 자료에 노출하지 않는다.

## 커밋과 완료 보고

Conventional Commits(`feat:`, `fix:`, `docs:`, `chore:`)를 사용하고 요청과 무관한 기존 변경은 보존한다. PR에는 목적, 검증 결과, 관련 이슈, 환경 변수·마이그레이션 영향, UI 변경 시 화면 자료를 포함한다. 완료 보고에는 실제 변경과 검증 범위, 남은 제약을 짧게 적는다.
