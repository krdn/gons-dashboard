# GitHub 관제 수동 새로고침 — 설계

- **날짜**: 2026-07-21
- **관련 이슈**: #323 (GitHub 관제)
- **브랜치**: feat/github-monitoring

## 배경

`/monitoring/github` 페이지는 두 계층으로 데이터를 갱신한다.

1. **수집 계층** — cron `POST /api/cron/github-sync` 가 5분마다 `syncGithub()` 를
   실행해 GitHub 이슈·PR·Actions·Build 상태를 DB 스냅샷으로 적재한다.
2. **표시 계층** — 페이지가 15초마다 `router.refresh()`(`<AutoRefresh>`) 로 RSC 를
   재요청해 **이미 적재된 DB 스냅샷**을 다시 읽어 화면을 갱신한다.

즉 표시 계층의 15초 폴링은 GitHub 를 호출하지 않는다. 실제 GitHub 재수집은
cron 만 수행하므로, 사용자가 방금 GitHub 에서 한 변경(예: 이슈 일괄 close)을
대시보드에서 즉시 확인하려면 **최대 5분**을 기다려야 한다.

## 목표

관제 페이지에 **수동 새로고침 버튼**을 추가한다. 클릭하면 cron 을 기다리지 않고
즉시 `syncGithub()` 를 실행해 GitHub 에서 최신 데이터를 재수집하고 DB 를 갱신한
뒤, 화면에 반영한다.

## 확정된 요구사항

- **동작**: 버튼 클릭 → `syncGithub()` 즉시 실행 (GitHub API 호출 + DB 쓰기)
  → 완료 후 `router.refresh()` 로 화면 갱신.
- **접근 통제**: 로그인한 모든 사용자. 페이지 자체가 로그인 게이트로 보호되고
  로그인은 `ALLOWLIST_EMAILS` 로 제한되므로, 버튼은 로그인 여부만 확인한다.
- **rate limit**: 전역(사용자 무관) in-memory 쿨다운 **30초**. GitHub API 남용 방지.

## 접근법 결정

**옵션 A — Server Action 직접 호출 (채택)**

`syncGithub()` 를 감싸는 `"use server"` Server Action 을 새로 만들고, client 버튼이
`useTransition` 으로 호출한다.

- `syncGithub()` 는 이미 `import "server-only"` + advisory lock + `lockBusy`/`skipped`
  처리를 완비하고 있어 **핵심 수집 로직은 손대지 않는다**. Server Action wrapper 만
  추가한다.
- `catalog-refresh`·`stock-analysis-server` 가 이미 쓰는 프로젝트 관용 패턴
  (Server Action + `useTransition` + client seam) 을 그대로 따른다.
- cron 라우트(`/api/cron/github-sync`) 를 건드리지 않는다.

**옵션 B — 기존 cron 라우트를 fetch 로 재사용 (기각)**

버튼이 `POST /api/cron/github-sync` 를 `CRON_BEARER_TOKEN` 과 함께 호출하는 방식.
client 에서 bearer token 을 노출할 수 없어 별도 프록시 라우트가 필요하고, cron
라우트는 `createCronHandler` 로 감싸져 응답 형태가 버튼용이 아니다. 더 복잡해 기각.

## 아키텍처 & 파일 구조

새 feature `github-monitor-refresh` 를 만든다. `syncGithub()` 이 `server-only` 를
import 하므로 **CLAUDE.md Gotcha #7 의 server/client seam 분리가 필수**다.
기존 `github-monitor/index.ts` 는 이미 server-only barrel 이라 여기에 Server Action 을
섞으면 client import 시 build 가 깨진다 — 별도 feature 로 격리한다.

```
features/github-monitor-refresh/
├── index.ts          # server entrypoint (seam 규칙 준수용, server-only 표식)
├── client.ts         # "use client" 트리가 import — refreshGithubMonitor 재-export만
├── api/
│   └── refreshAction.ts   # "use server" — auth + rate limit + syncGithub() 호출
└── ui/
    └── RefreshButton.tsx   # "use client" — useTransition + router.refresh()
```

## Server Action — `api/refreshAction.ts`

```typescript
"use server";

export interface RefreshResult {
  ok: boolean;
  error?: string;
  summary?: {
    issues: number;
    pulls: number;
    runs: number;      // 성공 레포 수
    skipped: boolean;  // 토큰 미설정
    lockBusy: boolean; // cron 과 겹침
  };
  cooldownSec?: number; // rate limit 걸렸을 때 남은 초
}

export async function refreshGithubMonitor(): Promise<RefreshResult>;
```

동작 순서:

1. **인증** — `auth()` 로 `session.user.id` 확인. 없으면
   `{ ok: false, error: "Unauthorized" }`.
