# gons-dashboard 이메일 위젯 정밀 감사 리포트

## 1. 개요

**스코프**: 이메일 도메인 위젯 표면(`email-digest`, `important-emails`, reply flow 모달)을 1차로, 이를 떠받치는 파이프라인 전체 — `features/gmail-sync`, `features/email-reply`, `features/email-settings-manage`, `entities/email`, `shared/api/gmail`, `shared/lib/llm`, `shared/lib/cron`, `apps/cron`, `@krdn/email` 분류기, eval 하네스 — 까지 포함.

**감사 방법**: 6차원 fan-out(reply flow / classification / gmail-sync / cron / widget a11y·일관성 / schema·security) → 기존 baseline 결함(이미 정정된 '오늘의 답장' 라벨 등) dedup → 27건 발견을 배치 단위 adversarial verify(각 발견을 file:line 근거로 재현 시도, status를 confirmed/overstated/rejected/tracked로 판정).

**발견 요약**:

| 구분 | 건수 |
|------|------|
| confirmed (재현 검증 통과) | 26 |
| rejected/intentional (기각) | 0 |
| tracked (이미 backlog) | 1 |
| unverified (검증 누락) | 0 |

**심각도 분포**: P0 **0건** · P1 **7건** · P2 **19건** (tracked 1건은 P2). 데이터 손실·활성 익스플로잇급 P0는 없음. P1 7건은 비용 누수·기능갭·sync stall·보안 노출에 집중.

> ⚠️ overstated 정정 반영: #4·#5·#9는 원 라벨이 P1이었으나 검증 결과 **관측성/표시 정확성 갭**(기능 파손·데이터 손실 없음)으로 P2 재평가. 본문은 정정된 등급·프레이밍을 따른다.

---

## 2. Top 우선순위 (shortlist)

P0 부재 → 가장 임팩트 큰 **P1 7건**이 곧 shortlist. 비용 누수와 sync 신뢰성이 핵심 축.

| 우선순위 | 종류 | 제목 | 표면 | 근거 (file:line) |
|---|---|---|---|---|
| P1 | fix | 답장 발송 후 `repliedAt` 미갱신 → 답장한 스레드 위젯 재등장 | reply flow | `apps/dashboard/src/features/email-reply/api/sendReply.ts:49` |
| P1 | fix | 메일링리스트 시그널 헤더 fetch 안 함 → unsubscribe 선필터 3/4 규칙 사망 (Haiku 비용 누수) | classification | `apps/dashboard/src/shared/api/gmail/messages.ts:97` |
| P1 | fix | reclassify가 signalsMap 미전달 → 메일링리스트 prefilter 통째 우회 | classification | `apps/dashboard/src/features/gmail-sync/api/reclassifyRecent.ts:88` |
| P1 | fix | 단일 메시지 getMessage 404 실패가 사용자 전체 sync 중단 + historyId 미전진 다중일 stall | gmail-sync | `apps/dashboard/src/features/gmail-sync/api/syncInbox.ts:175` |
| P1 | fix | first-sync/stale-rescan 후 24h~7d 메일 영구 분류 누락 (digest 윈도우 불일치) | gmail-sync | `apps/dashboard/src/features/gmail-sync/lib/full-rescan.ts:40` |
| P1 | fix | 발송 확인 게이트가 CC/BCC 수신자를 숨김 — 비가역 액션 미리보기 불완전 | reply flow | `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx:40` |
| P1 | fix | Gmail accounts 토큰 평문 저장 (pgcrypto 미적용) — 문서-현실 불일치 | shared/security | `apps/dashboard/src/shared/lib/db/schema/auth.ts:39` |

---

## 3. 🔧 수정해야 할 기능 (fix)

### Reply flow

#### 답장 발송 성공 후 `replyNeeded.repliedAt` 미갱신 — 답장한 스레드가 위젯에 재등장
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/features/email-reply/api/sendReply.ts:49-61` · `apps/dashboard/src/widgets/email-digest/ui/ReplyCard.tsx:146-150` · `apps/dashboard/src/entities/email/api/getReplyNeeded.ts:85`

**상세**: `sendReply`는 `createDraft → sendDraft`만 하고 DB `replyNeeded`를 갱신하지 않는다(`markAsReplied` 미호출, `revalidatePath` 미호출). 발송 성공 시 `ReplyCard.onSent`는 client-only `isHidden=true`로 카드를 가리고 `router.refresh()`만 호출한다. `getReplyNeeded`는 `isNull(repliedAt)` 필터라, 실제 답장한 스레드도 DB상 여전히 '답장 필요'로 남는다. `isHidden`은 마운트 동안만 유효한 마스크라 페이지 새로고침/재마운트 시 리셋 → 이미 보낸 메일이 '답장 필요' 위젯에 재등장, 사용자에게 재답장을 재촉. 수동 '답장 완료' 버튼(`markAsReplied.ts:23-37`은 `repliedAt=now`+`userAction='replied'`+revalidate 수행)과 '발송' 경로가 분리된 빈틈.

**제안**: `sendReply`가 `sendDraft` 성공 직후 `replyNeeded`를 `repliedAt=now, userAction='replied'`로 UPDATE(`markAsReplied` 로직 재사용) + `revalidatePath(ROUTE_DASHBOARD)`. 소유권 재검증이 이미 `sendReply` 안에 있으므로 서버측 처리가 더 견고.

---

#### thread fetch 실패(snippet 폴백) 시 In-Reply-To/References 공백 → 답장이 새 스레드로 분리될 위험
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/features/email-reply/api/generateReplyDraft.ts:86-110` · `apps/dashboard/src/shared/api/gmail/drafts.ts:1-4,72-77`

**상세**: `getThread` 실패 시 `GmailScopeError`가 아니면 snippet 폴백으로 진행하고 `inbound=null`. 이때 `messageId`/`existingRefs`가 빈 문자열이 되어 `createDraft`가 `In-Reply-To`/`References` 헤더를 생략(`drafts.ts:72-77`). 코드 자신의 주석(`drafts.ts:1-4`)과 프로젝트 메모리가 명시하듯 Gmail 스레딩은 threadId+In-Reply-To/References+Subject 3조건 AND. 폴백 경로에서 발송된 답장은 원 대화에 안 붙고 별도 스레드로 떨어질 수 있는데, 이 약화가 호출자에게 드러나지 않는다.

**제안**: (a) `emailThreads`에 저장된 마지막 메시지 Message-ID를 보조 소스로 폴백하거나, (b) `inReplyTo`가 비면 `meta.threadingDegraded:true` 플래그로 모달에 '스레드 연결이 약할 수 있음' 경고 + 재시도 유도. 최소한 `logger.warn`에 `inReplyTo` 공백을 별도 필드로 남겨 빈도 추적.

---

#### `saveReplyDraft`의 `createDraft` 실패가 무로깅 silent swallow — #151이 형제 파일만 고침
**심각도 P2 · overstated(P1→P2 정정)**
근거: `apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts:65-68`

**상세**: catch가 비-scope 에러(403/429/500/네트워크)를 로깅 없이 `save-failed`로 뭉친다. PR #151(`14ea8e0`)이 정확히 이 패턴을 형제 `sendReply.ts:69-75`에서 `logger.error`(googleReason/status/message 구조화)로 고쳤으나, stat 확인 결과 #151은 `generateReplyDraft.ts`+`sendReply.ts` 2개만 건드렸고 `saveReplyDraft`는 누락. 초안 저장 실패 시 운영에서 원인 추적 불가 — `sendReply`와 동일 `createDraft` 호출이라 같은 실패 모드. **정정**: 순수 관찰성 갭이며 실패는 UI에 '초안 저장 실패'로 노출되므로 데이터 손실·기능 버그 없음 → P1 아닌 P2.

