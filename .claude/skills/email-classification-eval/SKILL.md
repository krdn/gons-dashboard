---
name: email-classification-eval
description: 이메일 분류기(답장 필요 / 중요) 정확도 평가를 실행·해석할 때 사용. Layer 1(매 PR 자동, 결정적) / Layer 2(on-prem 수동 LLM 호출) 2계층 구조, 임계치 위치, GHA에서 Layer 2 가 못 도는 이유를 설명한다. "eval 돌려줘", "분류 정확도", "precision/recall", "eval:llm" 요청 시.
---

# 이메일 분류 정확도 평가 (eval)

분류기(답장 필요 / 중요) 정확도 회귀를 잡는 2계층 시스템 (`apps/dashboard/tests/eval/`).
설계: `docs/superpowers/specs/2026-06-17-email-classification-eval-design.md`.

- **Layer 1 (매 PR, 자동)**: deterministic recall + severity 스냅샷 + mailing-list 컷 회귀.
  `pnpm test` 에 포함 (별도 명령 불필요). LLM 미호출이라 결정적.
- **Layer 2 (on-prem 수동)**: `pnpm --filter @gons/dashboard eval:llm` — 실제 Haiku 호출로
  precision/recall/F1 측정 + `tests/eval/reports/<date>.json` 리포트.
  **cli-proxy 내부망(`ANTHROPIC_BASE_URL`) 접근 필요**, GHA 에서는 못 돈다. PR 차단 안 함(리포트만).
- 임계치: `tests/eval/thresholds.json` — **확정값이다** (PR #287, `reports/2026-07-09.json` 무오염 run 기준).
  `replyDeterministic.recall` 0.45 / `replyLlm` precision 0.8·recall 0.2 / `importantLlm`
  categoryMacroF1 0.75·importanceAccuracy 0.65.
  ⚠️ `replyLlm` 의 낮은 recall 하한을 정확도 목표로 오해하지 말 것 — reply 트랙은 deterministic
  prefilter 가 키워드 없는 암시적 케이스를 LLM 전에 걸러내 recall 천장이 구조적으로 낮다
  (천장은 Haiku 가 아니라 prefilter). 이 하한선은 prefilter 변동에는 걸리지 않고 LLM 실붕괴만
  잡도록 천장 아래 여유를 둔 값이고, reply 의 정밀 회귀 신호는 Layer 1 deterministic recall 이 맡는다.
  근거 전문은 파일 내 `_comment`.
