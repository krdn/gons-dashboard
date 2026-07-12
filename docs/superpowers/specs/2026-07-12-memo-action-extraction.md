# 메모 액션 추출 (할일·일정 제안) 설계

- 날짜: 2026-07-12
- 상태: 확정 (사용자 전권 위임 — 설계 판단 Claude)
- 관련: `2026-07-12-memo-category-tagging.md` (분류·after 패턴), `2026-07-12-memo-weekly-digest.md`

## 1. 배경·목표

메모의 상당수는 기록이 아니라 **미래 행동의 임시 저장소**다 ("다음 주 화요일에
LG 위약금 문의해야지"). 현재 메모는 저장 후 완전히 수동적 — 이 기능은 메모를
"보관"에서 "실행"으로 확장한다.

**목표**: 저장 시 LLM이 행동 의도(할일/일정 + 기한)를 구조화 추출해 **제안
카드**로 보여주고, 사용자가 **수락**하면 기한 도래 시 web-push 리마인더를 보낸다.

## 2. 범위 결정 (중요)

- **캘린더 등록은 v1 비범위** — mcp-calendar는 read 전용이고 NextAuth scope도
  `calendar.readonly`. 쓰기는 scope 승격(`calendar.events`) + 재로그인 + mediator
  확장이 필요한 별도 프로젝트. v1에서 `kind: event`도 리마인더 push로만 동작.
- **자동 등록 없음** — 추출 결과는 항상 `proposed` 상태로 시작, 사용자 수락이
  필수 (비가역/외부 액션 앞 확인 원칙. 이메일 답장 도메인과 동일).
- **기한 편집 UI는 v1 비범위** — 날짜가 틀리면 무시(dismiss). 후속으로 인라인
  수정 검토.

## 3. 추출 파이프라인

- **트리거**: `createMemoAction`의 기존 `after()` 콜백 확장 —
  `Promise.allSettled([분류, 추출])` (둘 다 best-effort, 서로 독립).
- **모델**: `claude-sonnet-5` 파일 상수 — 한국어 상대 날짜("다음 주 화요일",
  "월말") → 절대 일시 해석은 추론 품질이 필요해 haiku 부적합.
  프롬프트에 **현재 KST 일시 + 요일**을 명시 주입 (상대 날짜 기준점).
- **출력**: `z.object({ actions: z.array({ kind: "todo"|"event", title(≤200자),
  dueAtIso: ISO8601(+09:00)|null, allDay: boolean }).max(5) })`.
  행동 의도가 없으면 빈 배열 (대부분의 메모가 이 경로 — 프롬프트에 명시).
- **dueAtIso 검증**: 서버에서 Date 파싱 실패 → null로 강등 (제안은 유지).
- **멱등 마커**: `memos.actions_extracted_at` — 추출 시도 성공 시각 (0건도 기록).
  LLM 실패 시 null 유지 → **최근 48시간 내 생성 메모만** cron sweep이 회수.
  과거 메모 백필은 하지 않는다 — 오래된 메모의 상대 날짜는 기준점이 어긋나
  쓰레기 제안만 생성 (분류 backfill과 의도적으로 다른 결정).

## 4. 스키마 (마이그레이션 — 다이제스트 다음 번호)

```sql
ALTER TABLE "memos" ADD COLUMN "actions_extracted_at" timestamp;

CREATE TABLE "memo_action_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memo_id" uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "kind" text NOT NULL CHECK (kind IN ('todo','event')),
  "title" text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  "due_at" timestamp,                -- null = 기한 없음 (리마인더 없음)
  "all_day" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','dismissed','done')),
  "reminded_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX memo_action_items_user_status_idx ON memo_action_items (user_id, status);
```

user_id 비정규화 이유: 리마인더 cron·목록 조회가 memo JOIN 없이 사용자 스코프
질의 — entities 간 참조 없이 자기완결.

## 5. 상태 기계

```
proposed ──수락──> accepted ──완료──> done
    └──무시──> dismissed      (accepted에서도 무시 가능)
```

- 카드 패널에는 `proposed`(수락/무시 버튼) + `accepted`(기한·완료 버튼)만 표시.
  dismissed/done은 숨김 (조회 자체를 status IN 필터로).
- 리마인더: `accepted AND due_at <= now() AND reminded_at IS NULL` → push 1회
  → reminded_at 기록. **push 불가(구독 없음/VAPID 미설정)여도 reminded_at 기록**
  — 매시간 무한 재시도 방지 (관례: 구독 없음은 에러 아님).

## 6. 아키텍처 (FSD)

```
entities/memo
├── api/memoActionItemRepo.ts   # CRUD: insertMany, listByUser(status IN),
│                               # updateStatus(userId 스코프), listDueReminders,
│                               # markReminded, markActionsExtracted(memoRepo)
└── model/actionItem.ts         # kind/status 상수·라벨·가드 (client 안전)
└── server.ts / client.ts       # barrel 확장

features/memo-actions            # 신설
├── api/extractMemoActions.ts   # [server] LLM 추출 + insert + 마커 (after 콜백용)
├── api/actionItemActions.ts    # "use server" — accept/dismiss/complete (auth+소유권)
├── client.ts                   # Server Action만 re-export (barrel seam)
└── ui/MemoActionPanel.tsx      # 제안·수락 목록 패널 ("use client")

features/memo-compose/api/createMemoAction.ts  # after 콜백에 추출 추가
features/memo-manage/ui/MemoList.tsx           # MemoCard에 actionsSlot 주입
entities/memo/ui/MemoCard.tsx                  # actionsSlot?: ReactNode (본문 아래)

app/api/cron/memo-extract-actions/route.ts     # 48h 내 미추출 sweep (매시 41분)
app/api/cron/memo-action-reminders/route.ts    # 기한 도래 리마인더 (매시 37분)
apps/cron/scheduler.js                         # 스케줄 2개 추가
```

- entity(MemoCard)가 features UI를 직접 import할 수 없으므로 **slot 주입**:
  MemoList(features/memo-manage)가 `<MemoActionPanel>`을 만들어 `actionsSlot`으로
  전달 — onTransform 콜백 주입과 같은 조립 원칙의 ReactNode 버전.

## 7. UI/UX

**카드 내 패널** (본문과 footer 사이, 항목 있을 때만):
- proposed: `→ 할 일 제안` 라벨 + title + (기한 있으면 `M/D(요일) HH:MM`) +
  [수락] [무시] 텍스트 버튼 (footer 버튼 어휘와 동일 톤).
- accepted: ✓ 체크박스(클릭=done) + title + 기한. 기한 지난 항목은 기한 텍스트
  `text-red-600`.
- 날짜 표시는 locale-free 수동 포맷 (Gotcha #3).
- 수락/무시/완료는 Server Action → 성공 시 revalidatePath("/memos") (idle) +
  onMutated (검색 모드) — 기존 편집/삭제와 동일 이중 경로.

**push**: `{ title: "⏰ " + item.title, body: 메모 제목, url: "/memos",
tag: "memo-action-<id>" }`.

## 8. 테스트 계획

1. `model/actionItem.test.ts` — 상수·가드 순수.
2. `extractMemoActions.test.ts` — 스키마 safeParse (dueAtIso 형식·max 5),
   추출 0건도 마커 기록, LLM 실패 시 마커 미기록, dueAtIso 파싱 실패 → null 강등.
3. `memoActionItemRepo.test.ts` — 통합: insertMany, 상태 전이(소유권), 리마인더
   대상 질의(기한·status·reminded 조합), markReminded.
4. `actionItemActions.test.ts` — auth·소유권·불법 전이 거부.
5. `MemoActionPanel.test.tsx` — proposed/accepted 렌더, 수락→콜백, 무시→숨김.
6. 리마인더 cron 라우트 — perTarget 로직 유닛 (push mock).

## 9. 비범위 (YAGNI)

- Google Calendar 실제 등록 (scope 승격 별도 프로젝트)
- 기한 인라인 편집, 반복 일정, 스누즈
- 홈 대시보드 할일 위젯, 별도 /todos 페이지
- 다이제스트에 미완 할일 carry-over (후속 통합)
- 리마인더 사전 알림 (기한 N분 전) — v1은 기한 도래 시점
