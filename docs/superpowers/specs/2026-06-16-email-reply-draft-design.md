# 이메일 답장 초안 생성 — 설계 문서

작성일: 2026-06-16
브랜치: `feat/email-widget-settings`
범위: "오늘 답장 필요" 위젯(`ReplyCard`)의 "답장하기" 액션

## 1. 배경 & 목표

현재 "답장하기" 버튼은 단순히 Gmail 스레드를 새 탭으로 여는 `<a>` 링크다
(`apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx:111`). 본문 분석이나
답장 생성은 전혀 없다.

**목표**: "답장하기"를 누르면 LLM이 원본 메일 본문을 분석해 답장 초안을 생성하고,
사용자가 대시보드에서 수정한 뒤 **Gmail 초안(draft)으로 저장**한다. 최종 검토·발송은
Gmail에서 한다.

사용자 원문: *"답장하기를 실행하면 문장을 분석해서 적절한 답장을 만들고, 수정 가능하도록
구현해줘"* — 즉 **생성 + 수정**이 요구사항이고, 발송은 명시되지 않았다.

## 2. 핵심 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 종착점 | **Gmail 초안 핸드오프** (대시보드 발송 X) | 이메일 발송은 비가역·외부 발신. 요구는 "생성+수정". 발송은 Gmail에서 사용자가 |
| 본문 깊이 | **메일 본문 전체** (`format=full` + MIME 파싱) | 맥락을 제대로 읽어야 "적절한 답장" |
| 편집기 UI | **인라인 펼침** (카드 아래 확장) | 리스트 맥락 유지, 기존 ReplyCard와 자연 통합 |
| 톤 조절 | **자동 톤 + "다시 생성"만** | v1 단순화. 수정 자유도는 textarea로 확보 |
| 초안 저장소 | **Gmail drafts 전용, 대시보드 DB 무저장** | 생성 비용·동기화 복잡도 회피. 매 클릭 fresh 생성 |
| 본문 절단 | **기존 5KB 정책 재사용** (`MAX_BODY_BYTES`) | classify-thread.ts와 일관 |
| Rate limit | **없음** (v1) | 개인 사용, 호출 빈도 낮음 |

## 3. OAuth Scope — 재인증 불필요

현재 NextAuth Gmail scope: `gmail.readonly` + `gmail.modify`
(`apps/dashboard/src/shared/lib/auth/index.ts:65-66`).

`gmail.modify`는 Gmail API에서 `drafts.create`의 authorized scope에 포함된다
(`compose`/`send`의 상위 집합). 기존 사용자는 markAsRead/archive 때문에 이미
`gmail.modify`를 grant받았으므로 **토큰 그대로 동작, 추가 OAuth 재인증 불필요**.

**단 하나의 위험 — Gotcha #6**: `@auth/drizzle-adapter`의 `linkAccount` silent fail로
`accounts` row의 scope 문자열이 stale일 수 있다(2026-05-12 Calendar 사고 사례).
방어선: draft 생성 호출부에서 `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`를 명시 감지해
"재로그인 필요" 안내로 폴백.

## 4. 아키텍처 & 데이터 흐름

```
[ReplyCard "답장하기 ▾" 클릭 → 인라인 펼침, 첫 클릭 시 생성]
        │
        ▼
generateReplyDraft(threadId)  ← Server Action
  1. auth + 소유권 확인 (session.user.id)
  2. accessToken 확보 (기존 gmail-sync 토큰 패턴 재사용)
  3. getThread(token, gmailThreadId, format=full)  ← 신규
       thread의 messages 중 From이 ownerEmail이 아닌 마지막 메시지 선택
       (전부 본인 발신이면 가장 마지막 메시지로 폴백)
       → 한 번의 호출로 inbound 메시지 선택 + 본문 payload + 헤더 모두 확보
         (getMessageBody 별도 호출 불필요 — N+1 회피)
  4. extractBody(payload)  ← mime.ts. 본문 텍스트 추출
       + 헤더에서 Message-ID, From, Reply-To, Subject, References 파싱
  5. classify 결과(severity/reason)와 함께 LLM 호출
  6. draftReply(input)  ← 신규 LLM 유틸 → { body }
  7. 반환: { draftBody, replyMeta }  (실패 시 discriminated union)
       replyMeta = { gmailThreadId, toEmail, subject, inReplyTo, references }
       → saveReplyDraft가 스레딩에 사용 (Gmail 3조건)
        │
        ▼ (사용자가 textarea에서 수정)
saveReplyDraft(threadId, editedBody)  ← Server Action
  Gmail drafts.create (RFC822, In-Reply-To/References로 스레드 연결)
  → { gmailDraftId }
        │
        ▼
  "✓ Gmail 초안함에 저장됨" + Gmail 링크
```

**원칙**: 대시보드 DB에 초안을 저장하지 않는다. 초안은 Gmail drafts에만 존재.

## 5. 컴포넌트 분해

