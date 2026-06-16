# 이메일 답장 모달 + 즉시 발송 + 모델 선택 설계

- **날짜**: 2026-06-16
- **도메인**: Email 분석 (reply-needed 위젯)
- **상태**: 설계 승인 대기
- **선행 작업**: 인라인 `ReplyComposer`(커밋 `e55f2ac`~`0777e4d`), 답장 언어 설정(`2026-06-16-reply-language-setting-design.md`)

## 1. 배경 & 문제

현재 "답장하기"는 카드 안에서 인라인으로 펼쳐지는 `ReplyComposer`로, LLM 초안 1개를 생성해 편집 후 **Gmail 초안 저장**만 한다. 사용자는 다음을 원한다:

1. 인라인이 아닌 **모달**에서 더 풍부한 답장 작성
2. 초안 저장뿐 아니라 **즉시 발송**
3. 초안 생성 **LLM 모델을 설정에서 선택**(추천 모델 표시)

### 1.1 발견된 치명적 결함 (선결 과제)

현재 초안 생성이 **깨져 있다**. 스크린샷의 AI 초안이 실제 답장이 아니라 거절 메시지였다:

> "I appreciate you reaching out, but I'm Claude Code, Anthropic's CLI... I'm not able to help with composing email responses."

**원인**: `draft-reply.ts`가 `HAIKU_MODEL` + `provider: "claude-cli"`로 cli-proxy-api(192.168.0.5:8317)를 호출하는데, 이 프록시는 Claude Code CLI auth로 동작한다. Claude Code CLI의 "나는 코딩 도우미" 정체성이 이메일 작성 system prompt를 뚫고 거절을 내보낸다.

**영향**: 이 위에 "즉시 발송"을 얹으면 거절 메시지가 실제 수신자(서울시청 등)에게 발송되는 사고가 난다. 따라서 발송 기능 전에 초안 품질을 반드시 고친다.

## 2. 결정 요약

| 항목 | 결정 |
|---|---|
| UI 형태 | 인라인 `ReplyComposer` → **모달**로 교체 (인라인 제거) |
| 초안 품질 | **모델 라우팅을 Gemini 기본값으로** + 거절 패턴 감지 안전망 (이중 안전장치) |
| 모달 기능 | To/CC/BCC 편집, 제목 편집, 톤·길이 선택, 원본 메일 본문 표시, **톤별 초안 3개 동시 생성**(탭 비교) |
| 발송 | 초안 저장 + **즉시 발송**, 발송은 **2단계 확인 다이얼로그** 게이트 |
| 발송 경로 | `createDraft` → `sendDraft(draftId)` (기존 인프라 재사용, raw `messages.send` 안 만듦) |
| 모델 선택 | `email_settings.reply_model`(gemini/codex/claude) 설정 추가, **gemini 추천·기본값** |
| 멀티 초안 | 톤 3개(정중/간결/친근), 탭별 **편집 내용 독립 보존** |

## 3. 아키텍처 / 파일 구조

```
entities/email-settings/model/
├── types.ts                    [수정] EmailSettings에 replyModel 추가 + 기본값 gemini
├── replyModel.ts               [신규] 모델 키·라벨·벤더·추천 메타 (saju-model-registry-meta 미러)
└── replyModel.test.ts          [신규] 키 파서·기본값·추천 플래그 테스트

features/email-reply/
├── api/
│   ├── generateReplyDraft.ts   [수정] 톤 3개 병렬 생성 + settings.replyModel 라우팅
│   ├── saveReplyDraft.ts       [유지]
│   └── sendReply.ts            [신규] 즉시 발송 Server Action (소유권 재검증)
├── client.ts                   [수정] sendReply export 추가
└── index.ts                    [수정] sendReply export 추가

features/email-settings-manage/
├── api/_schema.ts              [수정] replyModel Zod enum
├── api/updateEmailSettings.ts  [수정] replyModel 수집·저장
└── ui/EmailSettingsForm.tsx    [수정] 모델 select + 추천 배지 UI

shared/api/gmail/
├── send.ts                     [신규] sendDraft(draftId) — drafts.send
└── index.ts                    [수정] sendDraft export

shared/lib/llm/
├── draft-reply.ts              [수정] tone·length·model 파라미터, 거절 패턴 감지
└── reply-model-registry.ts     [신규] server-only, env 기반 모델 키→ID 해석 (saju-model-registry 미러)

widgets/email-digest/ui/
├── ReplyCard.tsx               [수정] 인라인 토글 → 모달 오픈 버튼
├── ReplyComposer.tsx           [제거] → ReplyModal로 교체
├── ReplyModal.tsx              [신규] 모달 컨테이너 (포커스 트랩·ESC·오버레이·role=dialog)
├── ReplyModalBody.tsx          [신규] 탭·편집·필드·상태머신
└── SendConfirmDialog.tsx       [신규] 2단계 발송 확인

DB 마이그레이션:
└── drizzle/XXXX_reply_model.sql  [신규] email_settings.reply_model 컬럼 추가
```

