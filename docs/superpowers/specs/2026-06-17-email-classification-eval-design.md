# 이메일 분류 정확도 평가 (v0.2 eval) — 설계 문서

작성일: 2026-06-17
브랜치: (구현 시 `feat/email-classification-eval`)
범위: 이메일 분류기(답장 필요 / 중요)의 정확도 회귀 게이트 + on-prem 정확도 측정 하네스

## 1. 배경 & 목표

현재 이메일 분류 정확도를 **자동으로 채점하는 시스템이 없다**. 존재하는 것은:

- mock 기반 단위 테스트 (`tests/deterministic-classifier.test.ts`,
  `tests/llm-classify-important.test.ts` 등) — LLM 응답을 고정값으로 박고 파싱·흐름·멱등성만 검증.
  실제 메일에 대한 정답률은 측정 안 함.
- `package.json`에 eval script 없음, eval CI 워크플로 없음, golden 데이터셋 없음.

코드 주석의 "eval CI v0.2가 이걸 읽음" (`deterministic-classifier.ts:21`),
"eval CI의 ground truth" (`schema/email.ts:64`)는 **실행되는 시스템이 아니라 미래 계획용 인프라**다.
설계 문서 `2026-05-09-important-emails-design.md` §8.6 / §10이 이를 v0.2 백로그로 명시:

> v0.2: GitHub Actions에서 분류기 변경 시 precision/recall 임계치 게이트 (TODOS.md에 추가).

**목표**: 분류기(deterministic 계층 + LLM 계층)를 바꿀 때 정확도 회귀를 잡는 평가 시스템을 구현한다.
1차 목적은 **회귀 게이트** (모델 비교 벤치마크는 범위 밖 — §9).

## 2. 핵심 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 1차 목적 | **회귀 게이트** | 분류기 변경 시 정확도 하락을 PR/리포트로 감지. 모델 비교는 후속(§9) |
| golden 소스 | **수제 픽스처 레포 커밋** | 운영 user_action은 개인정보·FN 측정 불가·중요 트랙 신호 약함. 합성 픽스처가 안전+완전 |
| 실행 계층 | **2계층 분리** | deterministic은 결정적(매 PR) / LLM은 비결정적·내부망(수동·nightly) |
| 메트릭 게이트 위치 | **LLM 계층(Layer 2)** | deterministic precision은 의도된 과포함이라 게이트 시 가짜 실패 (§3.1) |
| deterministic 게이트 | **recall + severity exact-match 스냅샷** | deterministic recall = reply 트랙 recall의 상한 (§3.1) |
| 임계치 | **베이스라인 측정 후 확정** (지금 placeholder) | 정확도 숫자가 없는 상태에서 임의값은 위험 |
| CI 워크플로 | **신규 없음** — 기존 `pnpm test`에 통합 | Layer 1은 vitest. Layer 2는 GHA 접근 불가(내부망) |

## 3. 아키텍처 — 2계층

`classifyThread.ts`(54–76줄): **LLM은 deterministic가 non-null 반환한 스레드에만 호출된다.**
deterministic가 null이면 행 삭제 + LLM 미호출. 따라서 deterministic가 버린 메일은 LLM이 영영 못 본다.
이 구조가 두 계층의 게이트 방식을 결정한다.

```
tests/eval/
├── types.ts                            # fixture·결과 타입 (Zod 스키마 포함)
├── fixtures/
│   ├── reply-needed.json               # 답장 트랙 golden (TP/FP/FN 케이스 균형)
│   └── important.json                  # 중요 트랙 golden (4카테고리 + none/mailing-list)
├── thresholds.json                     # 임계치 (베이스라인 후 확정)
├── scorer.ts                           # confusion matrix → precision/recall/F1 (순수 함수)
├── scorer.test.ts                      # scorer 단위 테스트
├── fixtures.test.ts                    # 모든 fixture가 Zod 스키마 통과
├── reply-deterministic.eval.test.ts    # Layer 1: 매 PR, LLM 없음
├── important-mailinglist.eval.test.ts  # Layer 1: mailing-list 컷 회귀
├── run-llm-eval.ts                     # Layer 2: 수동/nightly, 실제 Haiku → 리포트
└── reports/                            # Layer 2 산출물 (<date>.json, gitignore)
```

| | **Layer 1 (매 PR, GHA)** | **Layer 2 (수동/nightly, on-prem)** |
|---|---|---|
| 대상 | `classifyDeterministic` + `isMailingList` | 전체 파이프라인 (실제 Haiku via cli-proxy) |
| LLM 호출 | 없음 (결정적) | cli-proxy 실제 호출 (`192.168.0.5:8317`) |
| 답장 트랙 게이트 | **recall ≥ 임계치** (needs-reply fixture는 non-null) + severity **exact-match 스냅샷** | precision / recall / F1 ≥ 임계치 |
| 중요 트랙 게이트 | mailing-list 컷 exact-match | category macro-F1 + importance accuracy ≥ 임계치 |
| 실행 방식 | `pnpm test` (vitest) | `pnpm eval:llm` (tsx 스크립트) |
| 실패 시 | **PR 차단** (hard) | **리포트만** (soft — 비결정성 + GHA 내부망 불가) |

