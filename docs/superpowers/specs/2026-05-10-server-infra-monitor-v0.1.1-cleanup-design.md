# Server Infra Monitor v0.1.1 — 좀비 정리 + Stale 감지

**작성일**: 2026-05-10
**상태**: APPROVED 대기
**선행 문서**: `docs/superpowers/specs/2026-05-10-server-infra-monitor-design.md` (v0.1)
**관련 RUNBOOK**: `docs/RUNBOOK.md` § "v0.1 서버 인프라 모니터"

## 1. 배경

v0.1을 home-server (192.168.0.5)에 배포한 뒤 정밀 분석을 수행한 결과, 모니터의 인지(DB의 `projects` 테이블)와 실제 컨테이너 상태 사이에 큰 격차가 확인됐다.

### 정밀 분석 데이터

`docker --context home-server ps`로 발견된 **실제 라이브 compose project**: 9개

```
ai-afterschool-ex
ai-afterschool-fsd
cli-proxy-api
docker
docker-n8n
gons-dashboard
news-sentiment-analyzer2
news-sentiment-prod
(라벨 없음: open-webui, krdn-timescaledb)
```

`projects` 테이블 현재 상태: **23개 row** (오늘 2026-05-10 일자 생성/갱신)

```
ai-afterschool, ai-afterschool-ex, ai-afterschool-fsd, ai-afterschool-fsd-web,
ai-health, ai-model-setup, ai-news-analyzer, ais-collector, ais-prod,
cli-proxy-api, docker, docker-n8n, gons-dashboard, krdn-fx, n8n,
news-prod, news-sentiment-analyzer2, news-sentiment-prod, nitter,
open-webui, voice, vscode, web
```

### 발견된 4가지 문제

**(A) 좀비 project row가 15개**
- 실제 compose label 가진 라이브 컨테이너 set = 8개 (`open-webui`, `krdn-timescaledb`는 라벨 없는 standalone이라 project row 후보 아님)
- DB의 23개 중 **15개가 좀비**: `ai-afterschool`, `ai-afterschool-fsd-web`, `ai-health`, `ai-model-setup`, `ai-news-analyzer`, `ais-collector`, `ais-prod`, `n8n`, `news-prod`, `nitter`, `voice`, `vscode`, `web`, `krdn-fx`, `open-webui`(라벨 없는데도 row 존재)
- 출처: 컨테이너 이름·service 이름 혼동, 옛 compose 구성, 또는 수동 SQL 흔적

**(B) 좀비 cleanup 메커니즘 부재**
- 컨테이너가 사라져도 row는 영구 잔존 (FK도 자동 정리 안 함)
- 사용자가 stop/제거한 후 모니터에 잔상으로 남는 정상 운영 시나리오에서도 발생

**(C) display_name 의도가 깨짐**
- 같은 displayName이 여러 row에 중복: "AI 방과후 (운영)" → `docker` + `ais-prod` 두 row
- "뉴스 서비스 (운영)" 변형 → `news-sentiment-prod`, `news-sentiment-analyzer2`, `news-prod` 세 row
- 메인 페이지에서 "AI 방과후 (운영)" 그룹이 두 번 보일 수 있음

**(D) v0.1 dogfooding 미실행 상태**
- `audit_logs` 테이블 0행 → restart/start/stop 한 번도 호출 안 됨
- 즉 v0.1의 "관리 액션 사이클"은 사실상 미검증
- (D)는 v0.1.1의 핵심 스코프는 아니지만, cleanup 후 RUNBOOK 체크리스트 재실행을 통해 부분적으로 보완

## 2. 목표 / 비목표

### 목표

1. 현재 DB의 좀비 row 15개를 안전하게 제거하고 정상 row 8개(라이브 compose label 가진 그룹)만 남긴다.
2. 향후 좀비 재발을 코드 수준에서 막는다.
3. live container 0개인 project를 UI에서 즉시 식별 가능하게 한다 ("Stale" 배지).
4. 운영자가 향후에도 사용할 수 있는 idempotent cleanup 도구를 제공한다.

### 비목표

