# 메모 주간 다이제스트 + 오래된 메모 재부상 설계

- 날짜: 2026-07-12
- 상태: 확정 (사용자 전권 위임 — 설계 판단 Claude)
- 관련: `2026-07-12-memo-category-tagging.md` (분류), `2026-07-12-memo-search-design.md` (검색)

## 1. 배경·목표

검색·분류는 사용자가 **능동적으로** 찾아야 작동한다. 재부상(resurfacing)은 같은
가치("오래된 메모 재발견")를 **수동(passive) 경로**로 제공한다 — 적어두고 잊은
메모가 스스로 돌아온다.

**목표**: 주 1회(일요일 19:00 KST 이후) 지난주 메모를 LLM 요약 + 30일 이상 된
과거 메모 1~2개를 재부상시켜, 홈 대시보드 위젯과 web-push로 전달한다.

## 2. 주기·주차 시맨틱

- **창 = [직전 일요일 19:00 KST, 대상 일요일 19:00 KST)** — 연속 주가 빈틈·중복
  없이 타일링되어 일요일 저녁 늦게 쓴 메모도 반드시 다음 주 요약에 포함된다.
  (월~일 자정 경계안은 "생성 시점 이후·창 내" 메모가 영원히 요약에서 빠지는
  구멍이 있어 기각.) `week_end` = 창을 닫는 일요일 날짜 (date, 멱등 키).
- **due 판정**: 가장 최근의 "일요일 19:00 KST"가 지났고, 그 week_end의
  digest 행이 없으면 due.