### Gmail API 레이어 (`shared/api/gmail/`)

| 파일 | 책임 | 의존 |
|---|---|---|
| `threads.ts` (신규) | `getThread(token, gmailThreadId)` — `threads.get` format=full. messages 배열(payload+헤더) 반환. inbound 메시지 선택은 호출자(Server Action) | 기존 fetchWithRetry |
| `mime.ts` (신규, 순수) | Gmail payload 트리 → 본문 텍스트. multipart/alternative 재귀, base64url 디코드, text/plain 우선·없으면 HTML strip, 인용부(`>`, `On … wrote:`) 절단 | 없음 |
| `drafts.ts` (신규) | `createDraft(token, params)` — RFC822 빌드. **Gmail 스레딩 3조건 필수**: ① message 리소스에 `threadId` 명시 ② `In-Reply-To`+`References` 헤더(RFC 2822) ③ `Subject`가 원본과 일치(`Re:` 접두). 한글 안전: body `Content-Type: text/plain; charset="UTF-8"` + Subject MIME encoded-word(`=?UTF-8?B?…?=`). base64url 인코딩 후 `drafts.create` POST. 403 SCOPE 명시 감지 | classifyGmailError |
| `errors.ts` (수정) | `GmailScopeError`(403, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) 추가 + classifyGmailError에서 분기 | 없음 |

### LLM 레이어 (`shared/lib/llm/`)

| 파일 | 책임 |
|---|---|
| `draft-reply.ts` (신규) | `draftReply(input)` — classify-thread.ts 패턴 미러. `analyzeStructured` + Zod로 `{ body }` 강제. systemPrompt에 "광고/공지/답장 불필요 케이스면 짧은 정중 거절 또는 빈 초안" 포함. 본문 5KB 절단 |

### Feature 슬라이스 (`features/email-reply/`)

Gotcha #7 (server/client seam) 준수:

| 파일 | 책임 |
|---|---|
| `index.ts` | server entrypoint (`import "server-only"`) |
| `api/generateReplyDraft.ts` | `"use server"` — 본문 fetch → LLM → 초안 반환 |
| `api/saveReplyDraft.ts` | `"use server"` — editedBody → Gmail draft 생성 |
| `client.ts` | 두 Server Action 재export (client 컴포넌트용) |

### 위젯 (`widgets/email-digest/ui/`)

| 파일 | 책임 |
|---|---|
| `ReplyCard.tsx` (수정) | "답장하기" `<a>` → 버튼+인라인 토글로 변경 |
| `ReplyComposer.tsx` (신규) | 펼침 영역. textarea(수정 가능) + 3버튼(Gmail 초안 저장/다시 생성/취소), useTransition 로딩, 에러 표시 |

## 6. 에러 처리

| 실패 지점 | 처리 |
|---|---|
| 본문 fetch 실패 (메시지 삭제 등) | "원본 메일을 불러올 수 없습니다" + snippet 폴백 생성 |
| MIME 파싱 결과 빈 본문 | snippet으로 폴백 (본문 0줄이어도 생성 진행) |
| LLM 불가 (`llm-unavailable`) | "초안 생성 실패, 다시 시도" — discriminated union |
| Gmail draft 403 SCOPE | "Gmail 쓰기 권한 없음, 재로그인 필요" (Gotcha #6 방어) |
| draft 생성 기타 실패 | "초안 저장 실패" + 편집 내용 유지(날아가지 않게) |

**React 규칙** (메모리: react-error-boundaries-lint-rule, react-19-purity):
- Server Action은 try/catch 안 JSX 금지 → `.then(success, failure)` discriminated union 반환
- composer setState는 이벤트 핸들러/useTransition 콜백에서만

## 7. 테스트 전략

| 대상 | 종류 | 핵심 케이스 |
|---|---|---|
| `mime.ts` | 순수 단위 | multipart/alternative, base64url, HTML-only, 인용부 절단, 빈 payload |
| `draft-reply.ts` | 단위(LLM mock) | 정상 초안, 광고 메일 → 빈/거절 초안, LLM 에러 |
| `drafts.ts` | 단위 | RFC822 3조건(threadId 전달·In-Reply-To/References·Subject 일치), **한글 Subject(encoded-word)·한글 body(UTF-8 charset)**, base64url 인코딩 |
| Server Actions | 통합 | 인증/소유권, 폴백 경로 |

**검증** (Gotcha #7): `pnpm typecheck && pnpm lint` + `cd apps/dashboard && pnpm build`
(server/client seam은 build만 잡음) 필수.

## 8. 명시적 비범위 (v1 제외)

- 대시보드에서 직접 발송 (Gmail 초안 핸드오프만)
- 톤 선택 버튼 (자동 톤 + "다시 생성"만)
- 대시보드 DB에 초안 영속화
- Rate limit / 호출당 비용 가드 (rateLimit.ts 미적용)
- 첨부파일 처리 (텍스트 본문만)
