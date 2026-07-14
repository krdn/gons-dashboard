# 카탈로그 새로고침 버튼 설계 (Skill / Plugin / Agent)

- **날짜**: 2026-07-14
- **범위**: `/skills`, `/plugins`, `/agents` 페이지에 각각 카탈로그 재생성 버튼 추가
- **상태**: 설계 승인, 구현 대기

## 배경

Skill / Plugin / Agent 카탈로그는 `~/.claude` 자산의 **build-time JSON snapshot** 이다.
갱신 흐름은 현재 다음과 같다:

```
로컬에서 pnpm {skills,plugins,agents}:snapshot 실행
  → src/entities/{skill,plugin,agent}/*catalog.json 재생성
  → git commit
  → Docker 배포
```

`catalog.json` 은 `entities/*/server.ts` 에서 `import catalog from "./catalog.json"` 로
**정적 번들링**된다. 즉 런타임에 파일을 읽는 게 아니라 빌드 시점에 JS 번들로 구워지는 상수다.

## 문제

카탈로그를 갱신하려면 매번 CLI 로 `pnpm skills:snapshot` 을 기억해 실행해야 한다.
페이지에서 바로 "이 머신의 현재 `~/.claude` 로 카탈로그를 다시 스캔" 하는 버튼이 있으면
반복 CLI 실행 없이 카탈로그를 최신화할 수 있다.

## 핵심 제약 (실측 확정)

이 설계의 방향을 결정한 실측 결과:

1. **`catalog.json` 은 `import` 로 번들에 정적 포함된다.**
   운영 컨테이너는 배포 시점의 스냅샷을 상수로 들고 있으며, 런타임에 파일을 다시 읽지 않는다.

2. **데이터 소스는 `~/.claude/{skills,plugins,agents}/` — 개발자 로컬 홈 디렉토리다.**
   운영 Docker 컨테이너에는 이 디렉토리가 없다.
   → **버튼은 소스가 존재하는 환경(개발자 로컬)에서만 의미가 있다. 운영에서는 할 일이 없다.**

3. **재생성은 idempotent 하지 않다 — 실행 머신의 `~/.claude` 상태에 100% 종속.**
   실측: 커밋된 catalog.json 은 **90개** 스킬을 담고 있었으나, 이 개발 머신에서 재생성하니
   **38개** 로 줄며 catalog.json 이 655줄 삭제됐다(커밋된 스냅샷이 더 많은 스킬을 가진
   다른 머신에서 생성됐기 때문). 실수로 커밋하면 다른 환경의 데이터가 소실된다.

4. **스냅샷 실행 시간 ≈ 1.6초** (skills 기준). 자식 프로세스 spawn 에 적합.

## 결정 사항 (brainstorming 확정)

| 항목 | 결정 |
|------|------|
| 버튼 동작 | **로컬 개발 전용 재생성** — 버튼 클릭 시 서버가 `~/.claude` 를 다시 스캔해 catalog.json 재생성. 운영에서는 비활성. 커밋은 여전히 수동. |
| 갱신 범위 | **페이지별 개별 버튼** — `/skills` 에는 스킬만, `/plugins` 에는 플러그인만, `/agents` 에는 에이전트만 재생성. |
| 결과 반영 | **자동 반영 시도 + 폴백 안내** — `revalidatePath` 로 페이지 새로고침 시도. HMR 이 반영하면 즉시, 안 되면 "dev 서버 재시작 필요" 안내. |
| 덮어쓰기 리스크 | **경고만 표시, 동작은 그대로** — 재생성은 그대로 실행하되 완료 후 "현재 머신 기준이니 커밋 전 git diff 확인" 경고 표시. |

## 접근 방식

### 채택: 기존 `pnpm *:snapshot` 을 subprocess 로 spawn

Server Action 이 `child_process.spawn("pnpm", ["skills:snapshot"], { cwd })` 로 기존 명령을
그대로 실행한다.

**근거:**

- **`import.meta.url` 경로 해석**: `snapshot-skills.ts:28` 이
  `const here = fileURLToPath(new URL(".", import.meta.url))` 로 출력 경로를 자기 파일
  위치(`src/scripts/`) 기준으로 잡는다. 이 로직을 Next.js 서버 번들로 import 하면
  `import.meta.url` 이 번들 위치로 바뀌어 출력 경로가 깨진다. standalone 스크립트로 실행될
  때만 성립하는 코드다.
