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
  - 서버에서 DB 조회 + 순수 집계 함수 호출 → 차트-ready 데이터를 위젯에 props 전달.
- **새 위젯**: `apps/dashboard/src/widgets/memo-insights/`
  - `index.ts` (barrel), `ui/MemoInsightsView.tsx` (`"use client"`, recharts),
    블록별 하위 컴포넌트, `lib/aggregate.ts` (순수 집계 함수).
  - **집계는 서버 RSC에서 끝내고, raw 메모는 클라이언트로 넘기지 않는다** —
    위젯은 차트-ready 데이터만 받는 presentational 계층.
- **`/memos` 헤더 링크 추가**: 기존 `🗺 시스템 구조`·`⚙ AI 정리 설정` 옆에
  `📊 인사이트` (`/memos/insights`) 한 줄.

**데이터 흐름**:
```
insights/page.tsx (RSC)
  ├─ listMemoFactsForInsights(userId)   ← 신규, 캡 없음
  ├─ listDigestsByUser(userId)          ← 신규
  ├─ listActionItemsByUser(userId, [4개 상태 전부])  ← 기존 재사용
  ├─ listTransformationsByUser(userId)  ← 기존 재사용
  └─ listCategories()                   ← 기존 재사용
       ↓ (Promise.all 병렬)
  aggregate.ts 순수 함수 4개로 차트-ready 데이터 생성
       ↓ props
  MemoInsightsView ("use client", recharts)
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
2. **`listDigestsByUser(userId)`** → `entities/memo/api/memoDigestRepo.ts` 신설, `server.ts` export
   - 반환: `MemoDigest[]`, `weekEnd` 오름차순. 주간 타임라인용.
   - 기존엔 `getLatestDigest`만 있어 시계열을 못 그렸다.

### 3.3 기존 함수 재사용

- **`listActionItemsByUser(userId, statuses)`**: **4개 상태 전부**
  (`["proposed","accepted","done","dismissed"]`) 전달 — 상태 분포용.
  함수는 이미 `statuses[]`를 받으므로 시그니처 변경 없음.
- **`listTransformationsByUser(userId)`**: 변환본 통계용 (프리셋별 count).
- **`listCategories()`**: 카테고리 slug→labelKo 매핑.

### 3.4 순수 집계 함수 (`widgets/memo-insights/lib/aggregate.ts`)

각 함수는 **빈 배열 입력에서 안전한 기본값**을 반환한다 (§5 빈 상태 요건과 연결).

- `buildActivityHeatmap(facts): { weeks: DayCell[][]; totalCount: number; currentStreak: number; longestStreak: number; dailyAvg: number }`
  - 최근 ~26주 요일×주 그리드. KST 기준 일자 버킷.
- `buildDailyTrend(facts, days): { date: string; count: number }[]`
  - 최근 N일 일별 count (locale-free `YYYY-MM-DD`).
- `buildCategoryDistribution(facts, categories): { byCategory: { slug: string; labelKo: string; count: number }[]; voiceCount: number; textCount: number; unclassifiedCount: number }`
- `buildActionConversion(facts, actionItems, transformations): { totalMemos: number; extractedMemos: number; statusCounts: Record<ActionItemStatus, number>; transformCount: number; transformByPreset: { label: string; count: number }[] }`
- `buildDigestTimeline(digests): { weekEnd: string; memoCount: number; resurfacedCount: number }[]`

## 4. 시각화 구성 (bento 카드 그리드)

`MemoInsightsView`는 라이트 모드 고정 + 기존 디자인 토큰(`globals.css`) 재사용.
recharts 3.8.1 (이미 설치). 차트 색 팔레트는 `dataviz` 스킬로 검증 (접근성·일관성).

**블록 A — 기록 활동 패턴**
- 활동 히트맵: 최근 ~26주 요일×주 그리드 (GitHub 스타일). recharts 미지원이라
  **CSS grid + 단색 명도 스케일**로 구현. 상단 요약: 총 메모 수 / 현재 streak /
  최장 streak / 일평균.
- 일별 추이: recharts `BarChart` — 최근 N일 일별 메모 수.

**블록 B — 카테고리 분포**
- 도넛: recharts `PieChart`(도넛) — 카테고리별 비율, 라벨은 `labelKo`, 색 순환.
- 작은 통계: voice vs text 가로 바 1개, 미분류 메모 수.

**블록 C — 메모→액션 전환**
- 전환 스탯/퍼널: 전체 메모 → 액션 추출 → accepted → done. 가로 `BarChart`
  또는 스탯 타일 행.
- 액션 상태 분포: proposed/accepted/done/dismissed 도넛 또는 스택 바.
- 변환본 통계: 프리셋별 변환본 수 (작은 바).

**블록 D — 주간 회고 타임라인**
- 주별 `LineChart`/`BarChart` — weekEnd별 memoCount 추이 + 재부상 수 오버레이.

**성능**: recharts는 무거우므로 `MemoInsightsView`는 `"use client"`. 필요 시
`next/dynamic`으로 지연 로드 고려.

## 5. 빈 상태 · 에러 · locale

**빈/희소 상태 (하드 요건, polish 아님)** — 신규 기능 + 개인 DB라 메모가 몇
개뿐일 수 있음. `MemoDigestCard`의 no-digest `null` 반환이 선례.

- 전체 빈 상태: 메모 0개 → 차트 대신 안내 카드 + `/memos` 링크.
- 블록별 희소 상태: 각 블록은 자기 데이터가 비면 개별 빈 메시지
  (다이제스트 없음 → 블록 D 안내; 액션 0건 → 블록 C는 추출률만).
- 히트맵/streak는 ~5행에서 깨져 보이지 않도록 최소 표현 (있는 주만, 없으면 회색).

**에러**: RSC 조회는 `Promise.all` 병렬, 실패 시 Next.js 표준 페이지 에러
(기존 `/memos` 패턴과 동일).

**locale 함정 (Gotcha #3)**: 클라이언트 차트 축·라벨 날짜는 **locale-free**
(`YYYY-MM-DD`, `MM/DD`) — hydration mismatch 방지. 서버 RSC 집계 내부에서만
필요 시 `toLocaleDateString` 허용.

## 6. 테스트 & 검증

- **`aggregate.ts` 순수 함수 4개**: vitest 단위 테스트 (빈 배열 / 단일 행 /
  다중 행 / streak 경계). `vitest include` 밖 조용한 스킵 방지 — 단일 경로로
  "passed" 확인.
- **신규 repo 함수 2건**: 통합 테스트 (`TEST_DATABASE_URL` 필요).
- **검증 게이트**: `pnpm typecheck && pnpm lint`, 그리고 **`cd apps/dashboard &&
  pnpm build`** 필수 — features/widget barrel seam 함정(Gotcha #7)은
  typecheck/lint로 못 잡는다.

## 7. FSD 경계

- 라우트(RSC)는 `entities/memo/server`에서 조회 함수 import.
- 클라이언트 위젯(`MemoInsightsView`)은 raw entity barrel 대신 **props로 데이터
  수령** — 서버-클라이언트 seam 준수.
- 위젯 barrel(`index.ts`)은 순수 뷰/타입만 export (server-only 의존 없음).

## 8. 구현 단계 (독립 빌드 가능한 순서)

1. 데이터 계층: `listMemoFactsForInsights`, `listDigestsByUser` + 타입 +
   server.ts export + repo 테스트.
2. 집계 순수 함수 `aggregate.ts` + 단위 테스트 (빈 상태 포함).
3. 위젯 스캐폴드 + 블록 A (활동/히트맵) — 가장 신호 큰 블록 먼저.
4. 블록 B (카테고리) → C (액션 전환) → D (다이제스트 타임라인).
5. 라우트 페이지 + `/memos` 헤더 링크.
6. 빈 상태 마감 + build 검증 + 도그푸드 스모크.