## 4. 데이터 흐름

### 4.1 모달 오픈 → 초안 생성

1. `ReplyCard` "답장하기" 클릭 → `ReplyModal` 오픈
2. 모달 마운트 → `generateReplyDraft(threadId)` 1회 호출
3. 서버:
   - thread 본문 fetch + inbound 메시지 선택 (기존 `pickInbound`)
   - `getEmailSettings(userId)` → `replyModel` + `replyLanguage` 조회
   - **톤 3개(polite/concise/friendly)를 병렬 LLM 호출** (`Promise.allSettled`)
   - 반환: `{ drafts: { tone, body, status }[], meta }`
     - `meta`: 원본본문(표시용), gmailThreadId, toEmail, subject, inReplyTo, references
4. 모달: 탭 3개로 표시, 첫 탭(정중) 본문이 편집창에 로드

### 4.2 편집

- **탭별 편집 내용 독립 보존**: 각 탭이 자기 본문 상태를 가짐. 정중 탭 수정 후 간결 탭 갔다 와도 유지.
- To(자동 채움)·CC·BCC·제목 필드 편집 가능
- 톤·길이 selector 변경 또는 "다시 생성" → 해당 탭만 재호출
- 원본 메일 본문은 접이식(collapsible) 영역으로 표시

### 4.3 저장 / 발송

- **"초안 저장"**: `saveReplyDraft(threadId, body, meta)` — 기존 그대로
- **"발송"**: `SendConfirmDialog` 오픈(받는사람·제목·본문 미리보기) → [보내기] → `sendReply(threadId, body, meta)`
  - 서버: 소유권 재검증 → `createDraft` → `sendDraft(draftId)` → 성공 시 모달 닫기 + 카드 제거(`markAsReplied` 자동 호출)

### 4.4 상태 머신 (ReplyModalBody)

```
loading
  → editing { drafts[3], activeTab, fields, perTabBody }
      → saving → saved
      → sending → (confirm dialog) → sent
      → error(message)
```

## 5. 초안 품질 개선 (핵심)

### 5.1 모델 라우팅

- `draft-reply.ts`가 `model` 파라미터를 받아 `reply-model-registry.ts`에서 모델 키→실제 ID 해석
- 기본값/추천 = **gemini-2.5-pro** (Claude CLI 정체성 없음, saju 도메인에서 검증된 경로)
- `gatewayDefaults`(provider: claude-cli)는 프록시가 모델 문자열로 분기하므로 그대로 사용 — 프록시가 `gemini-*`를 Gemini CLI auth로 라우팅

### 5.2 거절 패턴 감지 (이중 안전망)

초안 본문이 거절 패턴을 포함하면 해당 톤을 `status: "refusal-detected"`로 마킹.
패턴은 **CLI 정체성 누수에 특이적인 문구만** 사용 — 정상 답장에 등장할 수 있는 일반어("코딩", "software engineering" 등)는 오탐 위험이 있어 제외:

```
패턴(대소문자 무시, AND 아닌 OR):
  "I'm Claude Code", "I am Claude Code", "Anthropic's CLI",
  "Claude Code, Anthropic", "not able to help with composing",
  "I'm not able to help with"
```

- 감지된 탭: 발송·저장 버튼 비활성 + "이 초안은 비정상입니다. 다시 생성하세요" 경고
- 패턴 목록은 `draft-reply.ts` 상수로 분리해 테스트로 고정 (오탐/누락 회귀 방지)
- 모델을 바꿔도 만일을 대비 — 깨진 초안이 절대 발송되지 않도록 보장

### 5.3 톤·길이 프롬프트 분기

`draftReply` 입력에 추가:
- `tone: "polite" | "concise" | "friendly"`
- `length: "short" | "medium" | "long"`

system prompt에 톤·길이 지시문 분기 (기존 `languageInstruction` 패턴 그대로 함수 분리).

## 6. 모델 선택 설정

### 6.1 레지스트리 (`entities/email-settings/model/replyModel.ts`)

| 키 | 라벨 | 벤더 | 추천 | 설명 |
|---|---|---|---|---|
| `gemini` | Gemini 2.5 Pro | Google | ⭐ | 이메일 작성 자연스러움. CLI 정체성 누수 없음 |
| `codex` | Codex (GPT-5) | OpenAI | | 대안. 간결한 톤 |
| `claude` | Claude (Haiku) | Anthropic | ⚠️ | cli-proxy 경유 시 거절 누수 위험 — 비추천 |

```typescript
export const REPLY_MODEL_KEYS = ["gemini", "codex", "claude"] as const;
export type ReplyModelKey = (typeof REPLY_MODEL_KEYS)[number];
export const DEFAULT_REPLY_MODEL_KEY: ReplyModelKey = "gemini";
// label, vendor, recommended, description 메타 + parseReplyModelKey()
```

