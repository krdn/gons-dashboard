# 답장 언어 선택 설정 — 설계 문서

작성일: 2026-06-16
범위: 이메일 설정에 "답장 언어" 추가 → 답장 초안 생성 시 반영

## 1. 배경 & 목표

답장 초안 생성 기능(2026-06-16 머지)의 `draftReply`는 systemPrompt에 "한국어 답장"이
하드코딩돼 있다. 사용자가 이메일 설정에서 **답장 언어**를 선택해, 생성되는 초안의
언어를 제어할 수 있게 한다.

사용자 결정: 옵션은 **자동 + 한/영/일/중**. `auto`는 **원본 메일 언어에 맞춤**
(한국어 메일엔 한국어, 영어 메일엔 영어 답장).

## 2. 핵심 결정

| 항목 | 결정 |
|---|---|
| 옵션 | `auto`(기본) / `ko` / `en` / `ja` / `zh` |
| auto 의미 | 원본 메일 언어에 맞춤 (현재 "항상 한국어"에서 변경) |
| 저장 | `email_settings.reply_language` 컬럼 |
| 기본값 | `'auto'` — 기존 사용자 동작 불변식 (미설정 = auto) |
| 적용 시점 | generateReplyDraft가 설정을 읽어 draftReply에 전달 |

## 3. 데이터 흐름

```
[설정 폼 select] → updateEmailSettings(Zod 검증) → email_settings.reply_language
                                                          ↓
generateReplyDraft → getEmailSettings().replyLanguage
                   → draftReply({ ...input, language })
                   → systemPrompt 언어 지시 분기
                   → 초안 본문이 선택 언어로
```

## 4. 변경 파일 (흐름 따라 6곳)

| 파일 | 변경 |
|---|---|
| `shared/lib/db/schema/email.ts` | `replyLanguage: text("reply_language").notNull().default("auto")` 컬럼 + drizzle 마이그레이션 |
| `entities/email-settings/model/types.ts` | `ReplyLanguage` union 타입 + `EmailSettings.replyLanguage` + `EMAIL_SETTINGS_DEFAULTS.replyLanguage = "auto"` |
| `entities/email-settings/api/getEmailSettings.ts` | select에 `replyLanguage` 추가 (row → EmailSettings 매핑) |
| `features/email-settings-manage/api/_schema.ts` | Zod에 `replyLanguage: z.enum(["auto","ko","en","ja","zh"])` |
| `features/email-settings-manage/ui/EmailSettingsForm.tsx` | 언어 select 추가 (auto/한국어/English/日本語/中文) |
| `shared/lib/llm/draft-reply.ts` | `DraftReplyInput.language` + systemPrompt 언어 분기 |
| `features/email-reply/api/generateReplyDraft.ts` | getEmailSettings에서 replyLanguage 읽어 draftReply에 전달 |

## 5. LLM 프롬프트 처리 (draft-reply.ts)

`DraftReplyInput`에 `language: ReplyLanguage` 추가. systemPrompt의 언어 지시를 분기:

- `auto` → "원본 메일과 **같은 언어로** 답장을 작성합니다." (한국어 하드코딩 제거)
- `ko` → "답장은 반드시 **한국어**로 작성합니다."
- `en` → "Write the reply in **English**."
- `ja` → "返信は必ず**日本語**で書いてください。"
- `zh` → "回复必须用**中文**书写。"

언어 지시를 헬퍼 함수 `languageInstruction(language)`로 분리(순수, 테스트 용이).
나머지 프롬프트 규칙(톤·광고 거절·구조)은 유지.

## 6. 마이그레이션 안전성

- `ADD COLUMN reply_language text NOT NULL DEFAULT 'auto'` — 기존 row 자동 'auto'.
- 운영 적용: drizzle-kit migrate가 prod tracking 못 읽는 함정(메모리 drizzle-kit-migrate-prod-broken)이 있으므로 **psql 직접 BEGIN/COMMIT ALTER TABLE** 로 적용.

## 7. 테스트

| 대상 | 케이스 |
|---|---|
| `draft-reply.ts` (languageInstruction) | auto→"같은 언어", ko→한국어, en→English, ja/zh 각각 지시 포함 |
| `_schema.ts` | replyLanguage 유효 enum 통과, 잘못된 값 거부 |
| `email-settings/model/types` | 기본값 auto 확인 |

검증: `pnpm typecheck && pnpm lint`. (draft-reply는 기존 LLM mock 테스트 패턴 재사용)

## 8. 비범위

- 답장 톤 선택 (별개 — 이미 자동)
- 메일별 언어 오버라이드 (설정은 전역)
- auto의 언어 감지를 코드로 수행 (LLM에 위임 — "원본과 같은 언어" 지시만)