- compose project 단위가 아닌 cluster 단위 그룹핑 (Option B; v0.2 후보로 deferred).
- audit_logs / 관리 액션 사이클 자동화 검증 (수동 RUNBOOK 체크리스트로 처리).
- standalone 컨테이너(라벨 없음)의 그룹핑 개선.
- 호스트가 늘었을 때의 다중 호스트 정책 (현재 home-server 1대만 운영 중).

## 3. 결정 사항 (D1-D6)

| ID | 질문 | 결정 |
|----|------|------|
| D1 | 작업 범위 | gons-dashboard 모니터 보완 (코드 작업) |
| D2 | 최초 좀비 정리 방식 | 1회성 SQL migration + seed 재실행 |
| D3 | Stale 감지 시점 | 페이지 렌더링 시 실시간 |
| D4 | Cleanup 도구 형태 | `pnpm db:cleanup-projects` 스크립트 (idempotent, dry-run 기본) |
| D5 | Stale 배지 조건 | live container 0개 |
| D6 | 재발 방지 | lazy upsert에 known_compose_keys 검증 |

## 4. 아키텍처

### 변경되는 레이어

```
src/
├── shared/lib/db/
│   └── (drizzle migration: 0006_purge_zombie_projects.sql)
├── entities/project/
│   └── api/
│       ├── upsertProjectFromContainer.ts  ← (수정) whitelist 검증 추가
│       └── isKnownComposeProject.ts        ← (신규) 화이트리스트 헬퍼
├── features/host-catalog/
│   └── api/getHostsWithSummary.ts          ← (수정) Stale 플래그 계산
├── features/container-list/
│   └── ui/ProjectGroupSection.tsx          ← (수정) Stale 배지 렌더
└── scripts/
    └── cleanup-projects.ts                  ← (신규) idempotent cleanup
```

### 데이터 흐름

```
[페이지 렌더링]
  page.tsx
    ↓
  getHostsWithSummary()
    ├→ listContainers()   (Docker CLI)
    ├→ getProjects(hostId) (DB)
    ├→ groupByProject() → ProjectGroup[]
    │     각 group에 isStale 계산 (live containers === 0)
    └→ HostSummary { groups, daemonOk, ... }
    ↓
  ProjectGroupSection (각 그룹)
    ├ Stale 배지 (group.isStale일 때 회색 "no live containers")
    └ 컨테이너 행들

[lazy upsert]
  upsertProjectFromContainer(hostId, composeProject)
    ├→ if (!isKnownComposeProject(composeProject)) → return null (silent skip + log warning)
    └→ insert/update

[수동 cleanup]
  pnpm db:cleanup-projects [--apply]
    1. 실시간 Docker ps에서 live composeProject set 수집
    2. seed-projects.ts의 whitelist와 합집합 = "known set"
    3. DB에서 known set에 없는 project row 식별
    4. dry-run: 콘솔에 삭제 후보 출력
    5. --apply: DELETE (audit_logs는 ON DELETE SET NULL 또는 CASCADE; 4.4 참조)
```

### 컴포넌트 / 함수 명세

#### 4.1 `isKnownComposeProject(composeProject: string): boolean`

새 헬퍼. seed-projects.ts와 같은 whitelist를 1곳에서 관리.

```typescript
// src/entities/project/api/isKnownComposeProject.ts
import { KNOWN_COMPOSE_PROJECTS } from "../config/knownComposeProjects";

export function isKnownComposeProject(composeProject: string): boolean {
  return KNOWN_COMPOSE_PROJECTS.has(composeProject);
}
```

`knownComposeProjects.ts`는 host별 set을 export:
```typescript
export const KNOWN_COMPOSE_PROJECTS_BY_HOST: Record<string, ReadonlySet<string>> = {
  "home-server": new Set([
    "ai-afterschool-ex",
    "ai-afterschool-fsd",
    "cli-proxy-api",
    "docker",
    "docker-n8n",
    "gons-dashboard",
    "news-sentiment-analyzer2",
    "news-sentiment-prod",
  ]),
};
```

`seed-projects.ts`도 이 모듈을 import해서 단일 진실 원천 유지.

#### 4.2 `upsertProjectFromContainer` 수정

```typescript
export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project | null> {
  if (!isKnownComposeProject(input.composeProject)) {
    console.warn(
      `[upsert] unknown composeProject="${input.composeProject}" skipped`,
    );
    return null;
  }
  // 기존 insert/update 로직...
}
```