- env 기반 실제 ID 해석은 `reply-model-registry.ts`(server-only)에서 — saju의 `saju-model-registry.ts` 패턴
- 메타 파일(키·라벨·추천)은 client/server 양쪽 import 안전(순수)

### 6.2 UI (`EmailSettingsForm.tsx`)

- select 추가 — 각 옵션 라벨 + 추천 배지(⭐) + 짧은 설명
- `claude` 옵션엔 경고 힌트(⚠️ 비추천 사유)
- 답장 언어 select 바로 아래 배치

### 6.3 불변식

- 미설정 사용자 = `gemini`(추천) → 기존 깨진 claude-cli 경로에서 자동 탈출
- 안전한 기본값 보장 + 사용자 제어 가능 (C안의 품질 개선을 설정화)

## 7. 보안

- `sendReply` Server Action: `saveReplyDraft`와 동일하게 **DB의 `gmailThreadId`로 소유권 재검증** (클라이언트 `meta` 불신)
- CRLF 헤더 인젝션 sanitize: 기존 `buildRfc822` 재사용 (To/CC/BCC 모두 sanitize 통과)
- CC/BCC 신규 입력 필드 → `buildRfc822`에 Cc/Bcc 헤더 추가 시 동일 `sanitizeHeader` 적용
- scope: `gmail.modify` 보유 → `drafts.send` 허용(modify scope에 send 포함), 재인증 불필요

## 8. 에러 처리

| 상황 | 처리 |
|---|---|
| LLM 3개 중 일부 실패 | 성공한 톤만 탭 표시, 실패 탭은 "재생성" 버튼 |
| LLM 전체 실패 | `llm-unavailable` → "다시 시도" |
| 거절 패턴 감지 | 발송·저장 비활성 + 경고 |
| Gmail scope 없음 | `scope-required` → "재로그인" |
| 발송 실패 | `send-failed` → 모달 유지, 에러 표시 (초안 안 날아감) |
| 발송 성공 | 모달 닫기 + 카드 제거 |

## 9. 접근성 (모달)

- `role="dialog"` + `aria-modal="true"`, `aria-labelledby`
- 포커스 트랩(모달 밖 탭 이동 차단), ESC 닫기
- 오버레이 클릭 닫기 — 편집 중이면 확인
- 오픈 시 첫 입력 필드 포커스, 닫을 때 트리거 버튼으로 포커스 복귀
- 탭 UI는 `role="tablist"`/`role="tab"`/`role="tabpanel"` + 화살표 키 이동

## 10. 테스트 전략

| 대상 | 테스트 | DB |
|---|---|---|
| `draft-reply.ts` | 톤·길이·모델별 prompt/ID 분기, 거절 패턴 감지 | 불필요(pure) |
| `replyModel.ts` | 키 파서, 기본값=gemini, 추천 플래그 | 불필요 |
| `reply-model-registry.ts` | 키→env ID 해석, 폴백 | 불필요(env mock) |
| `send.ts` (`sendDraft`) | drafts.send 호출, scope 에러 분류 | 불필요(fetch mock) |
| `_schema.ts` | replyModel Zod enum 검증 | 불필요 |
| `sendReply.ts` | 소유권 재검증(잘못된 threadId 거부) | 통합(`TEST_DATABASE_URL`) |
| 모달 컴포넌트 | 탭별 편집 보존, 발송 확인 게이트, a11y | 선택(vitest+RTL) |

기존 `draft-reply.test.ts`, `drafts.test.ts`, `replyLanguage.test.ts` 패턴 준수.

## 11. FSD / 빌드 주의사항

- `features/email-reply`의 server/client seam 유지 (Gotcha #7): `sendReply`("use server")는 `client.ts`로도 export, server-only 함수와 섞지 않음
- `reply-model-registry.ts`는 server-only — UI는 `replyModel.ts`(순수 메타)만 import (entity barrel server/client seam, Gotcha #1)
- `shared/draft-reply`가 entity 타입을 import하면 boundaries lint 위반 → 톤/모델 유니온은 **인라인 리터럴 유니온**으로 (replyLanguage 패턴, `reply-language-setting-fsd-inline-union` 메모리)
- **빌드 검증**: `cd apps/dashboard && pnpm build` PR 전 1회 필수 (typecheck+lint만으론 server/client seam 못 잡음)

## 12. 운영 / 마이그레이션

- `email_settings.reply_model` 컬럼 추가 — 운영 마이그레이션은 **이미지 교체 前 psql ALTER TABLE 먼저** (replyLanguage 사고 교훈)
- 기본값 `'gemini'` NOT NULL → 기존 row 자동 채움
- `drizzle-kit migrate`가 운영 tracking 못 잡으면 psql 직접 BEGIN/COMMIT 우회 (메모리 `drizzle-kit-migrate-prod-broken`)

## 13. 범위 밖 (YAGNI)

- 첨부파일, 예약 발송, 서명 자동삽입, 번역, 발송 후 Undo 윈도우
- DB에 답장 본문 저장 (현행대로 무저장 — 매번 fresh 생성)
