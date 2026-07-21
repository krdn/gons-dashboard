# 이벤트 타임라인 세로 길이 억제 — "더보기" 접힘 설계

- **이슈**: [#342](https://github.com/krdn/gons-dashboard/issues/342) — 관제 이벤트 타임라인 위젯이 세로로 너무 길다
- **날짜**: 2026-07-22
- **대상**: `apps/dashboard/src/widgets/monitoring/ui/EventsTimeline.tsx`

## 문제

`/monitoring` 인프라 보드의 이벤트 타임라인(`EventsTimeline`)이 세로로 과도하게 길다.

- `page.tsx:61`이 `listRecentEvents(50)`으로 **최대 50건**을 넘기고, 위젯이 이를 상한·페이징 없이 `.map()`으로 **전부 세로 리스트(`<ol>`)로 렌더**한다.
- 히어로 행에서 이 위젯은 `md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]`의 **4fr 좁은 사이드 컬럼**에 있어, 각 이벤트 카드(제목 + detail 줄) 텍스트가 줄바꿈되며 세로 길이가 더 늘어난다.
- resolved(해소) 이벤트도 `opacity-60`으로 계속 남아 목록이 줄지 않는다.

## 해결 방향 (확정)

**초기 8건만 표시하고, 나머지는 "더보기" 토글로 펼친다.** 소싱은 그대로 두고 클라이언트에서 표시만 제어한다.

## 설계

### 1. 서버 컴포넌트 → 클라이언트 컴포넌트 전환

`EventsTimeline`은 현재 순수 서버 컴포넌트다. "더보기" 토글에 `useState`가 필요하므로 파일 상단에 `"use client"`를 추가하고 `useState`를 도입한다.

- **데이터 흐름 불변**: `page.tsx:61`의 `listRecentEvents(50)`은 유지. 서버에서 50건을 받아 props로 넘기고, 잘라내기(slice)는 **클라이언트 표시 단계에서만** 수행한다. 펼침 시 추가 요청 없음(already-fetched).
- **FSD 경계 불변**: 파일 위치·import 경로 그대로. `@/entities/monitoring/server`에서 가져오는 `MonitoringEventRow`·`EventSeverity`는 **`type` 전용 import**라 `"use client"`에서도 안전(타입은 번들에 실리지 않음). 값 import는 없다.
- **now prop**: 서버에서 내려온 `now: Date`를 상대시각 표시에 계속 사용한다. 클라이언트에서 `Date.now()`/`new Date()`를 호출하지 않는다 (Gotcha #3 hydration, React 19 purity 규약).

### 2. 표시 로직

```
INITIAL = 8  // 상수

const [expanded, setExpanded] = useState(false)
const visible = expanded ? events : events.slice(0, INITIAL)
const hasMore = events.length > INITIAL
```

- `<ol>`은 `visible`만 렌더.
- 토글 버튼은 `hasMore`일 때만 `<ol>` **아래**에 렌더.
  - 접힘: `더보기 {events.length - INITIAL}건`
  - 펼침: `접기`
- 8건 이하면 버튼이 뜨지 않아, 평상시 UI는 기존과 사실상 동일.
- 0건이면 기존 empty-state("이벤트 없음 — 모든 지표가 정상 범위입니다.") 유지.

### 3. 스타일 & 접근성

- 버튼: `w-full`, `text-xs`, 상단 hairline 구분(`border-t border-[var(--color-hairline)]`), `text-[var(--color-text-muted)]`, `hover:bg-[var(--color-surface-2)]`. 라이트 모드 고정·`--color-*` 토큰 규약 유지.
- `aria-expanded={expanded}`를 버튼에 부여.
- 기존 severity 색+아이콘+텍스트 병행 접근성, resolved "해소" 배지(취소선 아님) 유지.

## 테스트

기존 `EventsTimeline.test.tsx`(jsdom + RTL)에 케이스 추가:

- 9건 이상 → 초기 8건만 렌더 + "더보기 N건" 버튼 노출
- "더보기" 클릭 → 전체 렌더 + 버튼 라벨이 "접기"로 전환
- 8건 이하 → 토글 버튼 없음 (`queryBy...` null)
- 0건 → empty-state 문구 유지

### 회귀 주의 (메모리 교훈)

- `vitest-include-tsx-silent-skip`: 새 테스트가 실제로 도는지 단일 경로로 "passed" 카운트 확인.
- `plan-written-tests-need-execution`: RTL cleanup·클릭 후 재조회 등은 실행 전엔 신뢰하지 않는다 → 반드시 실행.

## 검증

- `pnpm typecheck && pnpm lint`
- `cd apps/dashboard && pnpm build` — **`"use client"` 전환이라 필수** (Gotcha #7: typecheck/lint만으론 server/client seam 문제를 못 잡음).
- 테스트 실행으로 위 케이스 green 확인.
- 배포: CI success ≠ 배포 (`ci-build-not-equals-deploy`) — digest/health/route(≠404)/restarts=0 확인.

## 스코프 제외 (YAGNI)

- resolved 이벤트 숨김 토글 — 필요 시 후속 이슈.
- max-height 스크롤 컨테이너.
- "전체 이벤트" 별도 페이지 — 50건 전부 인라인 접근 가능하므로 불필요.