호출자(`getHostsWithSummary.ts`)는 `null` 결과를 필터링하고, unknown 키를 가진 컨테이너는 standalone 그룹에 포함시킨다.

#### 4.3 `groupByProject` 변경 (그룹화 로직 전환)

**현행 동작**: `groupByProject(containers, projects)`는 *컨테이너 기준*으로 그룹을 만든다 → live container가 없는 project는 자연 누락됨 → 좀비/Stale을 UI에서 볼 수 없음.

**v0.1.1 동작**: *project 기준*으로 그룹 슬롯을 만들고, 컨테이너를 슬롯에 매칭. 컨테이너가 0개면 `isStale=true` 마킹. unknown composeProject를 가진 컨테이너는 standalone 그룹으로 합류.

타입 변경:
```typescript
export type ProjectGroup = {
  // ... 기존 필드 ...
  isStale: boolean;  // 신규 — live container 0개일 때 true
};
```

이 전환은 **현재의 `groupByProject` 단위 테스트를 깨뜨릴 수 있다** → 테스트 케이스 추가 + 기존 케이스의 expected 결과 갱신 필요.

#### 4.4 1회성 정리 migration `drizzle/0006_purge_zombie_projects.sql`

```sql
-- audit_logs는 v0.1에서 0행 (정밀 분석 확인) → CASCADE 안전
-- 하지만 향후를 대비해 명시적 SET NULL로 처리

DELETE FROM projects
WHERE host_id = (SELECT id FROM hosts WHERE name = 'home-server')
  AND compose_project NOT IN (
    'ai-afterschool-ex',
    'ai-afterschool-fsd',
    'cli-proxy-api',
    'docker',
    'docker-n8n',
    'gons-dashboard',
    'news-sentiment-analyzer2',
    'news-sentiment-prod'
  );
```

배포 후 `pnpm db:seed:projects` 1회 재실행으로 displayName/description 재정렬.

#### 4.5 `pnpm db:cleanup-projects` 스크립트

`src/scripts/cleanup-projects.ts`. 핵심 로직:

```typescript
async function main() {
  const apply = process.argv.includes("--apply");

  for (const host of await getHosts()) {
    // 1. live compose set
    const containers = await listContainers({ hostId: host.id, dockerContext: host.dockerContext });
    const liveSet = new Set(
      containers
        .map((c) => c.composeProject)
        .filter((k): k is string => k != null),
    );

    // 2. whitelist
    const whitelist = KNOWN_COMPOSE_PROJECTS_BY_HOST[host.name] ?? new Set();

    // 3. 합집합 = known
    const known = new Set([...liveSet, ...whitelist]);

    // 4. DB의 row 중 known에 없는 것
    const dbRows = await db.select().from(projects).where(eq(projects.hostId, host.id));
    const candidates = dbRows.filter((r) => !known.has(r.composeProject));

    if (candidates.length === 0) {
      console.log(`[${host.name}] no zombies to clean`);
      continue;
    }

    console.log(`[${host.name}] zombie candidates (${candidates.length}):`);
    for (const c of candidates) {
      console.log(`  - ${c.composeProject} (${c.displayName})`);
    }

    if (apply) {
      const ids = candidates.map((c) => c.id);
      await db.delete(projects).where(inArray(projects.id, ids));
      console.log(`[${host.name}] deleted ${ids.length} rows`);
    } else {
      console.log(`[${host.name}] dry-run. rerun with --apply to delete.`);
    }
  }
}
```

`package.json` script:
```json
"db:cleanup-projects": "tsx src/scripts/cleanup-projects.ts"
```

#### 4.6 UI 변경 (ProjectGroupSection)

```tsx
{group.isStale && (
  <span className="ml-2 inline-flex items-center rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
    no live containers
  </span>
)}
```

`isStale` 그룹은 hidden 그룹과는 다르게 표시. 컨테이너 행 영역엔 "(live container 없음)" 안내 문구.

## 5. 에러 처리