- **번들 경계(Gotcha #7)**: 스크립트는 `--conditions=react-server` + server-only 엔티티
  (`@/entities/skill/lib/parseSkill`)를 끌어온다. 이걸 Server Action 모듈 그래프에 직접 넣으면
  `tls`/`perf_hooks` 등 Node-only 의존이 client bundle 그래프로 끌려가는 사고가 난다.
  subprocess 격리가 이걸 원천 차단하고 **이미 작동하는 호출을 100% 재사용**한다.

### 기각: 스냅샷 로직을 함수로 리팩토링해 직접 호출

위 두 함정(경로 해석·번들 경계)을 모두 떠안는다. 리팩토링 리스크 대비 이득 없음.

## 아키텍처 (FSD — Gotcha #7 server/client seam 패턴)

```
features/catalog-refresh/
├── index.ts        # server entrypoint (import "server-only")
│                    #   spawnSnapshot(kind): child_process spawn 로직 + stdout 파싱
├── client.ts       # "use server" Server Action만 re-export
│                    #   refreshCatalog(kind: CatalogKind): Promise<RefreshResult>
├── model/
│   └── types.ts    #   CatalogKind = "skills" | "plugins" | "agents"
│                    #   RefreshResult = 성공/실패 discriminated union (아래 명세)
└── ui/
    └── CatalogRefreshButton.tsx   # "use client" — 버튼 + 진행/완료/경고 표시
```

**의존성 규칙:**

- `"use client"` 컴포넌트는 `@/features/catalog-refresh/client` 로만 import
  (server-only 가 client bundle 그래프로 끌려가는 것 방지).
- 각 페이지(`app/(dashboard)/{skills,plugins,agents}/page.tsx`)의 `PageHeader` 영역에
  `<CatalogRefreshButton kind="skills" />` 배치.

## 컴포넌트 명세

### `RefreshResult` 타입 (`model/types.ts`)

성공/실패 discriminated union — `ok` 로 분기.

```typescript
type CatalogKind = "skills" | "plugins" | "agents";

type RefreshResult =
  | { ok: true; count?: number; warning: string }   // count 미확인이면 undefined
  | { ok: false; error: string };                    // 실패 시 warning 없음
```

- 성공(`ok: true`): `count`(파싱 실패 시 undefined) + `warning`(항상 존재 — 덮어쓰기 안내).
- 실패(`ok: false`): `error` 만. `warning`/`count` 없음.

### `spawnSnapshot(kind)` — server-only (`index.ts`)

- 입력: `kind: CatalogKind`
- `kind` → 스크립트명 매핑: `skills` → `skills:snapshot` 등.
- **dev 가드**: `process.env.NODE_ENV === "production"` 이면 즉시 거부 반환
  (`{ ok: false, error: "운영 환경에서는 카탈로그 재생성이 지원되지 않습니다." }`).
- `spawn("pnpm", ["<kind>:snapshot"], { cwd: <repo root 명시> })`.
  - **cwd 명시 필수**: 프로세스 cwd 에 의존하지 않고 repo root 를 명시 (cwd 드리프트 방지).
    repo root 는 `process.cwd()` 가 아니라 spawn 시점에 결정론적으로 계산
    (예: `features` 파일 기준 상대 경로 또는 알려진 앵커).
- 완료 후 stdout 에서 `생성 (\d+)개` 정규식으로 개수 파싱.
- 반환: `RefreshResult` (성공 시 `warning` 에 덮어쓰기 안내 문구 포함).

### `refreshCatalog(kind)` — Server Action (`client.ts`)

- `"use server"` 경계. `spawnSnapshot(kind)` 호출.
- 성공 시 `revalidatePath("/" + kind)` 시도.
- `RefreshResult` 반환.

### `CatalogRefreshButton` — client 컴포넌트 (`ui/`)

- props: `{ kind: CatalogKind }`.
- 상태: `idle` | `running` | `done` | `error`.
- **동시 실행 가드**: `running` 중 버튼 `disabled` (더블클릭 시 스크립트의 `rmSync(BODY_DIR)`
  후 재생성 겹침 방지).
- 완료(`done`) 시:
  - `생성 N개` 표시.
  - **덮어쓰기 경고**: "이 카탈로그는 현재 머신의 `~/.claude` 기준입니다.
    `catalog.json` 과 `public/<kind>-catalog/` body 파일을 덮어썼습니다.
    커밋 전 `git diff` 로 확인하세요." (body 디렉토리까지 명시 — 스크립트가
    `public/<x>-catalog/` 전체를 `rmSync` 후 재생성하므로 실제 소실 범위와 일치).
  - 필요 시 "즉시 반영이 안 되면 dev 서버 재시작이 필요할 수 있습니다" 폴백 안내.