- **트리거**: cron 매일 19:05 KST — 일요일 저녁 정상 발화, 컨테이너가 그 시각에
  죽어 있었으면 다음 날 19:05에 catchup (morning-digest의 "잦은 트리거 + DB
  due-gating" 전례의 주간 일반화). 멱등: `unique(user_id, week_end)`.
- **누락 주 백필** (리뷰 확정 결함 반영): due 판정이 최신 창 하나만 보면 실패가
  7일 지속될 때 그 주가 영구 누락된다. `getLatestDigest`의 마지막 week_end 이후
  누락된 창을 **오래된 순으로 최대 4주** 백필 생성하되, push는 현재(최신) 주에만
  발송 — 회복 직후 알림 폭주 방지. 중간 실패는 throw — 생성분까지는 기록돼
  다음 실행이 이어서 재시도.
- KST는 고정 UTC+9 (DST 없음) — `kstTodayDate` 전례와 동일한 +9h 산술.

## 3. 파이프라인 (cron route → feature 오케스트레이션)

`/api/cron/memo-digest` (createCronHandler):
- targetSelect: **메모가 1건이라도 있는 사용자** (distinct user_id from memos).
- perTarget: `generateWeeklyDigest(userId, now)`:
  1. due 아님 or 이미 digest 행 존재 → skip (typed 반환).
  2. 지난주 창의 메모 로드. **0건 → LLM·push 없이 marker 행 삽입** (memo_count=0,
     summary "") — 빈 주엔 침묵 (push 피로도 방지), 재평가만 차단.
  3. LLM 요약 (아래 §4). 실패 → **행 삽입 없이 throw** — cron envelope error
     격리, 다음 날 19:05 재시도.
  4. 재부상 선정 (아래 §5) — LLM 무관, 실패 불가한 순수 선택.
  5. digest 행 삽입 (`onConflictDoNothing` — 동시 실행 방어).
  6. push 발송 (best-effort — 행 삽입 후이므로 push 실패해도 재생성 없음.
     비가역 액션 뒤 bookkeeping 분리 원칙의 역방향 적용).

## 4. LLM 요약

- 모델: `claude-sonnet-5` 파일 상수 (cleanup-transcript의 CLEANUP_MODEL 전례 —
  요약은 생성 작업이라 haiku 부적합). 주 1회/사용자라 비용 무시 가능.
- 입력: 지난주 메모들의 (제목, 카테고리, cleaned 앞 300자), 전체 8,000자 상한.
- 출력: `z.object({ summary })` — 한국어 3~6줄, 주제 묶음 서술.
- `logLlmSpend("memo-digest")` (scope 유니온 추가). 프롬프트에 injection 방어 문구.

## 5. 재부상 (resurfacing)

- 후보: `createdAt < now - 30일` 인 사용자 메모 전부 (개인 규모 — 전수 로드 OK).
- 선정: **시간 가중 무작위 2개** (가중치 ∝ 경과일 — 오래될수록 잘 뽑힘).
  유사도 기반은 임베딩 선결 과제가 있어 비범위 (분석 문서의 단계 2).
- rng 주입 가능한 순수 함수로 구현 (테스트 결정성).
- digest 행에 `resurfaced_memo_ids uuid[]` 저장. 표시 시점에 조회 — 삭제된
  메모는 조용히 생략 (FK 없음, 정합 강제 불필요).

## 6. 스키마 (마이그레이션 0042)

```sql
CREATE TABLE "memo_digests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "week_end" date NOT NULL,         -- 창을 닫는 일요일 (KST)
  "summary" text NOT NULL,          -- memo_count=0 이면 ''
  "memo_count" integer NOT NULL,
  "resurfaced_memo_ids" uuid[] NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memo_digests_user_week_uq ON memo_digests (user_id, week_end);
```

## 7. 아키텍처 (FSD)

```
entities/memo
├── api/memoDigestRepo.ts    # insertDigest(onConflictDoNothing), getLatestDigest,
│                            # hasDigest, listMemosBetween·listMemosOlderThan(memoRepo)
└── server.ts                # + 위 함수 export

features/memo-digest          # 신설 (server-only — client barrel 불필요, UI 없음)
├── api/generateWeeklyDigest.ts  # 오케스트레이션 (LLM + 재부상 + insert + push)
├── lib/week.ts                  # computeDigestWindow(now) 순수 KST 주차 산술
└── lib/resurface.ts             # pickResurfaced(memos, now, rng) 순수 선정
└── index.ts                     # server entrypoint

widgets/memo-digest           # 신설 — 홈 aside 위젯
├── ui/MemoDigestCard.tsx     # RSC — auth → 최신 digest + 재부상 메모 로드
└── ui/MemoDigestView.tsx     # 순수 표시 (jsdom 테스트 대상)

shared/lib/push/index.ts      # + sendPushToUser(userId, payload) 헬퍼 승격
                              #   (구독 select → 직렬 발송 → 만료 정리 — notifyFlip·
                              #    morning-digest가 각자 복붙하던 40줄. 기존 호출자
                              #    리팩토링은 비범위 — 신규 호출자만 사용)

app/api/cron/memo-digest/route.ts  # createCronHandler (concurrency 2)
apps/cron/scheduler.js             # 매일 19:05 KST callCron 추가
app/_widgets/registry.ts           # aside에 memo-digest 등록 (recent-memos 앞)
```

## 8. 위젯 UI

- digest 행 없으면 null (첫 주 전엔 위젯 자체 미노출 — 노이즈 방지).
- 표시: "주간 메모 다이제스트" 헤더 + week 라벨(M/D–M/D) + summary (memo_count=0
  이면 "지난주에 작성한 메모가 없습니다") + 재부상 섹션("다시 보기") — 메모
  제목·작성일 목록, /memos 링크. 기존 위젯 톤 (rounded-xl border-neutral-200 p-4,
  neutral 팔레트, locale-free 날짜 포맷).

## 9. push

- payload: `{ title: "주간 메모 다이제스트", body: "지난주 메모 N개 — <summary 첫 줄 80자>",
  url: "/", tag: "memo-digest" }` (위젯이 홈에 있으므로 url "/").
- memo_count=0 이면 발송 안 함. 구독 없음 → 조용히 skip (관례).

## 10. 테스트 계획

1. `lib/week.test.ts` — 일요일 19:00 전/후, 주중, 자정 경계, KST 오프셋, 타일링,
   windowForWeekEnd 복원, enumerateMissingWeekEnds(백필 열거·상한) 순수 검증.
2. `lib/resurface.test.ts` — 30일 컷, 가중치 단조성(고정 rng), 후보 0/1개 엣지.
3. `memoDigestRepo.test.ts` — insert 충돌 멱등, getLatest 정렬, hasDigest (통합).
   `memoRepo.test.ts` — 창 쿼리 4개 경계([from,to) 반개구간·strict lt·distinct·
   소유 격리) 통합 (리뷰 반영).
4. `generateWeeklyDigest.test.ts` — skip/0건 marker/정상/LLM 실패/백필(push 억제·
   중간 실패 재개) 경로 (mock).
5. `MemoDigestView.test.tsx` — 요약·빈 주·재부상 목록 렌더 (jsdom).
   `resolveResurfaced.test.ts` — 삭제 생략·스냅샷 순서 (순수, 리뷰 반영).
6. `shared/lib/push/index.test.ts` — sendPushToUser 4경로 (성공 카운트·만료 삭제·
   vapid-missing 중단·일반 에러) (리뷰 반영).

## 11. 비범위 (YAGNI)

- 사용자별 발송 시각/요일 설정, opt-out (구독 자체가 opt-in)
- 유사도 기반 재부상 (임베딩 선결)
- 다이제스트 히스토리 페이지 (최신 1건만 위젯 표시)
- 액션 아이템 carry-over (액션 추출 기능과의 통합은 후속)
- 기존 push 호출자(notifyFlip·morning-digest)의 sendPushToUser 마이그레이션