### 3.1 왜 deterministic에 precision 게이트를 걸지 않는가

- deterministic의 **precision은 correctness와 무관**. 일부러 과포함해 LLM에 넘기는 설계
  (`deterministic-classifier.ts` 정책 2·3) — junk를 더 넘겨도 LLM이 쳐내므로 비용만 늘 뿐.
  precision/F1 게이트를 걸면 "의도된 과포함"을 회귀로 오판해 가짜 실패를 양산.
- deterministic의 **recall이 reply 트랙 전체 recall의 상한**. 여기서 떨군 건 복구 불가 →
  recall이 유일하게 correctness-critical한 deterministic 지표.
- 주석의 "정확도 ~80% 가정"(`deterministic-classifier.ts:50`) = 이 필터가 이미
  reply-needed의 ~20%를 null로 흘린다는 자백. fixture의 (B) 케이스가 이를 정직하게 노출한다.

## 4. fixture 데이터 구조

각 fixture는 분류기 **입력 + 기대 label**의 JSON 배열. 로드 시 **Zod 검증** (잘못된 fixture 조용한 통과 방지).
초기 규모: 답장 ~25건, 중요 ~25건 (케이스 군 균형).

### 4.1 reply-needed.json

deterministic 입력(`ThreadInput` 형태)과 기대 출력. **3종 케이스를 의도적으로 균형**있게 포함:

```jsonc
[
  // (A) 키워드 명확 + 답장 필요 → deterministic이 잡아야 함 (TP)
  { "id": "r-deadline-ko",
    "input": { "subject": "내일까지 회신 부탁드립니다",
      "snippet": "계약서 검토 후 의견 주세요",
      "lastSenderEmail": "client@acme.com", "ownerEmail": "me@x.com",
      "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "high" } },

  // (B) 키워드 없지만 답장 필요 → deterministic이 놓침 (FN, recall 상한 노출)
  { "id": "r-implicit",
    "input": { "subject": "지난번 그 건",
      "snippet": "한번 봐주실 수 있으실까요",
      "lastSenderEmail": "boss@acme.com", "ownerEmail": "me@x.com",
      "lastSenderIsOwner": false },
    "expect": { "needsReply": true, "severity": "med" } },

  // (C) 키워드 있으나 답장 불필요 (junk) → LLM이 쳐내야 함 (Layer 2 precision)
  { "id": "r-newsletter-q",
    "input": { "subject": "오늘의 질문: 당신은 준비됐나요?",
      "snippet": "구독 해지는 여기서",
      "lastSenderEmail": "news@promo.com", "ownerEmail": "me@x.com",
      "lastSenderIsOwner": false },
    "expect": { "needsReply": false } }
]
```

- (A): deterministic·LLM 모두 잡아야. (B): deterministic은 놓침(정상) — Layer 2에서만 LLM이 잡을 수 있음.
- (C): deterministic은 키워드로 통과시킴(과포함) — Layer 2에서 LLM이 false로 쳐내는지 검증.

### 4.2 important.json

중요 트랙은 deterministic 후보 필터가 없다 (mailing-list 컷 → 바로 LLM).
mailing-list 신호 + 기대 카테고리를 담는다:

```jsonc
[
  { "id": "i-receipt",
    "input": { "subject": "[영수증] 스타벅스 27,500원 결제 완료",
      "fromEmail": "no-reply@starbucks.com", "fromName": "스타벅스",
      "snippet": "결제가 완료되었습니다", "receivedAtKst": "2026-06-17 09:00" },
    "signals": { "hasListUnsubscribe": false, "hasListId": false,
      "precedence": null, "fromHeader": "no-reply@starbucks.com" },
    "expect": { "isMailingList": false, "category": "money", "importance": "med" } },

  { "id": "i-newsletter",                              // mailing-list 컷 (FP 가드)
    "input": { "subject": "이번 주 뉴스레터", "fromEmail": "news@medium.com", ... },
    "signals": { "hasListUnsubscribe": true, "hasListId": true, ... },
    "expect": { "isMailingList": true } },

  { "id": "i-none",                                    // LLM이 none 반환해야
    "input": { "subject": "주말 등산 가실래요?", "fromEmail": "friend@gmail.com", ... },
    "signals": { "hasListUnsubscribe": false, ... },
    "expect": { "isMailingList": false, "category": "none" } }
]
```

## 5. scorer + 메트릭

`scorer.ts`는 **순수 함수** (LLM·DB 의존 없음 → 독립 단위 테스트 가능).

```ts
interface Metrics {
  tp: number; fp: number; fn: number; tn: number;
  precision: number;  // tp / (tp + fp)
  recall: number;     // tp / (tp + fn)
  f1: number;         // 2·p·r / (p + r)
}
```

