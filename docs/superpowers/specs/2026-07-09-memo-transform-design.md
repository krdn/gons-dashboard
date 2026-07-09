# 메모 스타일 변환 (memo-transform) 설계 스펙

- 날짜: 2026-07-09
- 선행: 텍스트/음성 메모 기능 (PR #268, `docs/superpowers/specs/2026-07-09-voice-text-memo-design.md`)
- 리서치 근거: `docs/research/2026-07-09-memo-style-presets-research.md`
- 사용자 결정: 프리셋 = 코어 3종 + 용도 3종 / 저장 = 병존 테이블

## 1. 목표

저장된 메모(음성·텍스트 불문)를 **온디맨드로 여러 스타일로 정리**한다.
변환본은 원문·정리본을 교체하지 않고 메모에 병존 보관되며, 카드에서 탭(칩)으로 전환한다.
기존 "녹음 종료 시 자동 기본 정돈" 플로우는 변경하지 않는다.

## 2. 프리셋 (7종)

| id | 라벨 | 지시 요지 | minInputLen | 검증 |
|---|---|---|---|---|
| `tidy` | 정돈 | 기존 cleanup-transcript 프롬프트 재사용 (군말 제거+문장부호, 뜻 보존) | 1 | 60% degenerate 규칙 적용 |
| `polish` | 매끄럽게 | 받아쓰기 오류·어색한 문장을 자연스럽게 재작성, 정보 전부 보존 | 20 | 공통만 |
| `summary` | 요약 | 3~5문장 또는 불릿으로 핵심 압축 | 80 | 공통만 (축약이 정상) |
| `structured` | 구조화 | 헤딩+불릿 마크다운으로 재구성 | 80 | 공통만 |
| `todos` | 할 일 추출 | `- [ ]` 체크리스트로 액션 아이템 추출. 할 일이 전혀 없으면 `할 일 없음` 한 줄 반환(유효 출력) | 20 | 공통만 |
| `journal` | 일기체 | 정돈된 일기(저널) 문체로 재구성, 사실 관계 보존 | 20 | 공통만 |
| `email` | 이메일 초안 | 인사말+본문+맺음말을 갖춘 이메일 초안 텍스트 (수신자 미지정, 발송 연결 없음) | 20 | 공통만 |

- **공통 검증**: 빈 결과 실패, `isRefusalDraft` 재사용(거절 감지), Zod 스키마
  `{ content: z.string().min(1).max(30_000) }`.
- **2층 프롬프트**: 공통 가드레일 시스템 프롬프트(고유명사·숫자·날짜 불변, 한국어 유지,
  없는 내용 추가 금지) + 프리셋별 스타일 지시. 프리셋 정의는 하드코딩 map 2파일
  (§4 참조): client-safe 메타 `{ id, label, minInputLen, strictPreserve }`는
  `lib/preset-meta.ts`, 프리셋별 `instruction`은 server-only `lib/prompts.ts`.
  `strictPreserve: true`(tidy)만 60% 규칙 적용.
- **변환 입력**: `cleaned_content`(사용자가 편집했을 수 있는 현재 본문) 기준.
  `raw_content` 아님 — 오탈자 수정 후 변환하는 경로를 지원 (Oasis 패턴).
- 입력은 기존 `MAX_INPUT 4_000`으로 절단.

## 3. 데이터 모델

```sql
-- drizzle 0036 (순수 추가)
CREATE TABLE memo_transformations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  preset text NOT NULL CHECK (preset IN
    ('tidy','polish','summary','structured','todos','journal','email')),
  model text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_memo_transformations_memo_preset UNIQUE (memo_id, preset)
);
```

- **메모당 프리셋당 1개** — 같은 프리셋 재생성·재저장은 `onConflictDoUpdate`
  (content, model, updated_at 갱신). 버전 이력은 범위 외.
- `memos` 기존 컬럼 무변경. 운영 적용은 psql 수동(BEGIN/COMMIT) 후 이미지 교체
  (drizzle-kit prod tracking 불신 — 기존 관행).

## 4. FSD 구조

```
entities/memo/
  api/memoTransformRepo.ts     # upsertTransformation / listTransformationsByUser / (테스트용 get)
  model/types.ts               # MemoTransformation 타입, TransformPresetId 추가
  server.ts / client.ts        # seam 유지 — repo는 server, 타입·상수는 client

features/memo-transform/
  lib/preset-meta.ts           # client-safe: TransformPresetId·라벨·minInputLen·strictPreserve
  lib/prompts.ts               # server-only: 공통 가드레일 시스템 프롬프트 + 프리셋별 instruction
  lib/transform-memo.ts        # LLM 호출 + 검증 (cleanup-transcript 패턴 미러, server-only)
  api/transformMemoAction.ts   # "use server" — 미리보기 생성 (저장 안 함)
  api/saveTransformationAction.ts # "use server" — 승인 저장 (upsert)
  ui/TransformDialog.tsx       # 프리셋 픽커 + 미리보기 + 저장 (createPortal → body)
  index.ts                     # server entrypoint
  client.ts                    # Server Action + client-safe 메타만 re-export
```

- **"use server" 파일에서 import한 타입의 재-export 금지** (PR #268 사고 재발 방지).
- MemoCard(entity ui)는 features를 import할 수 없으므로(FSD 방향),
  TransformDialog 트리거와 칩 전환은 **MemoList(features/memo-manage)** 레벨에서 조립:
  MemoCard에 `transformations?: MemoTransformation[]` + `onTransform?: (memo) => void`
  prop을 추가하고, 다이얼로그는 MemoList가 렌더한다. features→features는 허용 예외
  (memo-manage → memo-transform).

## 5. Server Action 계약

```ts
// 미리보기 생성 — DB 쓰기 없음
transformMemoAction(memoId: string, preset: TransformPresetId): Promise<
  | { kind: "ok"; content: string }
  | { kind: "not-found" }          // 소유 검증 실패 포함
  | { kind: "too-short" }          // minInputLen 미달 (서버 재검증)
  | { kind: "failed"; reason: string }>

// 승인 저장 — 미리보기에서 사용자가 편집한 content를 받음
saveTransformationAction(memoId: string, preset: TransformPresetId, content: string): Promise<
  | { kind: "ok" }
  | { kind: "invalid" }            // 빈 내용 / 20k 초과 / 알 수 없는 preset
  | { kind: "not-found" }
  | { kind: "failed" }>
```

- 두 액션 모두 `auth()` 세션 + `getMemo(userId, memoId)` 소유 검증.
- 저장 성공 시 `revalidatePath("/memos")`.
- DB 실패는 `.then(success, failure)` 유니온 패턴 (기존 액션과 동일 — 에러는 삼키고
  kind로 반환, 상세는 서버 로그).

## 6. UX

1. **카드 칩 row**: MemoCard 상단에 `[정리본] [원문(음성만)] [요약] [할 일] …`
   — 존재하는 변환본만 칩으로 노출. 현재 `showRaw` boolean을
   `activeView: "cleaned" | "raw" | TransformPresetId`로 확장.
2. **"AI 정리" 버튼** (카드 footer, 편집·삭제 옆) → TransformDialog:
   - 프리셋 그리드 7버튼 — `cleaned_content` 길이 < minInputLen이면 비활성.
   - 선택 → "AI가 정리하는 중…" → 미리보기 textarea(편집 가능) +
     `[저장] [다시 생성] [취소]`.
   - 이미 저장된 프리셋을 다시 선택하면 경고 문구("기존 ○○ 정리본을 교체합니다") 표시.
3. 다이얼로그는 `createPortal`로 body 탈출 (inert 중첩 함정 회피),
   Escape/배경 클릭 닫기, 진행 중 닫기 방지.
4. 실패 시: 아무것도 저장하지 않고 다이얼로그 안 노티스 + [다시 생성] 유지
   (온디맨드라 raw-fallback 저장 불필요).
5. 대시보드 최근 메모 위젯(RecentMemos)은 범위 외 — /memos 페이지에서만.

## 7. LLM·비용

- 모델: `claude-sonnet-5` 고정 (haiku는 비코딩 생성 거절 이력으로 회피).
- `analyzeStructured` + `gatewayDefaults` 재사용, `maxOutputTokens 4_000`.
- 지출 로깅: `logLlmSpend("memo-transform:<preset>", …)` best-effort (try/catch swallow).

## 8. 테스트 계획

| 대상 | 방식 |
|---|---|
| presets map | 순수 유닛 — 7종 존재, minInputLen, strictPreserve 플래그 |
| transform-memo 검증 규칙 | 순수 유닛 — 빈 결과/refusal/tidy 60% 규칙 분기. 스키마는 export 후 직접 safeParse (vi.mock이 Zod 검증을 지우는 함정 회피) |
| 액션 | 유닛 — auth/소유/too-short/invalid 분기 (LLM·repo mock) |
| repo | 통합(TEST_DATABASE_URL) — upsert 교체, cascade 삭제, 소유 격리 |
| MemoCard 칩 | jsdom — 칩 전환 시 본문 교체 |
| TransformDialog | jsdom 구조 단언 최소 (portal/inert는 jsdom 미구현) + dev dogfood smoke 필수 |

- 게이트: typecheck + lint + test + **build** + dev 서버 실호출 smoke
  (build가 못 잡는 "use server" 변종 때문).

## 9. 범위 외 (Phase 2 후보)

커스텀 프리셋 CRUD·번역·재작성 강도·상시 규칙(Your Rules)·버전 이력·
Gmail 발송 연결·RecentMemos 위젯 노출·변환 체이닝(변환본 기준 재변환).

## 10. 배포 순서

1. PR #268(메모 기능) 머지 → 이미지 교체 (0035는 적용 완료 상태)
2. 본 기능 머지 전 운영 psql로 0036 수동 적용 → 이미지 교체