| 시나리오 | 동작 |
|---------|------|
| Docker daemon 다운 → cleanup 스크립트가 live set을 못 가져옴 | whitelist만으로 비교 (보수적). 에러 로그 + exit 1. |
| `--apply` 도중 일부 row만 삭제되고 실패 | drizzle 트랜잭션 사용. rollback 후 에러 출력. |
| `upsertProjectFromContainer`이 unknown 받음 | warn 로그 + null 반환. 호출자는 standalone으로 fallback. |
| Stale 그룹의 displayName이 비어있음 | composeProject를 fallback으로 표시. |

## 6. 테스트 전략

### 단위 테스트

- `isKnownComposeProject(known)` → true / `(unknown)` → false
- `upsertProjectFromContainer` unknown 입력 시 DB insert 안 일어남 + null 반환 (mock DB)
- `groupByProject` 입력에 live 0개 project가 포함되면 `isStale=true` 그룹 반환

### 통합 테스트 (test DB)

- 좀비 row 미리 심어놓고 cleanup 스크립트 dry-run → 삭제 후보가 정확히 출력
- `--apply` 후 DB row 9개만 남는지 확인

### 수동 검증 (RUNBOOK 체크리스트)

배포 후:
1. `pnpm db:cleanup-projects` (dry-run) → 좀비 15개 출력 확인
2. `pnpm db:cleanup-projects --apply` → 삭제 실행
3. `pnpm db:seed:projects` → displayName/description 재정렬
4. `/` 페이지 새로고침 → 그룹 9개로 정리됨
5. 임의로 컨테이너 1개 stop → 같은 group 안에서 컨테이너만 사라지고 group은 유지 (state badge로 표시)
6. compose project 전체 down → 다음 새로고침에서 group이 "no live containers" 배지로 표시

## 7. 마이그레이션 / 배포 순서

```
1. PR 머지 + GHA 빌드 완료
2. dcserver pull app cron
3. dcserver up -d app cron       # migration 0006 자동 적용
4. (운영 서버에서) pnpm db:seed:projects   # displayName 재정렬
5. https://gons.krdn.kr → 그룹 9개 확인
6. (선택) pnpm db:cleanup-projects   # 향후 좀비 발생 시 사용
```

## 8. 후속 (v0.2 후보)

- Cluster-aware grouping (Option B): `news-sentiment-prod` + `news-sentiment-analyzer2`를 "뉴스 서비스" 단일 그룹으로 묶기
- audit_logs 사용 사이클 자동 검증 (E2E + Playwright)
- standalone 컨테이너에 사용자 정의 태그 부여
- 호스트가 2대 이상일 때 cleanup 스크립트의 다중 호스트 정책 (현재는 host loop)

## 9. 부록 A — 현재 23개 row의 분류

| compose_project | 분류 | 처리 |
|-----------------|------|------|
| ai-afterschool-ex | ✅ live + whitelist | 보존 |
| ai-afterschool-fsd | ✅ live + whitelist | 보존 |
| cli-proxy-api | ✅ live + whitelist | 보존 |
| docker | ✅ live + whitelist | 보존 |
| docker-n8n | ✅ live + whitelist | 보존 |
| gons-dashboard | ✅ live + whitelist | 보존 |
| news-sentiment-analyzer2 | ✅ live + whitelist | 보존 |
| news-sentiment-prod | ✅ live + whitelist | 보존 |
| ai-afterschool | ❌ 좀비 | 삭제 |
| ai-afterschool-fsd-web | ❌ 좀비 (컨테이너 이름 오인) | 삭제 |
| ai-health | ❌ 좀비 | 삭제 |
| ai-model-setup | ❌ 좀비 | 삭제 |
| ai-news-analyzer | ❌ 좀비 | 삭제 |
| ais-collector | ❌ 좀비 | 삭제 |
| ais-prod | ❌ 좀비 (displayName 중복) | 삭제 |
| krdn-fx | ❌ 좀비 (live 없음) | 삭제 |
| n8n | ❌ 좀비 (service 이름) | 삭제 |
| news-prod | ❌ 좀비 (displayName 중복) | 삭제 |
| nitter | ❌ 좀비 (live 없음) | 삭제 |
| open-webui | ❌ 좀비 (라벨 없는 standalone) | 삭제 |
| voice | ❌ 좀비 (live 없음) | 삭제 |
| vscode | ❌ 좀비 (service 이름) | 삭제 |
| web | ❌ 좀비 (service 이름) | 삭제 |

**보존 8 / 삭제 15 = 총 23**
