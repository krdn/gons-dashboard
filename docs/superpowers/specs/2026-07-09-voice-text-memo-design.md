# 텍스트/음성 메모 기능 설계

**날짜**: 2026-07-09
**상태**: 설계 승인 대기
**도메인**: memo (신규)

## 1. 개요

개인 대시보드에 텍스트/음성 메모 캡처 기능을 추가한다. 음성은 브라우저 내장 STT로
실시간 받아쓰기하고, AI가 받아쓰기 원문을 정리(clean-up)해 편집 가능한 미리보기로
보여준 뒤 사용자 승인 시 저장한다. 텍스트 메모는 AI 없이 바로 저장한다.

**이번 범위**: 메모 캡처(음성·텍스트) + AI 클린업 + 승인 + 목록 + 편집·삭제.
**범위 밖(후속 스펙)**: vault(Obsidian) 내보내기, 검색, 태그/폴더, 요약·할일추출.

## 2. 확정된 요구사항

1. **음성→텍스트**: 브라우저 내장 Web Speech API(`SpeechRecognition`). 오디오는 서버로
   전송하지 않는다. Chrome/Safari 대상 **best-effort** 기능.
2. **AI 클린업**: 받아쓰기 원문 → 군말("음…어…")·중복·받아쓰기 오류 제거 + 문장부호/문단
   정리. **뜻 보존이 최우선** — 요약·판단·할일추출·내용삭제·고유명사 임의변경 금지.
3. **저장**: 원문(`raw_content`) + 정리본(`cleaned_content`) 둘 다 보관.
4. **승인 흐름**: 녹음 → 클린업 → 편집 가능한 미리보기 → **[승인] 시에만 DB 저장**.
   승인 전에는 **서버 무저장**, 단 브라우저 localStorage에 초안 임시저장(유실 방지).
5. **텍스트 메모**: AI 클린업 없이 바로 저장 (`raw_content = cleaned_content`, `source='text'`).
6. **관리**: 목록 + 개별 편집·삭제. 검색 없음.
7. **title**: 선택 입력. 비우면 `cleaned_content` 첫 문장에서 자동 파생하되, 저장 시점에
   항상 확정값을 넣는다(DB에서 title은 non-null).
8. **모델**: `claude-sonnet-5` 기본. 전사문 정리는 추론이 아닌 정규화라 opus/fable은 과함.
   haiku는 한국어 구어체 클린업에서 의미삭제·거절 위험이 있어 기본 제외(후속 A/B 대상).

### 프라이버시 정직성 (명시 필수)

오디오는 서버로 가지 않지만, **AI 클린업 시 받아쓴 텍스트는 cli-proxy(`ANTHROPIC_BASE_URL`)를
거쳐 LLM으로 전송**된다. "완전 로컬"이 아니다. 승인 UI에 "AI 정리는 텍스트를 서버로 전송합니다"를
1줄 안내. 단 `logLlmSpend`는 토큰 수만 기록하고 본문은 로그에 남기지 않는다(기존 관측 정책).

## 3. 데이터 모델

