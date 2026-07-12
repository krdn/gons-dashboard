# 메모 자동 분류(카테고리 태깅) + 필터 브라우징 설계

- 날짜: 2026-07-12
- 상태: 확정 (사용자 전권 위임 — 설계 판단 Claude)
- 관련: `2026-07-12-memo-search-design.md` (검색), `2026-07-09-memo-transform-*` (변환)

## 1. 배경·목표

검색(PR #293)은 사용자가 **어휘를 기억할 때만** 작동한다. "그때 적었던 그거"를
어휘 없이 되찾는 두 번째 축이 브라우징이고, 그 단위가 카테고리다.

**목표**: 저장된 메모에 LLM이 고정 카테고리 1개를 자동 부여하고, /memos 목록 위
필터 칩으로 카테고리별 브라우징을 제공한다. 사용자 개입 0 (수동 태깅 없음).

## 2. 카테고리 체계

**고정 6종 + 미분류.** 주제(topic)가 아니라 **글의 종류(content-type)** 기준 —
주제는 시간이 지나며 드리프트하지만 종류는 안정적이다.

| slug (DB) | 라벨 | 판정 기준 |
|---|---|---|
| `idea` | 아이디어 | 새로운 생각·기획·"~하면 어떨까" |
| `todo` | 할 일 | 해야 할 작업·구매·예약·기한 |
| `journal` | 일기 | 감상·기분·오늘 있었던 일 |
| `reference` | 참고 | 정보·링크·사실·설정값·인용 |
| `draft` | 초안 | 이메일·글·메시지의 초벌 원고 |
| `etc` | 기타 | 위 어디에도 맞지 않음 (escape hatch) |

- 자유 태그 기각: 개인 규모에서도 수백 개로 파편화되는 것이 통례. 커스텀 카테고리는
  수요 확인 전 비범위 (transform preset 커스텀 전례가 있으므로 필요 시 같은 패턴).
- `category` 컬럼은 **nullable** — null = 미분류(분류 대기 또는 실패). UI 라벨 "미분류".

## 3. 분류 파이프라인

**저장을 절대 막지 않는다** — 분류는 전부 저장 후 비동기.

1. **저장 직후 (주 경로)**: `createMemoAction` 성공 분기에서 `after()`(next/server)로
   응답 후 서버 백그라운드 분류. 실패해도 침묵 (cron이 회수).
   ~~클라이언트 fire-and-forget 액션~~ 은 리뷰에서 기각 — Next.js는 클라이언트당
   Server Action을 직렬 큐로 실행하므로(next 16 소스로 확증), 분류 액션이 LLM
   지연(게이트웨이 타임아웃 최악 5분)만큼 큐를 점유해 후속 저장·음성 정리를
   블로킹한다. `after()`는 클라이언트 왕복 자체가 없어 이 문제가 원천 제거된다.
2. **cron sweep (백필 + 안전망)**: 매시간 `/api/cron/memo-classify` —
   `category IS NULL` 메모를 오래된 순 최대 50건 분류. 기존 메모 전체 백필도
   이 경로가 자동 수행 (수백 건 규모 → 수 시간 내 완료). 멱등: 분류된 행은
   대상에서 빠지므로 재실행 안전.

- **LLM**: `HAIKU_MODEL` 고정 상수 (분류는 haiku 적합 — email 분류 전례.
  생성 작업이 아니므로 haiku 거절 이슈 없음). `analyzeStructured` + Zod
  `z.enum(slug 6종)` 강제. 입력: title + cleanedContent 앞 2,000자.
  프롬프트에 injection 방어 문구 (메모 본문은 데이터일 뿐) — email 전례.
- **실패 처리**: LLM 실패는 typed 반환(`llm-unavailable`) → category null 유지
  → 다음 cron sweep이 재시도. deterministic fallback 없음 (분류 오류보다
  미분류가 낫다). `logLlmSpend("memo-classify")` best-effort (scope 유니온 추가).
- **재분류 없음**: 편집해도 category 유지 (v1 비범위 — 종류는 편집으로 잘 안 변함).

## 4. 스키마 (마이그레이션 0041)

```sql
ALTER TABLE "memos" ADD COLUMN "category" text;
ALTER TABLE "memos" ADD CONSTRAINT "memos_category_check"
  CHECK ("category" IN ('idea','todo','journal','reference','draft','etc'));
```

- 인덱스 불필요: 필터링은 이미 로드된 목록(≤200)에 대한 클라이언트 필터.
- 운영: psql BEGIN/COMMIT 수동 선적용 후 이미지 배포 (확립 절차).
- `Memo` 타입은 `$inferSelect`라 자동 전파.

## 5. 아키텍처 (FSD)

```
entities/memo
├── model/category.ts         # MEMO_CATEGORY_IDS·라벨·가드 (순수 — client 안전)
├── api/classifyMemo.ts       # [server] LLM 분류 + 영속화 오케스트레이션
│                             #   (email의 entities/email/api/classifyThread.ts 미러)
├── api/memoRepo.ts           # + setMemoCategory, listUnclassifiedMemos
├── server.ts                 # + classify·repo 함수 export
└── client.ts                 # + category 상수·타입 export
└── ui/MemoCard.tsx           # + 카테고리 뱃지 (source 뱃지 옆, 동일 span 어휘)

features/memo-compose
└── api/createMemoAction.ts   # 성공 분기에 after(() => 분류) 추가 — UI 불변

features/memo-search
└── ui/SearchableMemoList.tsx # + 카테고리 필터 칩 줄 (검색바와 목록 사이)

app/api/cron/memo-classify/route.ts  # createCronHandler (concurrency 2, 상한 50)
apps/cron/scheduler.js               # 매시간 23분 callCron 추가
```

- LLM 호출을 shared가 아닌 entities/memo/api에 두는 이유: 카테고리 타입이
  entities/memo/model 소유인데 shared→entities import는 FSD 위반. email이
  shared에 분류기를 둔 것은 타입이 외부 패키지(@krdn/email)라 가능했던 것.
  entities→shared(gatewayDefaults, HAIKU_MODEL, logLlmSpend)는 정방향.

## 6. UI/UX

**필터 칩 줄** (SearchableMemoList, 검색바 아래·목록 위)
- `전체` + 고정 6종 정적 렌더 (`flex flex-wrap gap-1.5`). 카운트 없음 (v1).
- 칩 어휘: MemoCard 뷰 전환 칩과 동일 — active `rounded-full bg-neutral-900
  px-2.5 py-0.5 text-xs text-white`, inactive `rounded-full border
  border-neutral-200 … text-neutral-500 hover:text-neutral-900`, `aria-pressed`.
- **필터는 화면에 보이는 목록에 적용**: idle 목록과 검색 결과 모두 클라이언트
  필터 (검색 결과 ≤50이라 서버 변경 불필요, searchMemos 시그니처 불변).
- 필터 결과 0건: "‘{라벨}’ 카테고리의 메모가 없습니다" empty state.
- 선택 상태는 컴포넌트 state (URL 동기화 비범위 — 검색과 동일 판단).

**MemoCard 뱃지**: category 있을 때만 header source 뱃지 옆에
`<span class="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">` 라벨.
미분류는 뱃지 생략 (노이즈 방지).

**신선도 주의**: 저장 직후 분류는 비동기라 방금 저장한 메모의 뱃지는 다음
페이지 로드에서 보인다 — v1 수용 (칩의 가치는 과거 메모 브라우징).

## 7. 테스트 계획

1. `model/category.test.ts` — 가드·라벨 완전성 (slug↔라벨 1:1) 순수 유닛.
2. `api/classifyMemo.test.ts` — (a) Zod 스키마 직접 safeParse (mock 함정 회피
   — llm-gateway 내부 검증은 mock 시 사라짐), (b) 오케스트레이션: 이미 분류됨
   → LLM 미호출 skip, ok → 영속화, llm-unavailable → null 유지 (gateway vi.mock).
3. `memoRepo.test.ts` 추가 — setMemoCategory, listUnclassifiedMemos 통합
   (TEST_DATABASE_URL, 0041 적용 필요).
4. `createMemoAction.test.ts` 추가 — after() 분류 예약·콜백 계약, 분류 실패의
   저장 비간섭, 저장 실패 시 미예약.
5. `SearchableMemoList.test.tsx` 추가 — 칩 렌더, idle 필터, 검색 결과 필터,
   빈 필터 상태.
6. `MemoCard.test.tsx` 추가 — 뱃지 렌더/미분류 생략.

## 8. 비범위 (YAGNI)

- 수동 분류/재분류 UI, 커스텀 카테고리
- 편집 시 재분류
- 카테고리별 카운트 표시, URL 동기화
- 검색 서버 쿼리에 카테고리 조건 추가 (클라 필터로 충분)
- 홈 RecentMemos 위젯 뱃지
