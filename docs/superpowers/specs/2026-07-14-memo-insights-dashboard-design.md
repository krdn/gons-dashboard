# 메모 인사이트 대시보드 (`/memos/insights`) — 설계

- **날짜**: 2026-07-14
- **도메인**: Memo
- **상태**: 설계 승인됨 (사용자), spec 리뷰 대기 (Codex)
- **선례 패턴**: `/memos/architecture` (PR #301, 새 라우트 + 위젯 미러링)

## 1. 목표와 범위

실제로 쌓인 메모 데이터를 분석해 **개인 인사이트 대시보드**로 보여준다. 코드
아키텍처 시각화(`/memos/architecture`, 이미 존재)와는 별개 — 이건 **사용자의
메모 데이터** 자체를 시각화한다.

사용자가 확정한 4개 인사이트 축:

1. **기록 활동 패턴** — 언제 얼마나 기록하는가 (히트맵, 추이, streak)
2. **카테고리 분포** — 무엇에 대해 기록하는가 (동적 카테고리, voice/text)
3. **메모→액션 전환** — 메모가 할일·일정으로 얼마나 이어졌는가
4. **주간 회고 / 재부상** — 주간 다이제스트 시계열 + 재부상 메모 흐름

**범위 밖 (YAGNI)**: 필터/드릴다운 인터랙션, 날짜 범위 선택기, 내보내기,
다른 사용자와 비교, SQL 집계 최적화 (개인 규모라 앱 계층 집계로 충분).

## 2. 배치 & 아키텍처

`/memos/architecture`와 동일 패턴을 미러링한다.

- **새 라우트**: `apps/dashboard/src/app/(dashboard)/memos/insights/page.tsx`
  - RSC. `auth()` 가드 → 미인증 시 `redirect("/login")`.
  - `export const dynamic = "force-dynamic"`.
  - `PageContainer width="narrow"` + `PageHeader`(title "메모 인사이트",
    actions에 `← 메모` 링크).
  - 서버에서 DB 조회 → `widgets/memo-insights/server` 의 집계 함수 호출 →
    차트-ready 데이터를 위젯 뷰에 props 전달.
- **새 위젯**: `apps/dashboard/src/widgets/memo-insights/` — **server/client seam
  분리** (Gotcha #7, entity barrel seam 미러):
  - `server.ts` — server entrypoint. `lib/aggregate.ts` 의 순수 집계 함수 5개를
    re-export. RSC 페이지는 **이 경로로만** import.
  - `index.ts` — client barrel. `ui/MemoInsightsView.tsx` (`"use client"`,
    recharts) + 블록 컴포넌트만 export. 클라이언트 뷰가 쓰는 결과 타입은
    `model/types.ts` (중립 모듈, server/client 양쪽 import 가능)에 둔다.
  - `lib/aggregate.ts` — 순수 함수 (DOM/DB 의존 없음). 집계 결과 타입은
    `model/types.ts` 에서 import. 단위 테스트 대상.
  - **집계는 서버 RSC에서 끝내고, raw 메모는 클라이언트로 넘기지 않는다** —
    위젯 뷰는 차트-ready 데이터만 받는 presentational 계층.
- **`/memos` 헤더 링크 추가**: 기존 `🗺 시스템 구조`·`⚙ AI 정리 설정` 옆에
  `📊 인사이트` (`/memos/insights`) 한 줄.

**데이터 흐름**:
```
insights/page.tsx (RSC)
  ├─ const now = new Date()  ← 한 번 캡처, 집계에 주입 (KST 산술 고정)
  ├─ listMemoFactsForInsights(userId)   ← 신규, 캡 없음
  ├─ listDigestsByUser(userId)          ← 신규
  ├─ listActionItemsByUser(userId, [4개 상태 전부])  ← 기존 재사용
  ├─ listTransformationsByUser(userId)  ← 기존 재사용
  └─ listCategories()                   ← 기존 재사용
       ↓ (Promise.all 병렬)
  widgets/memo-insights/server 의 집계 함수 5개로 차트-ready 데이터 생성
    (buildActivityHeatmap·buildDailyTrend 에는 now 주입)
       ↓ props
  MemoInsightsView ("use client", recharts) ← widgets/memo-insights (index.ts)
```

## 3. 데이터 계층

### 3.1 캡 문제 (load-bearing)

`memoRepo.listMemos`는 `LIMIT 200` (`LIST_MEMOS_LIMIT`, memoRepo.ts:10,18)이
걸려 있다. 이 함수를 집계에 쓰면 메모 200개 초과 시 히트맵·총계·카테고리
비율이 **조용히 잘려** 틀린 인사이트를 낸다. 따라서 인사이트는 **캡 없는 전용
조회**를 쓴다.

### 3.2 신규 조회 함수 (2건, 모두 단순 SELECT — SQL 집계 아님)

집계는 앱 계층(JS)에서 하되, 조회는 캡 없이 가져온다. "앱 계층 집계" 원칙 유지.

1. **`listMemoFactsForInsights(userId)`** → `entities/memo/api/memoRepo.ts` 신설, `server.ts` export
   - 반환 타입: `MemoFact[]` = `{ id: string; source: MemoSource; category: string | null; createdAt: Date; actionsExtractedAt: Date | null }[]`
   - **전체 텍스트(rawContent/cleanedContent/title) 제외** — 집계 축만 SELECT.
     content를 빼면 수천 행도 가볍다. 히트맵·카테고리·소스 비율·전환율 전부
     이 한 조회로 커버. 캡 없음. `orderBy(createdAt asc)`.
   - **타입 좁히기 (Codex WARN)**: `memos.source` 는 bare `text()` 라 Drizzle
     select 타입이 `string`. projection 시 `MemoSource`(`'voice'|'text'`) 로
     좁혀야 한다 — repo 함수 안에서 `source as MemoSource` 단언(값은 DB CHECK로
     보장) 또는 반환 매핑 시 명시 좁히기. `MemoFact.source: MemoSource` 계약 유지.
2. **`listDigestsByUser(userId)`** → `entities/memo/api/memoDigestRepo.ts` 신설, `server.ts` export
   - 반환: `MemoDigest[]`, `weekEnd` 오름차순. 주간 타임라인용.
   - 기존엔 `getLatestDigest`만 있어 시계열을 못 그렸다.

### 3.3 기존 함수 재사용

- **`listActionItemsByUser(userId, statuses)`**: **4개 상태 전부**
  (`["proposed","accepted","done","dismissed"]`) 전달 — 상태 분포용.
  함수는 이미 `statuses[]`를 받으므로 시그니처 변경 없음. 반환 행의 `status` 는
  **타입 좁히기 (Codex WARN)**: 반환 `MemoActionItem` 은 Drizzle 추론 타입이고
  `memo_action_items.status` 는 bare `text()` 라 `status: string` 이다. 집계 전
  `{ memoId, status: status as ActionItemStatus }` 로 명시 매핑·단언(값은 DB
  CHECK로 보장)하거나 `isActionItemStatus` guard로 좁힌 뒤
  `Record<ActionItemStatus, number>` 를 만든다.
- **`listTransformationsByUser(userId)`**: 변환본 통계용. **slug 기준 그룹화**
  (Codex WARN) — `preset` (커스텀 slug 포함 일반 문자열) 을 그룹 키로 쓰고,
  라벨은 `presetLabel → 빌트인 라벨(TRANSFORM_PRESET_LABELS) → slug` 폴백
  (기존 `MemoCard.tsx:33` 과 동일 규칙). 결과: `{ slug, label, count }[]`.
  **결정적 라벨 선택 (Codex NOTE)**: 같은 slug의 `presetLabel` 스냅샷이 행마다
  다를 수 있으므로, 그룹 대표 라벨은 **가장 최근(createdAt desc) non-null
  `presetLabel`** 을 쓰고, 없으면 폴백 체인. 조회 순서에 무관하게 결정적.
- **`listCategories()`**: 카테고리 slug→labelKo 매핑.

### 3.4 순수 집계 함수 (`widgets/memo-insights/lib/aggregate.ts`) — **5개**

각 함수는 **빈 배열 입력에서 안전한 기본값**을 반환한다 (§5 빈 상태 요건과 연결).
결과 타입은 `widgets/memo-insights/model/types.ts` 에 정의 (client 뷰 공유).

**KST 날짜 계약 (Codex WARN — 고정)**: 기준 시각 `now` 를 RSC 페이지에서 한 번
캡처해 시간 의존 함수에 **주입**한다 (순수성 유지 — 함수 내부에서 `new Date()`
금지). 모든 일자 버킷은 **KST(Asia/Seoul) 자정 경계** 기준. 날짜 산술은
`now` 기반으로 결정적.

- `buildActivityHeatmap(facts, now): { weeks: DayCell[][]; windowCount; totalCount; currentStreak; longestStreak; dailyAvg }`
  - **고정 26주(182일) 그리드** — `now` 의 KST 오늘을 마지막 열로, 과거 방향
    26주를 채운다. **모든 날짜 셀 존재** (0건 날은 회색 `count:0` 셀). "있는
    주만" 표현 아님 (Codex WARN 반영 — §5도 이에 맞춤).
  - **분자 확정 (Codex WARN)**: 입력 `facts` 는 전체 이력이므로 카운트를 분리한다.
    `windowCount` = 182일 그리드 창 내부 메모 수, `totalCount` = 전체 이력 수
    (요약 표시용). `dailyAvg = windowCount / 182` (창 내부 기준 — 전체 이력을
    182로 나누지 않는다).
  - `currentStreak`: KST 오늘부터 역방향 연속 기록일. **오늘 기록이 없으면
    어제부터** 카운트 (오늘 미기록이 streak을 즉시 0으로 만들지 않음).
  - `longestStreak`: 26주 창 내 최장 연속 기록일.
- `buildDailyTrend(facts, now, days): { date: string; count: number }[]`
  - `now` 의 KST 오늘부터 과거 `days` 일 (기본 `days=30`). 각 날짜 라벨은
    locale-free `YYYY-MM-DD`. 기록 없는 날도 `count:0` 으로 포함 (연속 축).
- `buildCategoryDistribution(facts, categories): { byCategory: { slug; labelKo; count }[]; voiceCount; textCount; unclassifiedCount }`
- `buildActionConversion(facts, actionItems, transformations)` — **BLOCK 1 반영,
  메모 단위와 액션-행 단위를 분리**:
  ```
  {
    // 메모 단위 퍼널 (단조 감소 보장)
    totalMemos: number;              // facts.length
    processedMemos: number;          // actionsExtractedAt != null 인 메모 수 (추출 시도 완료)
    memosWithActions: number;        // 액션 행이 1개 이상 달린 고유 memoId 수
    // 액션-행 단위 현재 상태 분포 (퍼널 밖, 별도 표시)
    currentStatusCounts: Record<ActionItemStatus, number>;
    // 변환본
    transformCount: number;
    transformByPreset: { slug: string; label: string; count: number }[];
  }
  ```
  - `processedMemos`(0건도 포함하는 "추출 처리 완료")와 `memosWithActions`(실제
    액션이 생긴 메모)를 구분 — `actionsExtractedAt` 이 액션 유무와 무관함을 반영.
  - `accepted`는 done/dismissed로 전이하면 사라지는 **현재 상태**이므로 퍼널
    단계로 쓰지 않고 `currentStatusCounts` 스냅샷으로만 표시. "과거 accepted 비율"
    같은 이력 지표는 상태 이력 스키마가 없어 **이번 범위 제외** (Codex NOTE).
- `buildDigestTimeline(digests): { weekEnd: string; memoCount: number; resurfacedCount: number }[]`

## 4. 시각화 구성 (bento 카드 그리드)

`MemoInsightsView`는 라이트 모드 고정 + 기존 디자인 토큰(`globals.css`) 재사용.
recharts 3.8.1 (이미 설치). 차트 색 팔레트는 `dataviz` 스킬로 검증 (접근성·일관성).

**블록 A — 기록 활동 패턴**
- 활동 히트맵: 최근 26주(182일) 요일×주 그리드 (GitHub 스타일). recharts 미지원
  이라 **CSS grid + 단색 명도 스케일**로 구현. 상단 요약: 전체 메모 수
  (`totalCount`) / 현재 streak / 최장 streak / 최근 26주 일평균
  (`dailyAvg = windowCount/182`). 일평균은 26주 창 기준임을 라벨로 명시.
- 일별 추이: recharts `BarChart` — 최근 N일 일별 메모 수.

**블록 B — 카테고리 분포**
- 도넛: recharts `PieChart`(도넛) — 카테고리별 비율, 라벨은 `labelKo`, 색 순환.
- 작은 통계: voice vs text 가로 바 1개, 미분류 메모 수.

**블록 C — 메모→액션 전환** (BLOCK 1 반영 — 메모 단위 / 액션-행 단위 분리)
- **메모 퍼널** (단조 감소): `totalMemos → processedMemos(추출 처리) →
  memosWithActions(액션 생김)`. 가로 `BarChart` 또는 스탯 타일 행. 세 값 모두
  메모 수 단위라 역전 불가.
- **액션 상태 분포** (퍼널과 별개, 액션-행 단위 스냅샷):
  `currentStatusCounts` — proposed/accepted/done/dismissed 도넛 또는 스택 바.
  "현재 상태 스냅샷"임을 라벨로 명시 (누적 아님).
- 변환본 통계: `transformByPreset` slug 그룹 — 프리셋별 변환본 수 (작은 바).

**블록 D — 주간 회고 타임라인**
- 주별 `LineChart`/`BarChart` — weekEnd별 memoCount 추이 + 재부상 수 오버레이.

**성능**: recharts는 무거우므로 `MemoInsightsView`는 `"use client"`. 필요 시
`next/dynamic`으로 지연 로드 고려.

## 5. 빈 상태 · 에러 · locale

**빈/희소 상태 (하드 요건, polish 아님)** — 신규 기능 + 개인 DB라 메모가 몇
개뿐일 수 있음. `MemoDigestCard`의 no-digest `null` 반환이 선례.

- 전체 빈 상태: 메모 0개 → 차트 대신 안내 카드 + `/memos` 링크.
- 블록별 희소 상태: 각 블록은 자기 데이터가 비면 개별 빈 메시지
  (다이제스트 없음 → 블록 D 안내; 액션 0건 → 블록 C는 메모 퍼널만).
- **히트맵은 항상 고정 26주 그리드** (§3.4) — 데이터가 적어도 그리드는 유지되고
  기록 없는 날은 회색 `count:0` 셀. "있는 주만" 표현 아님. 메모가 극히 적을 때도
  그리드가 대부분 회색으로 보이는 게 정상 (깨진 게 아님). streak 요약 숫자는
  0이면 "아직 연속 기록이 없어요" 같은 텍스트로 대체.

**에러**: RSC 조회는 `Promise.all` 병렬, 실패 시 Next.js 표준 페이지 에러
(기존 `/memos` 패턴과 동일).

**locale 함정 (Gotcha #3)**: 클라이언트 차트 축·라벨 날짜는 **locale-free**
(`YYYY-MM-DD`, `MM/DD`) — hydration mismatch 방지. 서버 RSC 집계 내부에서만
필요 시 `toLocaleDateString` 허용.

## 6. 테스트 & 검증

- **`aggregate.ts` 순수 함수 5개 전부**: vitest 단위 테스트 (빈 배열 / 단일 행 /
  다중 행 / streak 경계). heatmap·trend는 **주입한 `now` 를 고정**해 결정적
  테스트 (KST 경계·오늘 미기록 streak 케이스 포함). action 집계 검증 (BLOCK 1
  회귀 — 단위 혼동 방지):
  - **퍼널 불변식** `totalMemos >= processedMemos >= memosWithActions` 만 검증
    (세 값 모두 메모 단위). `accepted` 등 상태 카운트를 퍼널과 비교하지 않는다.
  - 한 processed 메모에 `accepted` 액션 2개를 넣고 `currentStatusCounts.accepted
    === 2` 검증 — 액션-행 수가 메모 수를 초과할 수 있음을 명시적으로 허용.
  - `accepted` 가 퍼널 단계(3개 메모-단위 값)에 포함되지 않음을 검증.

  `vitest include` 밖 조용한 스킵 방지 — 단일 경로로 "passed" 확인.
- **신규 repo 함수 2건**: 통합 테스트 (`TEST_DATABASE_URL` 필요).
  `listMemoFactsForInsights` 는 **201건 이상 삽입 후 전량 반환** 회귀 케이스
  필수 — 캡(200) 회피가 load-bearing 요구이므로 명시적으로 가드.
- **검증 게이트**: `pnpm typecheck && pnpm lint`, 그리고 **`cd apps/dashboard &&
  pnpm build`** 필수 — features/widget barrel seam 함정(Gotcha #7)은
  typecheck/lint로 못 잡는다.

## 7. FSD 경계 (Codex BLOCK 2 반영 — seam 명시)

- 라우트(RSC)는 조회는 `entities/memo/server`, 집계는
  `widgets/memo-insights/server` 에서 import. **집계 함수를 deep import
  (`lib/aggregate`) 하지 않는다** — 반드시 `server.ts` entrypoint 경유.
- 클라이언트 뷰(`MemoInsightsView`)는 `widgets/memo-insights` (index.ts) 로만
  노출. raw entity barrel 대신 **props로 차트-ready 데이터 수령**.
- 집계 결과 타입은 `widgets/memo-insights/model/types.ts` (중립 모듈) — server.ts
  와 client 뷰가 공유하되 server-only/DOM 의존 없음.
- `server.ts` 는 `import "server-only"` 없이 순수 함수만 re-export해도 되지만,
  RSC 전용 진입점임을 계약으로 명시 (client는 index.ts만).

## 8. 구현 단계 (독립 빌드 가능한 순서)

1. 데이터 계층: `listMemoFactsForInsights`(source 좁히기), `listDigestsByUser`
   + 타입 + `entities/memo/server.ts` export + repo 테스트 (201건 캡 회귀 포함).
2. 위젯 `model/types.ts`(집계 결과 타입) + `lib/aggregate.ts` 순수 함수 5개
   + `server.ts` re-export + 단위 테스트 (now 고정·빈 상태·퍼널 역전 불가 포함).
3. 위젯 뷰 스캐폴드(`index.ts`) + 블록 A (활동/히트맵) — 가장 신호 큰 블록 먼저.
4. 블록 B (카테고리) → C (메모 퍼널 + 상태 스냅샷 분리) → D (다이제스트 타임라인).
5. 라우트 페이지(`now` 캡처·`server` 집계 호출) + `/memos` 헤더 링크.
6. 빈 상태 마감 + `pnpm build` 검증(Gotcha #7) + 도그푸드 스모크.