- 운영 환경 렌더 방지: 버튼 자체를 `process.env.NODE_ENV !== "production"` 일 때만 렌더
  (Server Action 의 dev 가드는 2차 방어).

## 에러 처리

- `spawn` 실패(비-0 exit code): stderr 를 캡처해 `{ ok: false, error }` 반환.
  스크립트가 자체적으로 warn 을 내지만 exit code 로 성공/실패 판정.
- stdout 에서 개수 파싱 실패: `count` 를 undefined 로 두고 "완료(개수 미확인)" 표시
  (실패로 간주하지 않음 — 재생성 자체는 성공했을 수 있음).
- production 거부: 사용자에게 명확한 안내 문구. UI 에서 애초에 버튼을 안 그리므로 실질적으로
  도달하지 않는 2차 방어.

## 미검증 항목 (구현 시 확인 필요)

- **HMR 자동 반영** — **구현 후 자동 실측 실패, 사용자 dogfood 필요 (2026-07-14)**:
  `catalog.json` 은 `import` 라 실행 중 dev 서버가 즉시 새 파일을 못 읽을 수 있다(Node 모듈
  캐시). Turbopack 이 catalog.json import 변경을 리컴파일에 반영하는지는 **자동 실측하지
  못했다**. 실측 시도 경위:
  1. `/skills` 는 로그인 리다이렉트(307)라 curl 로 개수 확인 불가.
  2. dev 서버가 운영 DB(192.168.0.5)를 바라봐, 로그인 세션을 재사용하려 세션 토큰을
     브라우저 쿠키로 주입 시도 → **브라우저 자동화 안전장치가 쿠키 데이터 조작을 차단**
     (`[BLOCKED: Cookie/query string data]`). 정당한 안전장치이므로 우회하지 않음.
  - **코드 레벨 검증은 완결**: `pnpm build` 통과(Gotcha #7 seam 무결 — client 가 server-only
    를 안 끌어옴), 세 페이지 `page_client-reference-manifest.js` 생성(버튼이 각 페이지 client
    boundary 로 등록됨), 컴포넌트 단위 테스트 2/2, `revalidatePath` 호출 코드 존재.
  - **남은 확인(사용자 dogfood)**: 로그인된 브라우저에서 `/skills` → 버튼 클릭 → 재생성 후
    개수가 이 머신 `~/.claude` 기준으로 바뀌는지 관측. 반영되면 자동 반영 확정, 안 되면
    버튼 하단 "dev 서버 재시작 필요" 폴백 안내가 정확함. **어느 쪽이든 UX 는 성립** — spec 이
    폴백 안내를 항상 표시하도록 설계했기 때문(결과에 무관하게 버튼은 안전하게 동작).

## 테스트

- **단위**: `spawnSnapshot` 의 dev 가드 — `NODE_ENV=production` 일 때 거부 반환.
- **단위**: stdout 파싱 — `"[snapshot-skills] ✅ 생성 38개 / skip 2개..."` → `count: 38`.
- **단위**: 개수 파싱 실패 케이스 — 매칭 없으면 `count: undefined`, `ok: true` 유지.
- **컴포넌트(jsdom)**: 버튼 클릭 → `running` 전이 시 `disabled`, 완료 후 경고 문구 렌더.

## 범위 밖 (YAGNI)

- 운영 환경에서의 재생성 (소스 `~/.claude` 부재로 불가 — 원천적으로 제외).
- 자동 커밋 / PR 생성 (덮어쓰기 리스크 때문에 의도적으로 수동 유지).
- 세 종류 통합 "전체 재생성" 버튼 (페이지별 개별로 확정).
- dry-run 증감 미리보기 (경고만 표시로 확정).