2. **Rate limit** — 전역(사용자 무관) in-memory 쿨다운 30초. 걸리면
   `{ ok: false, error: "잠시 후 다시 시도하세요 (N초 남음)", cooldownSec }`.
   전역인 이유: GitHub API rate limit 은 토큰 단위(사용자 무관)라 공유 자원이다.
   두 사용자가 동시에 눌러도 하나의 API budget 을 쓴다.
3. **`syncGithub()` 호출** — 이미 advisory lock 으로 재진입 안전. cron HTTP 진입점과
   Server Action 진입점 둘이 겹쳐도 나중 것이 `lockBusy: true` 로 즉시 반환된다.
4. **결과 매핑** — `SyncSummary` → `RefreshResult.summary`. 전체를 `try/catch` 로 감싸
   예상 밖 오류도 `{ ok: false, error }` 로 떨어뜨린다.

### 쿨다운과 lockBusy 의 구분

- **쿨다운** = "너무 자주 눌렀다" (API 절약 목적, 이 액션이 자체적으로 판단).
- **lockBusy** = "지금 다른 실행(주로 cron)이 락을 쥐고 있다" (동시성, `syncGithub` 이
  판단). 이번 재수집은 수행되지 않았지만 진행 중인 실행이 곧 DB 를 갱신한다.

사용자에게는 둘 다 "곧 반영됩니다" 계열 메시지로 보이지만 내부 상태가 다르므로
구분해 처리한다.

## UI — `ui/RefreshButton.tsx`

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshGithubMonitor, type RefreshResult } from "../client";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await refreshGithubMonitor();
      setResult(r);
      if (r.ok) router.refresh(); // DB 갱신됐으니 RSC 재요청해 화면 반영
    });
  };
  // 버튼 + 결과/에러 피드백 (catalog-refresh 스타일)
}
```

동작 흐름:

1. 클릭 → `isPending=true` ("새로고침 중…"), 버튼 disabled.
2. Server Action 이 `syncGithub()` 완료까지 대기 (GitHub API 왕복, 수 초).
3. `r.ok` → `router.refresh()` → 페이지 RSC 재실행 → 방금 갱신된 DB 스냅샷 표시.
4. 피드백 메시지:
   - 성공: "갱신 완료" (선택적으로 summary 요약).
   - `lockBusy`: "동기화 진행 중 — 곧 반영됩니다".
   - `skipped`: "토큰 미설정".
   - 쿨다운: "N초 후 다시 시도하세요".
   - 에러: 오류 메시지.

## 페이지 통합 — `github/page.tsx`

`PageHeader` 는 이미 `actions?: ReactNode` slot 을 지원한다
(`shared/ui/PageHeader.tsx`). `<RefreshButton />` 을 `actions` 로 주입해 제목 우측에
배치한다:

```tsx
<PageHeader title="GitHub 관제" subtitle={...} actions={<RefreshButton />} />
```

`<AutoRefresh intervalMs={15_000} />` 는 그대로 유지한다 — 수동 버튼은 즉시성을
더할 뿐, 15초 표시 폴링을 대체하지 않는다.

## 테스트 & 검증

- **단위 테스트** (`api/refreshAction.test.ts`): `syncGithub` 과 `auth` 를 mock 해서:
  - (a) 미인증이면 `{ ok: false, error: "Unauthorized" }`.
  - (b) 쿨다운 내 재호출이면 `cooldownSec` 포함해 거부.
  - (c) `lockBusy` / `skipped` summary 매핑.
  - (d) 정상 summary 매핑.
  - ⚠️ vitest include 밖 경로면 조용히 skip 되므로 단일 경로로 "1 passed" 확인
    (메모리 `vitest-include-tsx-silent-skip`).
- **빌드 검증**: `cd apps/dashboard && pnpm build` 필수. server/client seam 위반
  (Gotcha #7) 은 typecheck/lint 로 안 잡히고 build 에서만 드러난다.
- **dogfood smoke**: dev 서버에서 실제 버튼 클릭. dev 는 운영 DB 를 보므로
  (메모리 `dev-server-prod-db-blocks-dogfood`) 실제 운영 org 데이터를 갱신한다는 점을
  인지하고 진행한다. GitHub 재수집은 읽기 위주라 비교적 안전하다.

## 범위 밖 (YAGNI)

- SSE / WebSocket 실시간 push — 이슈 #323 §3 이 폴링 우선으로 이미 결정.
- 소스별(이슈만/PR만) 선택 재수집 — 전체 `syncGithub()` 로 충분.
- 사용자별 쿨다운 — 공유 자원(단일 토큰 rate limit)이라 전역이 옳다.
- 재수집 진행률(progress) 표시 — `syncGithub` 이 단일 await 라 중간 진행 상태 없음.