**제안**: `sendReply.ts:69-75`와 동일하게 catch에 `logger.error('email/saveReplyDraft','save-failed',{userId,threadId,reason,status,message})` 추가, `GmailScopeError`는 `logger.warn`. 반환 유니온 불변(#151 선례).

---

#### 발송 확인 게이트가 CC/BCC 수신자를 숨김 — 비가역 액션 미리보기 불완전
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx:40-45` · `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx:130` · `apps/dashboard/src/features/email-reply/api/sendReply.ts:56-58`

**상세**: 2단계 발송 확인 다이얼로그는 `toEmail`·`subject`만 미리보기로 표시(`cc`/`bcc` props 자체 없음). 사용자가 입력한 CC/BCC는 확인 화면에 안 나타나지만 실제로는 그 주소로 메일이 나간다(`metaWithFields → sendReply → createDraft cc/bcc`). 비가역(외부 발송) 액션의 최종 게이트가 '누구에게 가는지'를 완전히 못 보여줌 → BCC 오타·잘못 붙여넣기가 확인 단계에서 검출 불가. spec §4.3의 명시적 확인 게이트 취지를 무력화.

**제안**: `SendConfirmDialog`에 `cc`/`bcc` props 추가, 값 있을 때만 '참조: …'/'숨은참조: …' 줄 렌더. `ReplyModalBody.tsx:328` 호출부에서 전달. BCC는 특히 강조(굵게/경고색)해 실수 방지.

---

#### 발송 확인 다이얼로그 ESC + 배경 클릭이 확인 없이 작성 초안을 즉시 폐기 (#10≈#13 병합)
**심각도 P2 · confirmed (#13 overstated 프레이밍 정정)**
근거: `apps/dashboard/src/widgets/email-digest/ui/ReplyModal.tsx:18-25,29-31` · `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx`(자체 keydown 핸들러 없음) · `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx:50-68`

**상세**: 모달 닫기 경로 어디에도 가드가 없어 편집 중이던 본문/톤/필드(DB 미저장)가 한 동작에 전부 사라진다. 세 경로 모두 무방비:
- **ESC**: `ReplyModal`이 document 레벨 keydown으로 `Escape→onClose`(모달 전체 닫기). `SendConfirmDialog`는 자체 ESC 핸들러도 `stopPropagation`도 없어, **발송 확인 단계에서 ESC를 누르면 확인만 취소되는 게 아니라 답장 모달 전체가 닫혀** 편집 초안 소실(`ReplyModal.tsx:18-25`).
- **배경 클릭**: 오버레이 `onClick={onClose}`(`ReplyModal.tsx:29-31`)로 1회 클릭에 모달 전체 닫힘.

**정정**: 원 #13의 "배경 클릭만 무방비" 프레이밍은 과장 — ESC·오버레이·확인단계 ESC 모두 동일하게 확인 없이 닫힘. 데이터 손실이나 재작성으로 회복 가능한 중간급.

**제안**: (1) `SendConfirmDialog`에 자체 `Escape→onCancel`+`stopPropagation` 핸들러 추가, 또는 `ReplyModal` keydown에서 `confirmOpen`일 때 `onClose` 건너뛰는 가드. (2) 본문이 수정된 상태면 배경 클릭/ESC 시 '변경사항이 사라집니다' confirm 게이트, 또는 명시적 '취소' 버튼으로만 닫도록.

### Classification — 메일링리스트 prefilter 무력화 클러스터 (별개 원인 2건)

#### ① 메일링리스트 시그널 헤더(List-Unsubscribe/List-ID/Precedence)를 fetch 안 해 unsubscribe 선필터 3/4 규칙이 죽어있음
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/shared/api/gmail/messages.ts:95-103` · `apps/dashboard/src/shared/api/gmail/headers.ts:26-28` · `apps/dashboard/src/entities/email/lib/unsubscribe-filter.ts:21-25`

**상세**: `getMessage`는 `format=metadata` + `metadataHeaders`에 From/To/Subject/Date/Reply-To만 요청 → `List-Unsubscribe`·`List-ID`·`Precedence`가 응답 payload에 절대 포함 안 됨. 따라서 `extractMailingListSignals`는 항상 `hasListUnsubscribe=false, hasListId=false, precedence=null` 반환. `isMailingList()`의 4규칙 중 3개가 죽고, 4번째(`noreply@` From + 본문 unsubscribe 단어)만 남는다. 표준 뉴스레터(List-Unsubscribe만 있고 noreply 아닌 발신자)는 전부 선필터 통과 → Haiku 분류기 직행. 일 $0.05 비용 제약(의도적 단일 Haiku 고정)을 정면으로 깎는 누수 + important 위젯 정확도 저하. 설계 spec D5가 이 3헤더를 안전 필터로 명시했으므로 의도적 결정이 아닌 구현 갭. eval fixture는 시그널을 합성 주입해 이 누락이 invisible.

**제안**: `getMessage`의 `metadataHeaders`에 `"List-Unsubscribe"`, `"List-ID"`, `"Precedence"` 추가(같은 RPC, 추가 비용 0). 회귀 방지로 'List-Unsubscribe 있는 메일 → isMailingList=true' 통합 테스트.

---

#### ② 재분류(reclassify) 경로가 signalsMap 미전달 → 메일링리스트 prefilter를 완전히 우회
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/features/gmail-sync/api/reclassifyRecent.ts:88-95` · `apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts:108-113` · `apps/dashboard/src/entities/email/lib/unsubscribe-filter.ts:21-32`

**상세**: `reclassifyRecent`는 `classifyThreadsLoop`에 `signalsMap`을 안 넘긴다(`syncInbox:233,242`는 전달). 빈 Map → 윈도우 내 모든 스레드가 빈 신호를 받아 `isMailingList()`가 전부 false → 메일링리스트 1차 컷이 통째로 무력화, 벌크/뉴스레터가 Haiku로 직행. 이 경로는 admin 라우트뿐 아니라 사용자 '재분류' Server Action(`reclassifyAction.ts:16`, 설정 변경 시 발화)이라 정기 발화. `force=false`의 `skipped-already` 멱등성이 이미 분류된 행은 보호하지만, **과거 mailing-list 컷돼 `important_emails` 행이 없던 메일**은 행이 없어 재분류 시 매번 LLM을 친다.

**제안**: `reclassifyRecent`도 윈도우 스레드 헤더에서 `extractMailingListSignals`를 채집해 `signalsMap` 구성. 가장 견고한 해법은 메일링 신호를 `email_threads`에 영속화해 sync/reclassify 두 경로가 동일 출처를 읽는 것(①②를 동시 해소).

### Gmail-sync

#### 단일 메시지 getMessage 실패(404 삭제 등)가 사용자 전체 사이클을 죽이고 historyId 미전진으로 다중일 stall
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/features/gmail-sync/api/syncInbox.ts:175-185,131,136` · `apps/dashboard/src/features/gmail-sync/lib/full-rescan.ts:55-82` · `apps/dashboard/src/shared/api/gmail/messages.ts:139-149`

**상세**: `history.list`가 돌려준 ref 중 한 메시지가 get 시점 삭제(404)거나 non-retryable 4xx면 `getMessage`가 throw → `fetchAndUpsertThreads → syncInbox → cron perTarget`까지 전파되어 그 사용자 sync 통째 실패. `createCronHandler`는 사용자 단위 격리만 하고 메시지 단위 격리는 없다. 게다가 `persistHistoryId`가 fetch 이후라 historyId 미전진 → 매 15분 cron이 같은 깨진 window를 다시 받아 같은 메시지에서 또 죽는다. history_id가 ~7일 후 stale → `fullRescan`(삭제 메시지를 애초 list 안 함)으로 빠질 때까지 자가회복 불가 → poison 메시지 1건당 며칠간 조용히 stall.

**제안**: `getMessage` 호출을 try/catch로 감싸 non-retryable 4xx(특히 404)는 `logger.warn` 후 skip+루프 계속 → historyId 정상 전진. `full-rescan.ts:56`도 동일 패치. (retryable은 `getMessage` 내부 `fetchWithRetry`가 이미 처리하므로 catch에서 재throw 금지.)

---

#### first-sync/stale-rescan 후 24h~7d 메일이 영원히 분류 누락 — 7일 digest 윈도우와 어긋남
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/features/gmail-sync/lib/full-rescan.ts:40` · `apps/dashboard/src/features/gmail-sync/api/syncInbox.ts:237,82-83` · `apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts:71-76` · `apps/dashboard/src/entities/email/api/classifyThread.ts:100-120`

**상세**: `fullRescan`은 `newer_than:7d`로 7일치를 `emailThreads`에 upsert하지만, 직후 `classifyAffectedThreads`는 `since=24h`로만 루프를 돈다. `classifyThread`는 결과를 `replyNeeded`에 INSERT하는 저장형(read-time 계산 아님)이라 24h~7d 구간 스레드는 `reply_needed`/`important` row가 영영 안 생긴다. `syncInbox:82-83` 주석은 '다음 cron 사이클에서 자연 채워짐'이라 주장하나, 이 스레드들은 `lastReceivedAt`이 24h보다 과거라 이후 incremental의 24h 윈도우에 재진입 못 함(새 메시지가 와야 `lastReceivedAt` 갱신). 결과: morning-digest가 `windowDays`(기본 7)로 `replyNeeded`를 읽어도 1~7일 전 답장필요 메일은 row 자체가 없어 누락 → first-sync 직후 가입자에게 특히 가시적.

**제안**: `classifyAffectedThreads`의 `since`를 맥락별 분기 — first-sync/full-rescan 경로는 7일(또는 `settings.windowDays`), incremental만 24h 유지. 또는 `classifyThreadsLoop` since를 `max(24h, windowDays)`로 통일. `82-83` 주석도 정정.

### important-emails widget

#### 중요 메일 빈 상태가 `windowDays` 설정을 무시하고 '7일' 하드코딩
**심각도 P2 · overstated(P1→P2 정정)**
근거: `apps/dashboard/src/widgets/important-emails/ui/ImportantEmailsEmpty.tsx:5` · `apps/dashboard/src/entities/email-settings/model/types.ts:28` · `apps/dashboard/src/features/email-settings-manage/api/_schema.ts:16`

**상세**: `windowDays`는 1~90 사용자 설정값(기본 7)인데 빈 상태 카피가 '최근 7일간 …'을 리터럴로 박았다. 사용자가 14/30으로 바꾸면 빈 상태가 거짓 정보 표시. 형제 `EmailDigestCard.tsx:42`는 `최근 {settings.windowDays}일`로 올바르게 동적 렌더 — 같은 데이터를 두 위젯이 불일치하게 다룸. 이미 정정된 '오늘의 답장' 라벨과 동일 버그 클래스의 미수정 인스턴스. `ImportantEmailsCard` 헤더(L34-38)는 윈도 기간을 아예 안 보여줌. **정정**: 실제 데이터 쿼리는 올바른 `windowDays`를 쓰고 빈 상태 정적 카피만 거짓 → 데이터 손실/기능 파손 없는 표시 정확성 결함이라 P1 아닌 P2.

**제안**: `ImportantEmailsEmpty`에 `windowDays` prop 주입 후 `최근 {windowDays}일간 …` 동적화. `ImportantEmailsCard`에서 `settings.windowDays` 전달. 일관성을 위해 카드 헤더에도 `최근 N일` span 추가 검토.

### shared / security

#### Gmail accounts 토큰(refresh/access/id) 평문 저장 — pgcrypto 미적용 (문서-현실 불일치)
**심각도 P1 · confirmed**
근거: `apps/dashboard/src/shared/lib/db/schema/auth.ts:39-44` · `apps/dashboard/src/shared/lib/db/pgcrypto.ts:21` · `apps/dashboard/src/features/tiger-consult/lib/playmcp-credentials.ts:57-58` · CLAUDE.md / `shared/config/env.ts:88`

**상세**: NextAuth `@auth/drizzle-adapter`가 Google OAuth refresh/access/id token을 `accounts`에 평문 `text()`로 저장. `encryptToken`/`decryptToken` 헬퍼는 존재하나 tiger-consult(PlayMCP) creds에만 쓰이고 Gmail accounts 토큰에는 미적용(read/write 경로 `auth.ts:36-128`, `refreshAccountTokens.ts:98-106` 어디에도 암복호 없음). CLAUDE.md MCP 정책 섹션이 'accounts 테이블에 존재 (pgcrypto)'로 암호화를 암시 → 위협 모델 문서가 현실과 어긋남. DB dump/백업 유출 시 평문 Gmail refresh token = 메일함 read/modify 권한 즉시 탈취. 다만 vanilla DrizzleAdapter의 NextAuth 표준 동작(adapter 레벨 암호화는 비표준)이라 CRITICAL 아님. `env.ts:88` 주석은 이미 '(가능 시)'로 hedge돼 노골적 거짓은 아님.

**제안**: 택1 — (a) accounts 토큰 컬럼을 adapter custom으로 pgcrypto 암호화(`getValidAccessToken`/`refreshAccountTokens` read/write에 decrypt/encrypt 삽입, PlayMCP 동일 패턴). 또는 (b) 암호화 안 할 거면 CLAUDE.md MCP 정책 섹션·`env.ts:88` 주석을 '평문 저장, DB 접근 통제 의존'으로 정정해 문서-현실 일치. 최소한 (b)는 즉시.

---

## 4. 🆕 추가해야 할 기능 (add)

> 이 섹션은 두 축으로 나뉜다 — **4-A 내부 갭**(결함 탐지 pass에서 나온, 기존 동작에 빠진 관측/배관)과 **4-B 제품 로드맵 capability 후보**(별도 capability-gap pass에서 발굴한 net-new 기능, 인벤토리 대조 + YAGNI 필터 적용).

### 4-A. 내부 갭

#### Classification

#### 이메일 LLM 분류·초안 호출이 usage(토큰)를 전량 폐기 — 스펙의 일 비용 기준 검증 불가
**심각도 P2 · overstated(P1→P2 정정)**
근거: `apps/dashboard/src/shared/lib/llm/classify-important.ts:78` · `classify-thread.ts:68` · `draft-reply.ts:118`

**상세**: 스펙 §6.4가 'Haiku 호출당 ~$0.0005, 일 LLM 비용 ~$0.05', 성공 기준 §539 '일 LLM 비용 < $0.10'을 명시. 그런데 세 분류기 모두 `analyzeStructured` 반환의 `usage`(→토큰)를 버리고 `object`만 받는다. 이메일 도메인 전체 grep 결과 `inputTokens`/`normalizeUsage`/`logSpend`/`.usage` 0건 — 관측 전무. saju 도메인은 PR #148대로 `logSajuSpend`+`assertSajuBudgetOk`로 추적·가드하는데 이메일은 동등 관측 없음. 운영에서 실제 일일 토큰/비용을 알 방법이 없어 스펙 자신의 성공 기준 검증 불가, 프롬프트 변경·재분류 폭주로 비용이 튀어도 무징후. (Haiku 단일 고정은 의도적 결정이라 불변 — 누락은 그 결정의 '비용 관측'.) **정정**: 정상 동작·사용자 피해 없는 관측 부재라 P1 아닌 P2.

**제안**: saju 패턴 미러 — 세 분류기에서 `usage`를 받아 `logger.info('email-llm','spend',{model,scope,inputTokens,outputTokens,threadId})` 호출당 1줄 emit. 예산 강제(assert)는 YAGNI — 우선 `docker logs | jq`로 일 합산 가능한 관측만. `classifyThreadsLoop` 집계에 토큰 합을 올리면 cron envelope에서 사이클당 비용도 보임.

---

### 4-B. 제품 로드맵 capability 후보

### 🆕 추가 capability 후보 (제품 로드맵)

여기 모은 건 **결함 수정이 아니라 "현재 위젯에 없는 새 기능"** 후보다. 인벤토리에 이미 있는 것(톤 3종·길이 3종 답장, 발송, Gmail 초안 저장, 읽음/보관/무시/답장완료, 답장 언어·모델 선택, 메일링리스트 자동 컷, web-push, 아침 다이제스트, AI 거절 감지)은 게이트에서 전부 걸러냈다.

개인 단일 사용자 대시보드의 **YAGNI 원칙**을 존중해 처방(prescribe)이 아니라 진열(surface)한다 — 가치 판단은 사용자가 한다. 후보 22개 중 중복 3쌍을 병합해 **19개**로 정리했다.

> **병합 메모(추적용)**
> - **캘린더 추출** — triage 렌즈("M/high, 두 도메인 연결만")와 discovery 렌즈("L/medium, write 인프라 미구현")가 충돌. discovery 쪽 갭 분석이 정확하다(`mcp-calendar`는 읽기 전용 `get-upcoming-events`만 있고 `event-create` 도구 없음). **병합 결과 = L / medium**, 장밋빛 평가 폐기.
> - **처리 내역 히스토리 뷰** — 두 렌즈가 동일 기능 제출. 1개로 병합(M/medium).
> - **규칙 레이어** — `발신자 override`(high)를 1차로, `읽음→보관 자동화 엔진`(speculative)을 그 위 확장으로 분리 유지.

---

#### 우선순위 후보 테이블

정렬: fit(high → medium → speculative), 동률이면 effort(S → M → L).

| fit | effort | 기능 | 한 줄 가치 |
|---|---|---|---|
| **high** | S | 다중 선택 + 일괄 액션 | 쌓인 알림 N개를 한 번의 '모두 보관'으로 — 가장 잦은 반복 동작 |
| **high** | S | 키보드 트리아지 단축키 | j/k 훑고 e/!로 즉시 분류, 마우스 왕복 0 |
| **high** | S | Inbox-zero '모두 처리됨' 상태 | 트리아지 종결감 — '안 봤음' vs '다 처리함' 구분 |
| **high** | S | 분류 근거(rationale) 표시 | 중요 메일이 왜 잡혔는지 — **DB에 이미 있고 렌더만 안 함** |
| **high** | M | 스누즈 + 복귀 | '주말에 다시' 미뤘다가 그 시각 자동 복귀 |
| **high** | M | 발신자/카테고리 규칙 override | '이 발신자는 영구히 이렇게' — 일회성 무시 반복 종결 |
| medium | S | 답장 서명 자동 첨부 | '— 곤 드림'을 매번 안 쳐도 됨 |
| medium | S | 답장 원문 인용(quote) 포함 | 묵힌 스레드 답장도 수신자가 맥락 파악 |
| medium | S | 메일 핀/별표 | 진행 중인 건 상단 고정 |
| medium | M | 처리 내역 / 히스토리 뷰 | '지난주에 답장한 그 메일' 되짚기 + 복구 |
| medium | M | 첨부/링크 추출 뷰 | 본문 안 열고 '뭐 들었나' 확인 |
| medium | L | 캘린더 일정 추출 | schedule 메일 → 캘린더 이벤트(데드엔드 해소) |
| medium | L | 답장 대기 follow-up 리마인더 | 내가 보낸 메일에 회신 없으면 재부상 |
| speculative | S | 발송 취소 유예(undo-send) | 잘못 발송 회수 — 단 confirm 다이얼로그와 중첩 |
| speculative | M | 스레드 전체 대화 인라인 뷰 | 답장 전 전체 맥락(읽기 보조) |
| speculative | M | 스와이프 트리아지(모바일) | 폰 한 손 정리 — 데스크톱 중심이라 우선순위 낮음 |
| speculative | M | 읽음→보관 자동화 규칙 엔진 | 발신자 조건 영구 자동 처리(over-engineering 위험) |
| speculative | M | 예약 발송(send-later) | Gmail이 네이티브로 제공 |
| speculative | M | 위젯 내 검색/필터 | Gmail 검색이 이미 강력 |
| speculative | L | 멀티 계정 트리아지 | 단일 계정 전제, 인증 모델까지 손대야 함 |

---

#### 카테고리별 상세

##### 트리아지 워크플로 — 받은 메일을 빠르게 처리

**다중 선택 + 일괄 액션** (high · S)
체크박스/shift-범위 선택으로 여러 카드를 골라 '모두 보관/읽음/무시'를 한 번에. Gmail의 select-all → bulk action. 기존 `markAsRead/archiveThread/dismissThread/markAsReplied`를 다중 대상으로 감싸기만 하면 됨(신규 스키마 불필요).
*시나리오*: 주말 지나 쌓인 notice 알림 12개를 한 번의 '모두 보관'으로 정리. 지금은 12번 클릭.
*갭*: `email-digest`/`important-emails` 위젯·`features/email-analysis`에 `selectedIds` 상태·checkbox UI 없음. 모든 액션이 행 단위 단일 대상.

**키보드 트리아지 단축키** (high · S)
j/k 이동, e=보관, r=답장, !=무시, u=읽음. Superhuman/Gmail 모델. 카드 리스트에 포커스 커서 + `onKeyDown`으로 기존 액션 매핑.
*시나리오*: 아침 다이제스트를 j/k로 훑으며 e/!로 10초 안에 리스트 비우기.
*갭*: keydown 핸들러는 `ReplyModal.tsx`의 ESC 닫기 하나뿐. 리스트 레벨 포커스/단축키 없음.

**Inbox-zero '모두 처리됨' 상태** (high · S)
윈도가 비면 일반 empty가 아니라 '오늘 답장할 메일 없음 — 다 처리했어요' 완료 상태(checkmark/시각적 보상)를 명시.
*시나리오*: 0 상태를 명확히 보여 매일 처리 루프에 종결감.
*갭*: `EmailDigestEmpty`/`ImportantEmailsEmpty`는 '데이터 없음' 톤의 일반 empty-state. '처리 완료' 의미의 별도 상태 없음.

**스누즈 + 복귀** (high · M)
'오늘 저녁/내일 아침/다음 주/특정 날짜'로 스누즈하면 위젯에서 사라졌다가 그 시각에 최상단 복귀. Superhuman/Hey/Spark의 핵심 트리아지 동작.
*시나리오*: 월요일 청구서 메일을 '주말 결제 때'로 스누즈 → 주말 자동 복귀. 지금은 '무시'밖에 없어 노이즈/망각 둘 중 하나.
*갭*: `schema/email.ts`에 `snoozedAt`/`remindAt` 없음. `dismissThread`는 고정 24시간 자동 숨김(사용자 지정 복귀 시점 아님). cron 복귀 트리거 없음.

**메일 핀/별표** (medium · S)
분류·답장과 독립된 사용자 수동 우선순위 마커. Gmail 별표/Hey의 'keep'.
*시나리오*: 진행 중인 건 메일을 답장 전까지 상단 고정. 다만 severity/importance 자동 분류가 이미 우선순위를 줘서 단일 사용자 환경에선 가치 제한적.
*갭*: schema에 `pinned`/`starred`/`flag` 없음.

**처리 내역 / 히스토리 뷰** (medium · M) *(2렌즈 병합)*
`repliedAt`/`dismissedAt`/`archivedAt`로 사라진 메일을 모아 보는 '처리함' 리스트 + 되돌리기 진입점. Superhuman의 'Done', Hey의 'Previously seen'.
*시나리오*: '지난주에 답장한 그 메일 뭐였지' 확인, 실수로 무시한 메일 복구. `unmarkReplied` 액션은 있으나 진입점이 없음.
*갭*: 타임스탬프 컬럼은 영속되지만 조회 라우트/뷰 없음. `getReplyNeeded`/`getImportantEmails`는 모두 open(미처리)만 WHERE 필터. `app/`에 email history/archive 디렉토리 없음.

**답장 대기 follow-up 리마인더** (medium · L)
내가 보낸 메일에 N일간 회신 없으면 '아직 답 없음'으로 재부상. Superhuman/Hey의 follow-up.
*시나리오*: 거래처에 보낸 문의 3일째 무응답 시 자동 재부상. 단 현재는 수신 메일만 ingest — 발신 추적 파이프라인을 새로 만들어야 함.
*갭*: schema에 `followup`/`remindAt` 없음. `sendReply`가 발송은 하지만 회신 여부 추적 흐름 없음(received-only).

**스레드 전체 대화 인라인 뷰** (speculative · M)
카드에서 스레드 전 메시지를 시간순 펼침. 현재는 inbound 1개만 토글.
*평가*: 읽기 보조이고 Gmail 새 탭에서 한 번에 보여 트리아지 가속 효과는 약함.
*갭*: `ReplyModalBody` 원본 토글은 단일 inbound만. 스레드 전체 fetch 흐름 없음.

**스와이프 트리아지(모바일)** (speculative · M)
좌/우 스와이프로 보관/스누즈. Spark/Gmail 모바일.
*평가*: 데스크톱 중심 + 단일 사용자라 키보드 트리아지로 대부분 커버.
*갭*: swipe 핸들러 없음. 클릭 버튼만.

**읽음→보관 자동화 규칙 엔진** (speculative · M)
'이 발신자는 항상 자동 보관' 같은 사용자 규칙. Gmail 필터.
*평가*: 단일 사용자가 직접 처리하면 되는 환경에서 규칙 엔진은 과한 일반화. 아래 '발신자 override'의 자동-액션 확장 성격.
*갭*: 발신자/라벨 규칙 UI·저장 스키마 없음. `unsubscribe-filter`는 헤더 기반 자동 컷(사용자 커스텀과 별개).

##### 정보 발견 — 메일에서 무엇을 알아내나

**분류 근거(rationale) 표시** (high · S) ⭐ 거의 공짜
각 중요 메일 행에서 '왜 money/security/high로 분류됐는지' 근거를 펼침. Gmail의 'Why is this message important?'와 동일.
*시나리오*: 오분류를 봤을 때 근거 확인 → 곧바로 발신자 규칙 결정으로 연결. 답장 트랙은 `ReplyBadges`로 reason을 노출하는데 중요 트랙은 summary만 보임.
*갭*: `important_emails.rationale` 컬럼은 `classifyImportant.ts`가 **이미 채우고 있으나** `widgets/important-emails/ui` 어떤 컴포넌트도 읽지 않음(렌더 0건). `ImportantEmailRow`는 category/summary/시각/링크만 표시.

**발신자/카테고리 규칙 override** (high · M)
분류 결과 위에 결정적 user-rule 레이어: '이 발신자는 항상 중요', '이 도메인은 영구 제외', '이 카테고리는 안 봄'. Hey의 'Screener', Gmail 필터, Superhuman Auto-labels.
*시나리오*: 분류기가 같은 뉴스레터를 매번 올리거나 거래처를 놓칠 때, 일회성 무시(24시간) 반복 대신 '영구히 이렇게' 한 번. 단일 사용자라 규칙 수가 적어 관리 가벼움.
*갭*: `email_settings`에 발신자/도메인 규칙 컬럼·테이블 없음. `features/email-analysis/api` 액션 4종은 전부 단일 스레드 일회성 hide. categories 필터는 4종 on/off뿐.

**첨부/링크 추출 뷰** (medium · M)
본문을 열지 않고 첨부 목록·핵심 링크를 카드에서 확인. '첨부 있음' 인디케이터 + 인라인 미리보기.
*평가*: 청구서 PDF·계약서가 핵심인 메일에 유용하나, 결국 Gmail 열어 다운로드하는 경로가 짧아 한계 효용 불확실.
*갭*: `email_threads`에 attachment/link 컬럼 없음. payload는 본문 텍스트 추출용으로만 쓰이고 parts/attachment 파싱 0건. `hasAttachment` 인디케이터 없음.

**위젯 내 검색/필터** (speculative · M)
발신자·키워드 자유 텍스트 검색. 현재는 windowDays 윈도 + severity/category 임계값만.
*평가*: Gmail 자체 검색이 강력하고 important 행에 Gmail 딥링크가 있어 한계 효용 낮음(YAGNI). 진열만.
*갭*: 위젯에 search/query input 0건.

**멀티 계정 트리아지** (speculative · L)
여러 Gmail을 한 대시보드에서 통합. Superhuman/Spark의 통합 인박스.
*평가*: 현재 단일 사용자(krdn.net@gmail.com) 단일 계정 전제라 실수요 미확인. NextAuth account가 단일 Google 연결 가정 → 인증 모델까지 손대야 함.
*갭*: 동기화·분류·위젯 전부 단일 userId·단일 계정 기준. 다계정 fan-in 흐름 없음.

##### 메일 → 액션 전환 (연동)

**캘린더 일정 추출** (medium · L) *(2렌즈 병합, effort 재조정)*
schedule 메일에서 날짜/시간/장소를 추출해 캘린더 이벤트 생성. Gmail의 'Events from Gmail'.
*시나리오*: '다음 주 화요일 3시 미팅' 메일 → 버튼 하나로 캘린더 등록 후 보관. 대시보드에 calendar 위젯이 같은 화면에 있어 triage의 마지막 액션(기록)이 닫힘.
*갭(정정)*: ~~"mcp-calendar가 있어 연결만 하면 됨"은 틀림.~~ `mcp-calendar`는 **읽기 전용 `get-upcoming-events`만 있고 `event-create` 도구가 없음** — 캘린더 write 인프라 자체가 미구현이라 추출 + 생성 + write 도구 양쪽 신설 필요. 그래서 **L effort**.

##### 발송·작성

**답장 서명 자동 첨부** (medium · S)
설정에 서명 블록 1개 저장 → 답장 초안 끝에 자동 append. 서명은 결정적 텍스트라 LLM 재생성 불필요.
*시나리오*: 이 대시보드는 실제 Gmail 발송까지 한다(`sendReply`). 그런데 생성된 답장은 서명 없이 나가 '— 곤 드림'을 매번 textarea에 타이핑. 톤 3종 × 길이 3종 어느 조합으로 재생성해도 서명이 날아감.
*갭*: `EmailSettingsForm` 필드 목록에 signature 없음. `generateReplyDraft`/`sendReply`/`saveReplyDraft` 어디에도 append 로직 없음.

**답장 원문 인용(quote) 포함** (medium · S)
본문 아래 '> 2026-06-18 홍길동 wrote:' 인용 블록을 붙여 발송. 모든 메일 클라이언트 기본 동작. 헤더(In-Reply-To/References)는 스레딩용, 인용 본문은 사람이 읽는 맥락용으로 별개.
*시나리오*: 며칠 묵힌 스레드에 답장하면 수신자는 인용 없는 답장만 받아 맥락 끊김. `generateReplyDraft`가 이미 inbound 본문을 fetch하므로 `>` prefix로 본문 끝에 붙이는 옵션만 추가.
*갭*: `sendReply`/`saveReplyDraft`가 넘기는 body는 `editedBody` 단일. fetch한 원문은 LLM 프롬프트에만 쓰이고 발송 본문에 재사용 안 됨.

**발송 취소 유예(undo-send)** (speculative · S)
발송 후 N초 '실행 취소' 노출. Gmail은 confirm 대신 이걸 씀.
*평가*: dogfood 환경(dev가 운영 DB 봄)에서 오발송 위험을 줄이나, **이미 `SendConfirmDialog` 2단계 확인이 같은 실수를 막고 있어 기능 중첩**. 보통 둘 중 하나만 쓴다.
*갭*: `sendReply`가 createDraft 직후 무지연 sendDraft. 단 confirm 다이얼로그가 이미 가드.

**예약 발송(send-later)** (speculative · M)
지정 시각에 발송. Gmail Schedule send.
*평가*: cron + digestHourKst 인프라가 이미 있어 '밤에 써두고 업무시간 발송' 시나리오는 자연스럽지만, **Gmail이 네이티브 제공**(이미 초안 저장 경로 존재)이라 중복. 예약 큐 테이블 + cron 라우트로 effort도 작지 않음.
*갭*: `sendReply`는 동기 즉시 실행. 예약 큐·도래 발송 cron 없음. `digestHourKst`는 다이제스트용이지 발송 예약과 무관.

---

#### 합성가 의견

**지금 해도 좋을 4개 (high-fit · S effort) — 추천:**

1. **분류 근거 rationale 표시** — `important_emails.rationale`이 **이미 DB에 채워지고 있고 렌더만 빠진** 상태다. 신규 스키마·LLM 호출 0, 컴포넌트에 표시 한 줄. '부분 구현 위에 얹기'의 가장 깨끗한 예시 — 가성비 최고.
2. **다중 선택 + 일괄 액션** — 기존 4개 액션을 다중 대상으로 감싸기만. 트리아지에서 가장 잦은 반복 동작을 직접 해소.
3. **키보드 트리아지 단축키** — 매일 반복하는 처리 루프의 속도를 결정. 리스트 포커스 커서 + 기존 액션 매핑.
4. **Inbox-zero 완료 상태** — empty-state 카피·아이콘 교체 수준. 종결감이라는 정서적 페이오프를 거의 무비용으로.

이 4개는 모두 **이미 있는 인프라(액션 4종, rationale 컬럼, empty-state 컴포넌트) 위에 얹는 것**이라 자연스럽다.

**그다음 줄(high-fit · M):** **스누즈**와 **발신자 override**는 신규 스키마 컬럼/테이블이 필요해 S 그룹보다 한 단계 무겁지만 트리아지 가치가 명확하다. override는 '일회성 무시 반복'을 끝내고, 스누즈는 '무시 아니면 망각' 이분법을 깬다. S 4개를 먼저 깐 뒤 이 둘로 진행하면 좋다.

**작성 보강(medium · S) 2개:** **서명**과 **원문 인용**은 "이미 발송까지 하는데 마무리만 빠진" 갭이다. 발송 직전 append/prefix 한 줄 수준이라 비용 대비 완성도 체감이 큼 — 답장 트랙을 실사용한다면 우선 고려.

**당장은 YAGNI, 트리거 생기면:**
- **캘린더 추출(L)** — 캘린더 write 인프라(`event-create` 도구) 신설이 전제. 캘린더 도메인을 먼저 쓰기 가능하게 만든 뒤가 자연스럽다. 그 전엔 보류.
- **멀티 계정(L)** — 업무/개인 계정 분리 실수요가 생기면. 그 전엔 인증 모델 손대는 비용이 정당화 안 됨.
- **follow-up 리마인더(L)** — 발신 추적 파이프라인 신설이 전제. received-only ingest를 깨는 큰 변경.
- **undo-send / 예약 발송 / 위젯 검색** — 각각 confirm 다이얼로그·Gmail 네이티브·Gmail 검색과 중첩. 기존 경로의 마찰이 실제로 느껴질 때만.
- **스와이프 / 핀 / 스레드 전체 뷰 / 자동화 엔진** — 단일 사용자 환경에서 자동 분류가 이미 커버하거나(핀·엔진), 데스크톱 중심이라(스와이프), 읽기 보조라(스레드 뷰) 한계 효용이 낮다.

---

## 5. 🩹 보완해야 할 기능 (improve)

### Reply flow

#### `isRefusalDraft` 게이트가 client 전용 — 서버 send/save 경로에 재검증 없음
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/shared/lib/llm/draft-reply.ts:55-58` · `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx:204` · `apps/dashboard/src/features/email-reply/api/sendReply.ts:50-58` · `saveReplyDraft.ts:53-63`

**상세**: CLI 정체성 거절('I'm Claude Code' 등) 안전망 `isRefusalDraft`는 `ReplyModalBody`의 `blocked` 상태로 버튼을 비활성화하는 client에서만 작동. 서버 액션은 `editedBody`를 refusal 재검사 없이 Gmail 초안으로 만든다. Server Action은 임의 RPC로 직접 호출 가능(소유권은 검증, 본문 내용은 미검증)이라 client 게이트 우회 시 거절 텍스트가 그대로 발송될 수 있다. 본문이 사용자 편집 가능이라 위험은 제한적이나 방어가 한 겹뿐 — defense-in-depth 개선.

**제안**: `sendReply`/`saveReplyDraft`에서 `createDraft` 직전 `isRefusalDraft(editedBody)`이면 새 유니온 kind('refusal-blocked' 또는 기존 send/save-failed 재사용)로 조기 반환.

---

#### 답장 To/CC/BCC 이메일 형식 검증 부재 — Zod 경계 없이 Gmail API로 직행
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/features/email-reply/api/saveReplyDraft.ts:53-63` · `ReplyModalBody.tsx:130` · `apps/dashboard/src/shared/api/gmail/drafts.ts:38`

**상세**: 사용자가 받는사람/CC/BCC를 자유 텍스트로 편집 → Server Action이 형식 검증 없이 Gmail API로 전달. CRLF 헤더 인젝션은 `sanitizeHeader`가 완전 차단하므로 보안 구멍은 아님. 약한 지점: 이메일 형식(@·쉼표 다중 주소) 검증이 시스템 경계에 없어 오타/빈 토큰이 Gmail API 400으로만 늦게 드러나고 사용자에겐 generic 'send-failed' 표시. 글로벌 coding-style '시스템 경계 입력 검증' 미준수 + UX 저하. (toEmail 변경 가능 자체는 본인 Gmail compose라 authz 문제 아님.)

**제안**: `sendReply`/`saveReplyDraft` 진입부에 Zod(`toEmail=z.string().email()`, cc/bcc=쉼표분할 후 각 항목 email, 빈 값 허용)로 meta 검증. 실패 시 새 kind('invalid-recipient')로 모달이 잘못된 필드 표시. 클라이언트 발송 버튼 disable 조건에도 toEmail 형식 추가하면 즉시 피드백.

---

#### 두 모달 포커스 트랩·포커스 복원 부재 + SendConfirmDialog 키보드 접근성 미흡 (WCAG) (#11≈#18 병합)
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/widgets/email-digest/ui/ReplyModal.tsx:18-25,36` · `apps/dashboard/src/widgets/email-digest/ui/SendConfirmDialog.tsx:16-32`

**상세**: `ReplyModal`은 role=dialog/aria-modal/초기 focus/Escape까지 갖췄으나 — (1) focus trap이 없어 Tab으로 배경 카드/버튼까지 포커스가 새어나가고, (2) 닫힐 때 트리거('답장하기' 버튼)로 포커스 복원 안 됨 → 키보드/SR 사용자가 컨텍스트 상실. `SendConfirmDialog`는 더 약함: ESC 핸들러 없음, 초기 focus 없음, focus trap 없음, `z-[60]`로 `ReplyModal` 위에 두 번째 aria-modal을 중첩하는데 배경 모달에 `inert`/`aria-hidden` 미적용. 코드베이스 전체에 focus-trap 훅/`inert` 사용 없음(aria-modal 사용처는 이 두 파일뿐). WCAG 2.4.3(Focus Order)/2.1.2 미충족. 마우스·ESC 사용자는 정상 동작하므로 개인 단일 사용자 대시보드 기준 폴리시 등급.

**제안**: 공통 `useFocusTrap` 훅(첫 포커서블 focus + Tab 순환 + 마운트 전 `activeElement` 저장 후 언마운트 시 복원) 도입해 두 모달에 적용. `SendConfirmDialog`에 `Escape→onCancel` 핸들러 + 열릴 때 취소 버튼 초기 focus.

---

#### 톤 탭 tablist 시맨틱 불완전 (aria-controls·tabpanel·화살표 키 누락)
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/widgets/email-digest/ui/ReplyModalBody.tsx:255-274,277-283`

**상세**: 톤 탭이 role=tablist/tab/aria-selected까지는 갖췄으나 (1) 각 tab에 `aria-controls` 없음, (2) 편집 textarea가 `role=tabpanel`+`aria-labelledby`(활성 탭)로 연결 안 됨, (3) 화살표 키 roving 미구현 → WAI-ARIA tabs 패턴 절반만 충족. SR이 '탭과 패널' 관계를 못 읽고, 키보드 사용자는 Tab으로만 개별 탭 진입.

**제안**: 각 tab에 id+`aria-controls`, textarea에 `role="tabpanel"`+id+`aria-labelledby`(활성 탭 id), tablist에 좌우 화살표 roving tabindex. 길이 selector(L234-250)는 단순 토글이라 현행 `aria-pressed` 유지로 충분.

### Classification

#### reply 트랙 outcome 히스토그램 부재 — important 트랙만 분포 로깅, LLM 강등(fallback) 실시간 무관측
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/entities/email/api/classifyThread.ts:31-36,95,124` · `apps/dashboard/src/features/gmail-sync/lib/classifyThreadsLoop.ts:22-27,140-148`

**상세**: `classifyThread`는 5종 outcome(skipped-deterministic/skipped-llm-no-reply/classified/user-replied/fallback)을 반환하고 fallback일 때 `reason`(LLM 에러: gateway down 등)을 담는다. 그러나 `classifyThreadsLoop`는 classified/fallback/user-replied를 모두 `classified++`로 합쳐(140-148) `fallbackReason`을 버린다. important 트랙은 `impOutcome.kind`별 카운트를 만들어 로깅하는 것과 비대칭. reply LLM 게이트웨이가 통째로 죽으면 모든 스레드가 deterministic으로 조용히 강등되는데 실시간 cron 로그엔 'classified N건'만 찍혀 정상과 구분 불가. (DB `classifier_version`으로 사후 쿼리는 가능 → P2.)

**제안**: `ClassifyLoopResult`에 `replyOutcomes: Record<string,number>` 추가, 루프에서 `outcome.kind`별 카운트. fallback 발생 시 `logger.warn('classifyThreadsLoop','reply-llm-degraded',{threadId,reason})` 1줄. `syncInbox`/`reclassifyRecent`의 기존 `importantOutcomes` 옆에 `replyOutcomes`도 emit — important 트랙과 대칭.

---

#### Eval이 메일링리스트 컷 → important 분류 통합 경로를 검증하지 않음 (위 prefilter 버그에 맹점)
**심각도 P2 · confirmed**
근거: `apps/dashboard/tests/eval/important-mailinglist.eval.test.ts:14-19` · `apps/dashboard/tests/eval/run-llm-eval.ts:91-94,55-60`

**상세**: Layer 1 eval은 `isMailingList`를 fixture의 정상 신호로 격리 테스트하고, Layer 2 eval은 `classifyImportantWithLlm`을 직접 호출하면서 mailing-list fixture를 `continue`로 skip. 두 계층 어디도 '`classifyImportantThread`가 실제로 채워진 signals를 받아 컷이 동작하는가'라는 통합 지점을 안 밟는다 → §3의 reclassify signals-drop(#②)·헤더 누락(#①) 버그가 eval에 완전히 invisible. reply 트랙(`run-llm-eval.ts:55-60`)이 deterministic prefilter를 실제 경유하는 것과 대비되는 important 트랙의 비대칭 공백.

**제안**: important 트랙도 `classifyImportantThread`(혹은 `isMailingList(signals,snippet)` 게이트)를 거치는 통합 케이스 1개 이상 추가, 또는 signals가 빠진 호출 시 컷이 죽는다는 사실을 잡는 단위 테스트(빈 signals → isMailingList=false 회귀).

---

#### 한국어 prefilter 패턴 '드립니다'가 정중한 맺음말 전반을 med 후보로 끌어올려 LLM 호출 증가
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/entities/email/lib/deterministic-classifier.ts:45,34`

**상세**: `MED_PATTERNS`의 `/(부탁|요청|드립니다)/`에서 '드립니다'는 답장 필요와 무관한 정중 맺음말 다수(감사/말씀/안내/보고드립니다)에 매칭 → 대부분의 정중한 한국어 메일이 prefilter를 통과해 Haiku reply LLM으로 직행. prefilter의 '비용 절감' 설계 의도(파일 헤더 정책4)와 직접 충돌. `HIGH_PATTERNS:34`에 이미 `(부탁드립니다|회신 부탁|답변 부탁)`가 있어 MED의 '드립니다' 단독은 정중 맺음말만 추가로 끌어들이는 노이즈. 정확도는 LLM backstop이라 cost가 주 영향.

**제안**: '드립니다' 단독 매칭 제거, 회신 의도가 분명한 결합 패턴(회신/답변/검토 부탁드립니다)으로 좁힘. eval fixture로 한국어 정중 맺음말 비대상 메일의 prefilter null 비율 측정 후 조정.

### gmail-sync

#### `syncNowAction`·`reclassifyAction` catch가 서버 로그 없이 UI로만 에러 반환
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/features/email-settings-manage/api/syncNowAction.ts:26-32` · `reclassifyAction.ts:31-37` · 대조군 `markAsRead.ts:69`·`archiveThread.ts:63`

**상세**: 두 수동 트리거 Server Action 모두 catch에서 `err.message`를 UI로 돌려주지만 `logger` 호출이 없다. '지금 동기화'/'재분류' 버튼 실패 시 클라이언트엔 메시지가 뜨지만 `docker logs`엔 흔적이 안 남아 사후 재현 불가. `markAsRead`/`archiveThread`는 #150으로 같은 류 catch에 `logger.error`를 이미 넣었는데 이 둘만 누락(비대칭).

**제안**: 각 catch에 `logger.error('email/syncNowAction'|'email/reclassifyAction','action-failed',{userId,message})` 추가. 반환 유니온 그대로.

---

#### `listHistorySince`/`listMessages` maxPages(20) 상한 도달 시 미fetch 페이지를 조용히 버리고 head historyId 전진 → silent 데이터 손실
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/shared/api/gmail/history.ts:107,104,109` · `syncInbox.ts:136` · `apps/dashboard/src/shared/api/gmail/messages.ts:80`

**상세**: `history.list` 응답의 `historyId`는 페이지마다 동일한 '메일박스 현재 head'. `listHistorySince`가 20페이지(2000 record) 상한에 `pageToken`이 남은 채 도달하면, 21페이지 이후 `messagesAdded`는 `newMessageRefs`에서 누락되는데도 head를 `newHistoryId`로 반환 → `persistHistoryId`로 저장 → 미fetch 메시지 영영 미sync, 경고·로그 없음. `listMessages`(full-rescan)도 동일. 본인 1명·시간당 수통 규모에선 트리거 미도달이라 위해 미실현 — latent boundary bug.

**제안**: 최소한 `pageToken` 잔존 채 maxPages 도달 시 `logger.warn`으로 절단 기록(opaque silent 회피). 더 견고하게는 상한+잔존이면 head 전진 보류하고 다음 사이클이 같은 `startHistoryId`로 이어받기(또는 마지막 완전 처리 entry.id 저장).

### cron

#### `createCronHandler` per-target 실패가 서버 로그 없이 JSON envelope에만 — cron 측 2000자 절단 body 로그에 의존
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/shared/lib/cron/createCronHandler.ts:166-168` · `apps/cron` `scheduler.js:35-37`

**상세**: `createCronHandler`는 perTarget throw를 `results[].status='error'`+200자 절단 메시지로 격리하지만 서버측 `logger`를 전혀 호출 안 함. envelope는 HTTP 200 반환이라 cron 컨테이너는 `failed>0`이어도 '[cron] poll-gmail OK 200'으로 로깅하고 에러 상세는 body 일부(2000자 절단)에만 담긴다. poll-gmail은 concurrency 5 병렬이라 results 배열이 길면 개별 target 에러가 컷에 잘려 유실 → 한 사용자 sync가 반복 실패해도 jq로 alert 잡을 구조화 라인 없음.

**제안**: catch에서 `logger.warn('cron/'+def.name,'target-failed',{id,label,error})` emit(target별 1줄이라 절단·병렬 무관 jq 집계 가능). envelope 빌드 후 `failed>0`이면 `logger.warn(def.name,'partial-failure',{total,failed})` 요약 1줄.

### widget 일관성

#### 위젯 간 행 카드 UI 불일치 (아바타·호버·로딩/에러 시맨틱)
**심각도 P2 · confirmed**
근거: `ReplyCard.tsx:82,72,49` · `ImportantEmailRow.tsx:67,24-32` · `EmailDigestSkeleton.tsx:7` · `ImportantEmailsSkeleton.tsx:4`

**상세**: 동일 '이메일 행 카드' 패턴인데 두 위젯이 시각·시맨틱이 어긋난다. (1) `ReplyCard`는 `SenderAvatar`로 발신자 식별, `ImportantEmailRow`는 아바타 없음. (2) `ReplyCard` 카드는 `hover:shadow`로 인터랙티브 신호, `ImportantEmailRow`는 카드 자체 정적(호버는 버튼에만). (3) 로딩 스켈레톤 a11y가 `aria-hidden+sr-only` vs `aria-busy`로 다름. (4) 액션 에러도 `ReplyCard`는 generic 단일 문자열, `ImportantEmailRow`는 reason-code 매핑으로 비대칭. 같은 좌측 컬럼에 세로로 붙어 불일치가 눈에 띔.

**제안**: 행 카드의 아바타/호버/스켈레톤 a11y/에러 표현을 한 패턴으로 수렴. `format.ts`를 `shared/lib`로 옮기는 TODOS #8 리팩토링과 묶어 공통 Row/Skeleton 프리미티브로 정리. `ImportantEmailRow`의 reason-code 매핑이 더 풍부하므로 그쪽을 표준으로.

### schema

#### email 스키마의 분류/설정 text 컬럼에 DB 레벨 CHECK/enum 제약 없음 — 무결성이 코드에만 의존
**심각도 P2 · confirmed**
근거: `apps/dashboard/src/shared/lib/db/schema/email.ts:56-57,87-88,65,153-154,132-135` · `apps/dashboard/src/entities/email/model/types.ts:4-7`

**상세**: severity/classifiedBy/category/importance/userAction/reply_language/reply_model/threshold 컬럼이 모두 제약 없는 `text()`이고 허용값은 주석으로만. 애플리케이션 경계(Zod `_schema.ts`, 분류기)에서 검증하므로 정상 경로는 안전. 약한 지점: 마이그레이션·수동 psql·향후 다른 writer가 잘못된 값을 넣어도 DB가 거부 안 함 → 위젯 조회 시 severity 분기(`ReplyCard.tsx:62`)가 unknown 값에 silently fall-through. 같은 코드베이스가 CHECK 패턴을 이미 사용(drizzle/0027 portfolio_holdings_kind_check, 0012 saju school enum CHECK) → email 스키마만 누락은 일관성 갭. 정상 경로는 검증되므로 마지막 방어선(DB) 부재의 polish.

**제안**: drizzle `pgEnum` 또는 raw CHECK 제약을 마이그레이션으로 추가(예: `chk_severity CHECK (severity IN ('high','med','low'))`). 가장 분기에 쓰이는 severity/category/importance/userAction부터. 코드 유니온(`types.ts:4-7`)과 1:1 동기화.

---

## 6. 기각된 발견 (참고)

**기각 0건** — 27건 전부 재현 검증 통과. 다만 6건(#4·#5·#9·#13·#20·#23 중 일부)은 overstated로 판정되어 심각도/프레이밍을 하향 정정했고(본문 반영), 무효화된 발견은 없음.

---

## 7. 이미 추적 중 (참고 · 신규 아님)

#### invalid_grant 감지 시 proactive 알림(푸시/메일) 부재 — 사용자가 며칠간 sync 정지를 모름
**심각도 P2 · tracked (신규 결함 아님)**
근거: `errors.ts:4`(주석이 외부 알림 메일·대시보드 배너 약속, D3 정책 서술) · `poll-gmail/route.ts:46-53`(reauthRequired 카운트만 telemetry, 알림 발송 없음) · `env.ts:85`(OPS_NOTIFY_EMAIL declare만, src 소비처 0)

코드-레벨 주장은 모두 재현되나 **신규 미추적 결함이 아니다**. `TODOS.md:36-42`(항목 3 Production OAuth publish)가 이 정확한 코드(`oauth_state='reauth_required'`, 외부 알림 메일, 대시보드 배너)를 'v0.1 D3 결정대로 매주 재로그인 + 외부 알림으로 처리, 코드는 그대로 남겨둠'으로 명시 추적 중. 능동 알림(push/mail)은 OAuth Production publish 결정과 묶여 의도적으로 v0.1 범위 외 deferred. `errors.ts` 주석은 회귀가 아니라 의도된 D3 정책 서술. '대시보드 배너'는 `ImportantEmailRow`/`ReplyModalBody` contextual 노출로 부분 구현돼 '미구현' 단정은 일부 과함. 데이터 손실 아니고(7일 Test-mode refresh 만료가 트리거, routine 재로그인) 개선 성격이라 P2.

---

## 8. 마무리 — 다음 권장 액션

**미검증 발견 0건** (27건 전부 재현 확인). 즉시 행동 권장 순서:

1. **[trivial · 비용 누수 즉시 차단]** §3 classification 클러스터 ①②를 한 PR로 — `getMessage` `metadataHeaders`에 List-Unsubscribe/List-ID/Precedence 3개 추가(`messages.ts:97`, RPC·비용 0) + `reclassifyRecent`에 signalsMap 배선(`reclassifyRecent.ts:88`). 회귀 방지 통합 테스트(§5 #21) 동반. 죽어있던 prefilter가 살아나며 Haiku 일 비용을 곧바로 떨어뜨림.

2. **[trivial · 신뢰성]** §3 gmail-sync 2건 — `getMessage` 루프 try/catch로 404 skip(`syncInbox.ts:175`, `full-rescan.ts:56`)해 poison 메시지 stall 제거 + `classifyAffectedThreads` since를 first-sync 경로에서 7일로 분기(`syncInbox.ts:237`)해 24h~7d 분류 누락 해소. 둘 다 국소 변경, 신규 가입자 체감 큼.

3. **[trivial · UX 안전]** §3 reply flow 발송 신뢰성 — `sendReply`에 `markAsReplied` 연동(#1, 답장 재등장 제거) + `SendConfirmDialog`에 CC/BCC 표시(#16, 비가역 게이트 완성). 둘 다 발송 경험의 명백한 빈틈.

4. **[설계 검토 필요]** Gmail accounts 토큰 평문 저장(#15) — adapter 레벨 pgcrypto 암호화는 NextAuth 비표준 작업이라 별도 설계 판단 필요. 최소 즉시 조치로 CLAUDE.md MCP 정책 섹션·`env.ts:88` 주석을 현실(평문 저장, DB 접근 통제 의존)에 맞게 정정. 더불어 §4 #5(LLM usage 관측 추가)는 saju 패턴이 이미 있어 포팅 난이도 낮으니 비용 가시성 확보 차원에서 함께 검토.