**테이블 `memos`** (`src/shared/lib/db/schema/memo.ts`, 사용자별 소유)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | `uuid` PK | `defaultRandom()` |
| `user_id` | `text` | NOT NULL, FK → auth users |
| `source` | `text` | NOT NULL, **CHECK IN ('voice','text')** (Gotcha #10 CHECK 패턴, drizzle enum 아님) |
| `title` | `text` | NOT NULL (자동 파생 시에도 확정값) |
| `raw_content` | `text` | NOT NULL, 빈 문자열 금지. **생성 후 immutable** (편집은 cleaned/title만) |
| `cleaned_content` | `text` | NOT NULL, 빈 문자열 금지 |
| `created_at` | `timestamptz` | `defaultNow()` |
| `updated_at` | `timestamptz` | `defaultNow()`, 편집 시 갱신 |

- 인덱스: `(user_id, created_at DESC)` — 목록 조회.
- 하드 삭제 (개인 대시보드, 복구/감사 요구 없음 → soft delete는 과설계).
- `cleanup_model`/`cleanup_status` 메타 컬럼은 두지 않는다 — 승인해야 저장하므로 DB에
  있는 메모는 전부 성공한 클린업이다. 모델 추적은 `logLlmSpend`로 충분.
- 운영 마이그레이션: **psql BEGIN/COMMIT 직접 적용 후 이미지 교체**
  (drizzle-kit migrate가 prod tracking 인식 못함 — 확립된 gotcha).

### 입력 제한 (Server Action timeout 방어)

- `raw_content` 최대 문자 수 제한(예: 20,000자). 초과 시 클라이언트에서 컷 + 안내.
  긴 녹음은 chunk/background job 도입하지 않고 길이 제한으로 단순화(YAGNI).

## 4. 컴포넌트 구조 (FSD 3계층)

```
entities/memo/
  server.ts          # DB CRUD (listMemos, getMemo, createMemo, updateMemo, deleteMemo)
                     #   import "server-only". 모든 쓰기는 user_id 소유 검증.
  client.ts          # 타입·상수만 (Memo, MemoSource) — UI에서 안전
  model/types.ts     # Memo, MemoSource='voice'|'text'
  api/               # Drizzle 쿼리 구현
  ui/MemoCard.tsx    # 표시 전용(제목·발췌·시각·source 배지). edit/delete 액션은
                     #   props로 주입받음 — entities가 features 액션을 알지 않음.

features/memo-compose/            # 녹음·클린업·승인·저장
  client.ts          # Server Action re-export: cleanupTranscript, createMemoAction
  api/cleanupTranscript.ts   # "use server" — 받아쓰기 원문 → 클린업본 (LLM 호출)
  api/createMemoAction.ts    # "use server" — 승인된 메모 저장. 중복 저장 서버측 방어.
  lib/cleanup-transcript.ts  # LLM 클린업 함수 (draft-reply.ts 미러). 메모 정책이
                             #   강하므로 shared 아닌 feature 내부에 둔다.
  lib/useSpeechRecognition.ts # 커스텀 훅 (SpeechRecognition 래핑, 아래 §6)
  lib/memoDraftStorage.ts    # localStorage 초안 저장/복원/삭제
  ui/VoiceRecorder.tsx       # "use client" — Web Speech 녹음 + 실시간 자막
  ui/MemoComposer.tsx        # "use client" — 녹음/텍스트 탭 + 정리본 편집 미리보기 + 승인

features/memo-manage/             # 목록·편집·삭제
  client.ts          # Server Action re-export: updateMemoAction, deleteMemoAction
  api/updateMemoAction.ts, deleteMemoAction.ts   # "use server", 소유 검증
  ui/MemoList.tsx    # "use client" — 목록 + 편집/삭제 (MemoCard에 액션 주입)

widgets/memo/
  ui/MemoWidget.tsx  # composer + list 조합

app/(dashboard)/memos/page.tsx    # 전용 페이지 (RSC — listMemos 초기 데이터)
                                  # 메인 페이지엔 "최근 3개" 요약 위젯
shared/lib/db/schema/memo.ts
```

**client/server seam (Gotcha #7)**: `"use client"` 컴포넌트는 오직 `features/*/client.ts`
(Server Action re-export)만 import. server-only 함수(postgres 의존)가 같은 barrel에 섞이면
client 번들이 `module-not-found: 'net'/'tls'`로 build 실패. typecheck·lint는 못 잡고
`pnpm build`만 잡으므로 PR 전 build 1회 필수.

## 5. 데이터 흐름

### 음성 메모 (승인 필요)
```
[녹음 시작] recognition.start(), lang="ko-KR", continuous=true, interimResults=true
  → onresult: event.resultIndex부터 순회, isFinal만 rawContent에 append,
              interim은 별도 버퍼(실시간 자막 state)
  → onend: 사용자가 녹음 중이면 자동 재시작(debounce). 아니면 종료.
  → onerror: not-allowed/no-speech/network/aborted 분기 처리
[녹음 종료] rawContent 확정 → localStorage 초안 저장
  → cleanupTranscript(rawContent)  [Server Action → LLM(sonnet-5)]
  → cleaned 반환 → 편집 가능한 미리보기 (localStorage 갱신)
[편집] (선택) cleaned 수정
[승인] createMemoAction({source:'voice', rawContent, cleanedContent, title?})
  → DB 저장 → localStorage 초안 삭제 → revalidatePath
[재생성/거부] cleanupTranscript 재호출 or 녹음 재시작
```

### 텍스트 메모 (AI 없음, 바로 저장)
```
[텍스트 입력] → trim 검증(빈 값 금지) → [저장]
  → createMemoAction({source:'text', rawContent:입력, cleanedContent:입력, title?})
  → revalidatePath
```

### 편집/삭제 (저장된 메모)
```
[편집] cleaned/title 인라인 수정 → updateMemoAction(id, {cleanedContent, title})
       (raw_content은 immutable — 편집 대상 아님)
[삭제] deleteMemoAction(id) → revalidatePath
```

## 6. Web Speech API 함정 처리 (핵심)

Web Speech API는 "간단한 브라우저 내장"이 아니다. 아래를 훅에서 반드시 처리:

- **부분 지원**: Chrome/Safari partial, Firefox 기본 비활성, Edge 미지원. 미지원 브라우저는
  녹음 탭 비활성 + 텍스트 탭 안내. 음성은 best-effort로 문서에 명시.
- **중복 final 방지**: `event.resultIndex`부터 순회하고 `isFinal===true`만 append.
  이 처리를 빼면 결과가 누적 중복된다(가장 흔한 버그).
- **자동 종료**: `continuous=true`여도 브라우저가 임의로 `onend` 발화. 사용자가 아직 녹음
  중이면 `onend`에서 재시작하는 루프 + 재시작 debounce.
- **에러 분기**: `not-allowed`(권한 거부→텍스트 탭 유도), `no-speech`(무음→계속),
  `network`(재시도), `aborted`(사용자 중단→종료).
- **언어 고정**: `recognition.lang = "ko-KR"`.
- **React 19 순수성**: 이벤트 콜백에서만 setState. 렌더 중 setState/Date.now() 금지
  (프로젝트 gotcha). 훅으로 격리.

## 7. AI 클린업 (cleanup-transcript.ts)

`draft-reply.ts` 미러:
- `analyzeStructured` + Zod `ResponseSchema = z.object({ cleaned: z.string().min(1).max(N) })`.
- `MAX_INPUT` 길이 제한.
- SYSTEM_PROMPT = **transcript normalizer**: "받아쓰기 원문의 군말·오류·중복을 제거하고
  문장부호와 문단을 정리한다. **요약·판단·할일추출·내용삭제·고유명사 변경 금지.** 원문의
  모든 정보를 보존한다. 응답은 정리된 텍스트만."
- 모델: `claude-sonnet-5`.
- **출력 검증**: 빈 문자열 / 과도한 축약(<원문 60%) / refusal 문구 감지
  (`isRefusalDraft` 패턴 재사용) → **raw fallback**(원문을 그대로 미리보기에 넣고 "AI 정리
  실패, 원문으로 진행하거나 재시도" 안내). 메모 유실 없음.
- **관측**: `logLlmSpend` best-effort try/catch swallow (토큰만, 본문 미로깅).

## 8. 에러 처리

- 브라우저 미지원 / 마이크 권한 거부: 텍스트 탭으로 유도. 텍스트 메모는 항상 동작.
- AI 클린업 실패(타임아웃/quota): raw fallback (§7).
- 관측 로깅 실패가 저장 성공을 뒤집지 않게 best-effort (관측 정책).
- Server Action 에러는 `.then(success, failure)` 유니온 패턴 (react-hooks/error-boundaries 룰).
- 모든 쓰기는 세션 `user_id` 소유 검증 (IDOR 방지).
- 승인 버튼 다중 클릭: 클라이언트 pending disable + 서버측 방어.

## 9. 테스트

- **순수 유닛**: title 자동 파생, 발췌 생성, raw/cleaned 매핑, source 판별.
- **Web Speech 훅**: `resultIndex` 중복 방지, `onend` 자동 재시작, interim/final 누적,
  에러별 상태 전이 (jsdom mock).
- **클린업 검증**: 스키마 export + 직접 safeParse (analyzeStructured mock 함정 회피).
  refusal 문구 / 과도 축약 / 빈 결과 → raw fallback 단언.
- **DB 통합**: createMemo/listMemo/소유권/raw immutable/빈 content 거부/title trim
  (`TEST_DATABASE_URL` 필요).
- **게이트**: `pnpm typecheck && pnpm lint && cd apps/dashboard && pnpm build` (seam은 build만 잡음).

## 10. 독립 검토 반영 (codex)

codex `exec` 검토를 반영:
- **수용**: localStorage 초안 저장(P0-1), Web Speech 함정 전체(P0-2), 모델 Sonnet 하향(P0-3),
  raw immutable·NOT NULL·title 확정(P1-5), 길이 제한(P1-4), FSD 경계 정리(P1-6),
  중복 저장 방어(P2), 프라이버시 정직성.
- **기각(과설계/맥락 부적합)**: IndexedDB·TTL·chunk cleanup·background job(개인 메모 + 길이
  제한으로 불필요), cleanup 메타 컬럼(승인=저장이라 status 불필요), soft delete, idempotency
  key(pending+서버방어로 충분), 텍스트 메모 autosave(화면에 보이고 즉시 저장이라 유실 낮음).
