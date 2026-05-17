# entities/container · entities/project barrel seam 재배치 — Design Spec

- **Date**: 2026-05-15
- **Scope**: `entities/container/index.ts` 와 `entities/project/index.ts` 가 *server-only* 와 *client-safe* 자산을 같은 barrel 에 함께 export 하는 *seam 미스플레이스* 를 해소. 두 barrel 자체를 폐지하고 `server.ts` / `client.ts` 두 진입점으로 대체. ESLint 가 옛 path 를 금지.
- **Non-goals**: 다른 entity (email, host, digest, saju-chart, fortune-profile) 는 본 spec 범위 밖. 현재 server/client 혼재 통증이 *드러난* 두 entity 만 처리.
- **Status**: design grilling 완료 (2026-05-15, 친구션 #3).
- **Prerequisite**: 친구션 #1 (PR #55), 친구션 #2 (PR #56) 머지 + 운영 적용 완료.

## 1. 배경 — 친구션 #3 (deepening 후보 survey 결과)

`entities/container/index.ts` 가 *두 종류 export* 를 같은 barrel 에 묶음:

| Entity | Server-only | Client-safe |
|---|---|---|
| `container` | `listContainers`, `inspectContainer` (→ `node:child_process` 통해 docker CLI) | `ContainerStatusBadge`, `ContainerRow` (React UI), `ContainerSummary` / `ContainerInspect` / `ContainerState` / `PortMapping` (types) |
| `project` | `getProjects`, `getProjectComposeKeys`, `upsertProjectFromContainer`, `syncMissingProjects` (DB queries) | `ProjectCard` (React UI), `categoryStyle` / `CategoryStyle` (pure), `KNOWN_COMPOSE_PROJECTS_BY_HOST` / `KNOWN_HOSTS` (constants), `Project` (type) |

### 1.1 통증

client component 가 `import type { ContainerSummary } from "@/entities/container"` 한 줄만 써도 Turbopack 이 barrel 전체를 client bundle 로 끌어옴 → `listContainers` 의 `node:child_process` 가 client tree 에 누출 → 빌드 실패 (prod Docker 빌드만 module-not-found 로 조용히 실패).

### 1.2 현재 우회

CLAUDE.md **Gotcha #1** 이 "client tree 에서는 barrel 쓰지 말고 깊은 경로로 직접 import 하라" 명시. 가이드라인 의존. 깜빡하면 prod 만 깨지고 PR CI 는 통과. *Workspace 패키지 Dockerfile gotcha* 와 같은 패턴.

### 1.3 친구션 #3 의 본질

**Module 의 interface 가 "container" 라는 도메인 명칭 아래 *server-only 작업* 과 *client UI* 를 함께 노출하지만, 실제 seam 은 server vs client 라는 *실행 환경 경계*.** Interface 가 진짜 seam 을 표현 못함 → 가이드라인으로 강제. Module 이 *얕음 (shallow)*: interface 가 *내부 환경 차이를 숨기지 못함*.

### 1.4 Deletion test

barrel 을 *단순 삭제* 하면 — 깊은 경로 직접 import 가 *강제* 됨. seam 이 도메인이 아닌 *파일 경로* 에 위치. 그러나 caller 입장에서 `Project` 타입 하나 쓰려고 5개 깊은 경로 외움 → 친화도 떨어짐. 단순 삭제 아닌 **seam 재배치** 가 답.

## 2. 결정사항 (grilling 결과)

| ID | 결정 |
|---|---|
| **Q1** | (a) — 단일 entity 유지. 두 barrel (`server.ts` + `client.ts`) 두 진입점으로 분리. *환경 차원* 을 import path 에 표현. |
| **Q2** | (a) — project 도 같은 처리 (일관성). 두 entity 같은 PR. |
| **Q3** | 타입은 양쪽 중복 export OK (type-only, 비용 0). UI 와 server API 는 각각의 환경 barrel 에만. 순수 상수 (`KNOWN_COMPOSE_PROJECTS_BY_HOST`, `categoryStyle`) 는 client barrel 에 (server tree 가 import 해도 무해). |
| **Q4 (α)** | ESLint `no-restricted-imports` 로 **옛 barrel path 자체** (`@/entities/container`, `@/entities/project`) 금지. 환경 구분은 명시 path 로 사용자 선택. client 보호는 휴먼 catch + prod build fail 로 자연 검증. *(Q4 (β)/(γ) 보강 — 디렉티브 검출 custom rule — 은 비용 대비 가치 낮음, YAGNI)* |
| **Q5** | (a) — CLAUDE.md Gotcha #1 즉시 폐지. 새 path 가 명시적이라 가이드라인 자체가 불필요. |

## 3. 새 seam 셰이프

### 3.1 폴더 구조

```
entities/container/
├── server.ts            ← NEW: server-only entrypoint
├── client.ts            ← NEW: client-safe entrypoint
├── index.ts             ← DELETED
├── api/                 (server-only — 그대로)
│   ├── listContainers.ts
│   └── inspectContainer.ts
├── model/types.ts       (타입 — 그대로, 양쪽에서 type-only export)
└── ui/                  (client-safe — 그대로)
    ├── ContainerRow.tsx
    └── ContainerStatusBadge.tsx

entities/project/
├── server.ts            ← NEW
├── client.ts            ← NEW
├── index.ts             ← DELETED
├── api/                 (server-only — 그대로)
├── model/types.ts
├── lib/categoryStyle.ts (순수)
├── config/knownComposeProjects.ts (순수 상수)
└── ui/ProjectCard.tsx   (client)
```

### 3.2 `entities/container/server.ts`

```ts
import "server-only";
// server entrypoint — RSC, API route, Server Action, scripts 에서 사용.
// `listContainers`/`inspectContainer` 는 node:child_process 의존. client tree 에 누출 금지.
export { listContainers } from "./api/listContainers";
export { inspectContainer } from "./api/inspectContainer";
// 타입은 양쪽에서 노출 — type-only.
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "./model/types";
```

### 3.3 `entities/container/client.ts`

```ts
// client entrypoint — "use client" 트리에서 사용.
// `"server-only"` import 절대 금지 — Turbopack 이 client bundle 에 끌어오면 빌드 실패.
export { ContainerStatusBadge } from "./ui/ContainerStatusBadge";
export { ContainerRow } from "./ui/ContainerRow";
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "./model/types";
```

### 3.4 `entities/project/server.ts`

```ts
import "server-only";
export { getProjects } from "./api/getProjects";
export { getProjectComposeKeys } from "./api/getProjectComposeKeys";
export { upsertProjectFromContainer } from "./api/upsertProjectFromContainer";
export { syncMissingProjects } from "./api/syncMissingProjects";
// scripts 에서 server 측이 KNOWN_COMPOSE_PROJECTS_BY_HOST 를 함께 쓰므로 server 에도 노출.
export {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "./config/knownComposeProjects";
export type { Project } from "./model/types";
```

### 3.5 `entities/project/client.ts`

```ts
export { ProjectCard } from "./ui/ProjectCard";
export { categoryStyle } from "./lib/categoryStyle";
export type { CategoryStyle } from "./lib/categoryStyle";
export type { Project } from "./model/types";
// 카테고리 메타 + 호스트 리스트는 client 트리에서도 표시용으로 쓰일 수 있음.
export {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "./config/knownComposeProjects";
```

### 3.6 ESLint `no-restricted-imports`

기존 `eslint.config.mjs` 에 룰 추가:

```js
{
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [
        {
          name: "@/entities/container",
          message: "옛 barrel 폐지. `@/entities/container/server` (RSC/API/Server Action) 또는 `@/entities/container/client` (\"use client\" 트리) 사용.",
        },
        {
          name: "@/entities/project",
          message: "옛 barrel 폐지. `@/entities/project/server` 또는 `@/entities/project/client` 사용.",
        },
      ],
    }],
  },
}
```

## 4. Caller 마이그레이션 (9곳)

기존 grep 결과 그대로:

| Caller | 환경 | 옛 import | 새 import |
|---|---|---|---|
| `app/servers/[hostName]/page.tsx` | RSC | `@/entities/container` + `@/entities/project` | `*/server` × 2 |
| `scripts/cleanup-projects.ts` | CLI server | `@/entities/container` + `@/entities/project` | `*/server` × 2 |
| `scripts/seed-projects.ts` | CLI server | `@/entities/project` | `@/entities/project/server` |
| `features/host-catalog/api/getHostsWithSummary.ts` | server-only | `@/entities/container` + `@/entities/project` | `*/server` × 2 |
| `features/container-list/lib/groupByProject.ts` | pure (type-only) | `@/entities/container` + `@/entities/project` (type only) | `*/client` × 2 (pure lib 라 client 가 자연) |
| `features/container-actions/ui/ActionButtons.tsx` | client | `@/entities/container/model/types` (옛 우회) | `@/entities/container/client` (편의성 회복) |
| `features/container-list/ui/StandaloneSection.tsx` | client | `@/entities/container/ui/ContainerRow` | `@/entities/container/client` |
| `features/container-list/ui/ProjectGroupSection.tsx` | client | `@/entities/container/ui/ContainerRow` + `@/entities/project/ui/ProjectCard` | `*/client` × 2 |

### 4.1 `groupByProject.ts` 특이사항

순수 함수 (sideeffect 없음). 현재 type-only barrel import. 새 path 는 `client` 가 자연 — *환경* 이 아니라 *type-only* 라는 사실이 중요하지만 `server` barrel 도 동일 타입 export 하므로 둘 중 어느 것이든 OK. **편의상 client 채택** — pure lib 가 client tree 에서도 호출 가능 (실제로 widgets/server-overview 가 client 에서 호출 가능성). server 에서 호출해도 client.ts 가 server-only 의존 0개라 안전.

## 5. CLAUDE.md Gotcha #1 폐지

기존 Gotcha #1 줄 (2026-05-12 박힌 *Client 컴포넌트에서 entities/\* barrel 사용 금지*) 삭제. 새 정책은 *ESLint 가 직접 강제* 라 가이드라인 불필요. 메모리 (`workspace-package-dockerfile-gotcha.md` 같은 패턴) 도 동일 시점 정리 — 이 PR 안에서 한 줄 제거.

대신 *왜 entity 마다 server/client barrel 두 개가 있나* 한 줄을 docs/agents/domain.md 또는 새 README 에 박을지는 별도 미해결 사항 (§9). 현재는 ESLint 메시지가 self-explanatory.

## 6. 테스트 전략

이 PR 은 **런타임 동작 변경 없음** — 순수 import path 갱신 + barrel 재배치. 신규 테스트 불필요.

검증:
- `pnpm typecheck` — 옛 path import 가 모두 새 path 로 갱신됐는지 (typecheck 가 잡음)
- `pnpm lint` — 옛 path 가 ESLint 룰에 걸리는지 (의도된 fail 검증 후 모두 갱신)
- `pnpm test` — 회귀 없음 (test 들이 entity barrel 직접 import 하면 그것도 갱신)
- `pnpm build` — **prod Docker 빌드 시뮬레이션 — Turbopack 환경에서 client tree 가 정상 컴파일** 되는지 (CLAUDE.md Workspace Dockerfile gotcha 와 같은 모양의 사고 회피)

## 7. 회귀 위험

- **옛 barrel path 남아있는 곳 누락** — grep 으로 9곳 확인했지만 packages/, apps/cron/ 도 점검 필요. 별도 `git grep '@/entities/container\b\|@/entities/project\b'` 으로 PR 작성 시 zero result 검증.
- **`groupByProject.ts` import path 환경 명시** — type-only 인데 `client` 로 박는 이유가 자명해야 함. spec §4.1 한 단락이 그 역할.
- **ESLint 룰이 *옛 barrel* 자체만 막음 — *동일 entity 의 깊은 경로* (예: `@/entities/container/ui/ContainerRow`) 직접 import 는 여전히 가능** (intentional escape hatch — 사용자가 새 barrel 보다 더 좁게 import 하고 싶을 때). 단 *권장은* 새 barrel.

## 8. 구현 순서

1. `entities/container/server.ts` + `client.ts` 작성, `index.ts` 삭제.
2. `entities/project/server.ts` + `client.ts` 작성, `index.ts` 삭제.
3. 9개 caller path 갱신 (위 표).
4. ESLint config 에 `no-restricted-imports` 룰 추가.
5. CLAUDE.md Gotcha #1 줄 삭제 (CONTEXT.md 도 *seam* 어휘 갱신 필요 시).
6. 검증 — typecheck / lint / test / **build**.
7. PR 1개 (한 atomic 변경, caller 9 + barrel 4 + config 1 + 메모리 1).

## 9. 미해결 사항

- **다른 entity (email, host, digest, saju-chart, fortune-profile) 의 같은 통증** — 현재는 *드러난 통증 없음*. 새 entity 추가 시 같은 패턴 (`server.ts` + `client.ts`) 권장. 한 entity 가 *server-only* 만 있거나 *client-safe* 만 있으면 `index.ts` 하나로 OK.
- **lint 룰의 정밀도 보강** — Q4 (β)/(γ) (디렉티브 검출 또는 파일 패턴 기반) 은 future PR 후보. 현재 (α) 의 보호는 휴먼 catch + prod fail 의존.
- **새 entity 의 README** — *seam 정책* 문서화. 현재는 ESLint 메시지가 자기 설명 — 충분.