**답장 트랙** — needs_reply를 양성으로 보는 이진 분류:
- TP: 기대 true + 예측 true / FP: 기대 false + 예측 true / FN: 기대 true + 예측 false
- Layer 1(deterministic): **recall만** 게이트 — needs-reply fixture(A·B)가 non-null인지.
  (B)는 deterministic이 놓치므로 recall < 1.0이 정상 — 정규식 prefilter 상한을 노출.
- severity는 별도 **exact-match 스냅샷** (needsReply=true 케이스만 대상).

**중요 트랙** — 카테고리는 multi-class:
- mailing-list 컷: exact-match (Layer 1)
- category: macro-averaged precision/recall/F1 (none 포함 5-class), importance: exact-match accuracy (Layer 2)

**임계치는 `thresholds.json`에 명시** (코드 하드코딩 금지):

```jsonc
{
  // ⚠️ 모든 값 TBD — 구현 후 on-prem 베이스라인 측정으로 확정 (§7)
  "replyDeterministic": { "recall": null },          // Layer 1 hard
  "replyLlm": { "precision": null, "recall": null }, // Layer 2 soft
  "importantLlm": { "categoryMacroF1": null, "importanceAccuracy": null }
}
```

초기값은 **첫 베이스라인 측정 후 확정**한다 (§7). 베이스라인보다 약간 아래로 임계치를 잡아
정상 변동에 의한 가짜 실패를 피하되 명확한 회귀는 잡는다.

## 6. 실행 / 에러 처리 / 테스트

### 6.1 Layer 1 (매 PR)

`*.eval.test.ts`로 vitest에 통합 → 기존 `pnpm test`에 자연 포함. GHA의 기존 CI가 그대로 실행.
신규 워크플로 불필요 (YAGNI). 이 테스트들은 deterministic 분류기의 회귀 테스트 역할을 겸한다.

### 6.2 Layer 2 (수동/nightly)

`pnpm eval:llm` 스크립트 (`run-llm-eval.ts`, tsx 실행). on-prem에서 실행:
- cli-proxy 호출 → 콘솔 리포트(트랙별 메트릭 표 + 임계치 대비 PASS/WARN) + `reports/<date>.json` 저장.
- **에러 처리**:
  - cli-proxy 미접속 → 명확한 에러("내부망/ANTHROPIC_BASE_URL 필요")로 빠른 실패.
  - 개별 fixture LLM 실패 → skip + 카운트(전체 멈춤 방지), 리포트에 "N건 평가 불가" 명시 (silent 누락 금지).
- **비결정성**: Layer 2는 PR 차단 안 함 → flaky 무관. 임계치 미달 시 WARN만.

### 6.3 테스트 대상

- `scorer.test.ts`: confusion matrix 계산 정확성 (알려진 입력 → 알려진 메트릭, AAA 패턴).
- `fixtures.test.ts`: 모든 fixture가 Zod 스키마 통과.
- `*.eval.test.ts`: deterministic 분류기 회귀 (Layer 1 자체).

## 7. 베이스라인 절차 (구현 단계)

1. fixture + scorer + Layer 2 도구 구현 완료.
2. on-prem(또는 cli-proxy 접근 가능 환경)에서 `pnpm eval:llm` 1회 실행.
3. 산출 메트릭을 `reports/<date>.json`에 기록 → 현재 Haiku precision/recall/F1 베이스라인 확정.
4. 베이스라인보다 약간 아래(예: -0.05)로 `thresholds.json` 값 채움.
5. Layer 1 deterministic recall도 동일 절차로 fixture에서 측정해 임계치 확정.

> 이 단계는 spec 범위 밖(구현 plan에 포함). spec은 placeholder(null)로 커밋한다.

## 8. 보안 / 경계

- fixture는 **합성 데이터만** — 실제 개인 메일·운영 user_action 미사용 (커밋 안전).
- `reports/`는 **gitignore** (메트릭 산출물, 잠재적으로 fixture 내용 echo).
- Layer 2는 env(`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`) 의존 — 시크릿은 .env로만 (평문 커밋 금지).

## 9. 범위 밖 (명시적 비포함)

1. **모델 비교 벤치마크** (Haiku vs Sonnet/Opus) — Layer 2 인프라 재사용해 후속. 같은 fixture에
   모델만 바꿔 돌리면 됨. 이번엔 게이트가 1차 목적이므로 제외.
2. **운영 DB user_action 추출** — 개인정보·FN 측정 불가·중요 트랙 신호 약함.
3. **GHA에서 LLM 호출** — cli-proxy 내부망(192.168.0.5) 접근 불가.
4. **fixture 자동 생성/확장 도구** — 초기엔 수제 ~50건으로 충분 (YAGNI).

## 10. 성공 기준

1. `pnpm test`에 Layer 1 eval 통합 — deterministic 회귀 시 CI 빨강.
2. `pnpm eval:llm`로 on-prem에서 Haiku 정확도 리포트 생성.
3. `thresholds.json`에 베이스라인 기반 임계치 확정.
4. scorer·fixture 단위 테스트 통과, 전체 커버리지 유지.
