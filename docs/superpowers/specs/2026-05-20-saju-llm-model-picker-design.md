# Saju LLM Model Picker — 설계

**Date**: 2026-05-20
**Scope**: 사주 프로필 페이지 (lifetime + yearly + monthly + daily)
**Status**: Design (pending implementation)
**Related**: `2026-05-19-saju-tri-narrative-richer-v031-design.md` (이 위에 얹는 기능)

## 1. 배경 & 목표

현재 사주 삼국 관점 분석 (lifetime/yearly/monthly/daily 4가지 layer × 4학파) 은 모두 단일 LLM (`env.SAJU_LLM_MODEL = 'claude-opus-4-7'`) 로 생성된다. 사용자는 Claude Code CLI Proxy (`ANTHROPIC_BASE_URL=http://192.168.0.5:8317`) 가 라우팅하는 3가지 백엔드 (Claude / Codex / Gemini) 를 모두 사용할 수 있는 환경을 가지고 있다.

**목표**: 사용자가 사주 프로필 페이지에서 사용할 LLM 모델을 선택하여 동일 사주를 서로 다른 모델로 분석·비교할 수 있게 한다.

**비목표**:
- 모델별 prompt 튜닝 (3종 모두 동일 prompt — 동작 후 실측 데이터로 결정).
- saju-reading (개별 상세 읽기) 의 모델 선택 — 본 spec 범위 외.
- 모델별 비용/속도 모니터링 대시보드 — v2 이후.

## 2. 핵심 결정

| 영역 | 결정 |
|------|------|
| 프록시 라우팅 | 단일 `ANTHROPIC_BASE_URL`, `model` 필드 문자열로 백엔드 분기 |
| 선택 범위 | 페이지 전역 (lifetime + yearly + monthly + daily 4 위젯이 같은 모델) |
| 캐시 정책 | 모델별 독립 캐시. 기존 캐시 키의 `model_id` 컬럼이 자연 분리 키 |
| 상태 저장 | URL search param `?model=claude|codex|gemini` |
| 모델 ID 주입 | env 3쌍 (`SAJU_LLM_MODEL_CLAUDE/CODEX/GEMINI`) → registry → narrative-server |
| 기본 모델 | `claude` (`DEFAULT_SAJU_MODEL_KEY`) |
| UI 형태 | 페이지 헤더 우측에 Tab — 학파 탭과 시각적·위계적으로 분리 |

## 3. 아키텍처

```
[사용자] /saju-profile/[id]?model=codex
    │
    ▼
[page.tsx (RSC)]
  ├─ modelKey = parseSajuModelKey(searchParams.model)
  ├─ modelId = SAJU_MODEL_REGISTRY[modelKey].id
  └─ render:
      <SajuModelPicker selected={modelKey} />
      <SajuTriLifetime  profileId={id} modelId={modelId} />
      <SajuTriYearly    profileId={id} modelId={modelId} targetYear={2026} />
      <SajuTriMonthly   profileId={id} modelId={modelId} targetMonth={...} />
      <SajuTriDaily     profileId={id} modelId={modelId} targetDate={...} />
    │
    ▼
[narrative-server.ts × 4]
  ├─ 캐시 조회: where(model_id = modelId) AND (profile, school, year, frame_hash, prompt_version, alg_version)
  ├─ HIT  → return cached row
  └─ MISS → anthropic.messages.create({ model: modelId, ... })
           → JSON.parse + zod.parse (1회 재시도)
           → INSERT row with model_id
    │
    ▼
[Proxy :8317] modelId 문자열 → Claude / Codex / Gemini 백엔드로 라우팅
```

## 4. 컴포넌트 분배

### 4.1 신규 파일

```
apps/dashboard/src/shared/lib/llm/saju-model-registry.ts
  - SAJU_MODEL_KEYS: ['claude', 'codex', 'gemini'] as const
  - type SajuModelKey = (typeof SAJU_MODEL_KEYS)[number]
  - SAJU_MODEL_REGISTRY: Record<SajuModelKey, {
      id: string         // env에서 주입된 정확한 모델 문자열
      label: string      // UI 표시명: 'Claude Opus 4.7', 'Codex (GPT-5)', 'Gemini 2.5 Pro'
      vendor: string     // 'Anthropic' | 'OpenAI' | 'Google'
      description: string
    }>
  - DEFAULT_SAJU_MODEL_KEY: SajuModelKey = 'claude'
  - parseSajuModelKey(raw: unknown): SajuModelKey  // never throws

apps/dashboard/src/features/saju-model-picker/
  ├── index.ts                    (barrel export)
  ├── ui/SajuModelPicker.tsx     ("use client", router.replace로 URL 갱신)
  └── model/types.ts              (registry 타입 re-export)
```

### 4.2 수정 파일

```
apps/dashboard/src/shared/config/env.ts
  + SAJU_LLM_MODEL_CLAUDE:  z.string().default('claude-opus-4-7')
  + SAJU_LLM_MODEL_CODEX:   z.string().default('gpt-5-codex')
  + SAJU_LLM_MODEL_GEMINI:  z.string().default('gemini-2.5-pro')
  유지: SAJU_LLM_MODEL (saju-reading 등 모델 선택 적용 안 한 곳에서 계속 사용)

apps/dashboard/src/features/saju-{lifetime,yearly,monthly,daily}-tri/api/narrative-server.ts (4개)
  - 함수 시그니처에 modelId: string 인자 추가
  - 내부 `const MODEL_ID = env.SAJU_LLM_MODEL` 제거 → 인자 modelId 사용
  - anthropic.messages.create({ model: modelId, ... })
  - 캐시 INSERT/조회: model_id 컬럼에 modelId 그대로 저장/매칭

apps/dashboard/src/widgets/saju-tri-{lifetime,yearly,monthly,daily}/ui/SajuTri*.tsx (4개)
  - props에 modelId: string 추가
  - getOrBuildXxxNarrative(..., modelId) 호출

apps/dashboard/src/app/saju-profile/[profileId]/page.tsx
  - searchParams: { model?: string } 받기
  - modelKey = parseSajuModelKey(searchParams.model)
  - modelId = SAJU_MODEL_REGISTRY[modelKey].id
  - 페이지 헤더 우측에 <SajuModelPicker selected={modelKey} />
  - 4개 위젯에 modelId prop 전달
```

### 4.3 FSD 경계

| 슬라이스 | 이유 |
|---------|------|
| `saju-model-registry` → `shared/lib/llm` | 4개 narrative-server (features) + picker UI (feature) + 호출 페이지 (app) 모두에서 사용. features → features cross-import 회피 |
| `saju-model-picker` → `features` | 단일 비즈니스 엔티티가 아니라 사용자 의도 (모델 선택). 4개 위젯이 공유하는 횡단 관심사이지만 자체 동작(URL 갱신) 보유 |
| 4 narrative-server | 기존 위치 유지, 시그니처만 변경 |

## 5. UI 디자인

### 5.1 위치 & 형태

- 페이지 헤더 우측 (이름 + 메타 정보 영역 옆)
- 학파 탭(한국/中자평/中맹파/日추명/통합 비교)과 **시각적·위계적 분리**
  - 학파 탭: 카드 내부 (분석 관점 선택, primary navigation)
  - 모델 탭: 페이지 헤더 (분석 엔진 선택, secondary preference)
- Tab 형태 — 학파 탭과 동일한 패턴으로 시각적 일관성, 단 폰트 한 단계 작게 (`text-xs`)

```
─────────────────────────────────────────────────────────────────────
  대시보드 · 사주 프로필

  김석곤 金奭坤
  본인 · 1967-03-29 05:30 · 양력 · 남자
                                        ┌─ 분석 모델 ─────────────┐
                                        │ [Claude] [Codex] [Gemini]│
                                        └─────────────────────────┘
─────────────────────────────────────────────────────────────────────

┌─ 삼국 관점 평생 운세 ────────────────────────────────────────────┐
│ ...                                                              │
│ [한국]  [中자평]  [中맹파]  [日추명]  [통합 비교]   ← 학파 탭     │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 상호작용

- 탭 클릭 → `router.replace('?model=codex', { scroll: false })`
- RSC가 새 `searchParams.model` 로 재렌더 → 4개 위젯이 새 modelId로 호출
- 캐시 hit 시 즉시 렌더, miss 시 lazy fetch (기존 패턴)
- 활성 탭은 학파 탭과 동일한 강조 스타일 (밑줄 + 색상)

### 5.3 v1 범위 제한 (YAGNI)

- 모델별 "이미 분석됨" 인디케이터 dot: v1에서는 **추가하지 않음**. 첫 출시 안정화 후 v2에서 검토.
- 모델별 비용/소요시간 표시: v1 범위 외.

## 6. 데이터 흐름 & 캐시 키

### 6.1 캐시 격리

기존 4개 narrative 테이블 (`saju_lifetime_narrative`, `saju_yearly_narrative`, `saju_monthly_narrative`, `saju_daily_narrative`) 의 캐시 키:

```
(profile_id, school, [target_year | target_month | target_date],
 frame_hash, model_id, prompt_version, algorithm_version)
```

`model_id` 가 이미 키의 일부이므로 모델별 row 자동 분리. **추가 마이그레이션 불필요**.

### 6.2 URL 파싱 정책

`parseSajuModelKey` 는 **never throw**:
- `'claude'` | `'codex'` | `'gemini'` → 그대로 반환
- `undefined` / `null` / 잘못된 문자열 / 기타 타입 → `DEFAULT_SAJU_MODEL_KEY ('claude')` 폴백

URL은 사용자 입력이므로 신뢰하지 않는다.

### 6.3 modelId 전파 불변식

`modelId` 는 URL에서 출발하여 narrative-server까지 **항상 명시 전달**. env 폴백 금지.
이유: 캐시 일관성 — 같은 사용자 의도가 항상 같은 캐시 row를 가리켜야 한다.

## 7. 에러 처리 (4 Layer)

### Layer 1 — URL 파싱

| 입력 | 동작 |
|------|------|
| `?model=invalid_xxx` | `parseSajuModelKey` → `'claude'` 폴백 |
| `?model=` (빈값) | `'claude'` 폴백 |
| `?model` 누락 | `'claude'` (default) |

페이지는 정상 렌더, picker는 `'claude'` 활성 표시.

### Layer 2 — env 누락

env.ts의 `.default(...)` 가 fallback 제공. 실제 throw는 안 남.

### Layer 3 — 프록시 unknown provider

```
'gemini-2.5-pro' 이 프록시에 등록 안 된 경우:
  → 프록시가 502 'unknown provider' 반환
  → SDK가 APIError throw
  → narrative-server 가 catch 없이 그대로 throw
  → 위젯 RSC error boundary (또는 try/catch)
  → 사용자에게 "분석 모델이 응답하지 않습니다 — 다른 모델을 선택하세요" 카드 표시
```

기존 narrative 4 layer는 위젯 단위로 독립 렌더되므로, 한 layer 실패해도 다른 layer는 정상 표시된다.

### Layer 4 — zod 검증 실패

기존 `callXxxLlmAndParseWithRetry` 패턴 유지:
- 1차 실패 시 검증 오류 메시지를 user prompt에 추가하여 1회 재시도
- 2차도 실패하면 ZodError throw → Layer 3과 동일 fallback

**모델별 응답 품질 변동**: Codex/Gemini가 학파별 narrative schema (sections + schoolSpecific 필드 + 분량 1200~1600자) 를 Claude만큼 잘 따르지 못할 가능성. v0.3.1 도입 시 yearly가 이미 회귀를 겪었던 부분과 같은 이슈.

- 1차 대응: 같은 prompt + 재시도 패턴 (Layer 4)
- 모델별 prompt 분기는 **v1 범위 외** — 실측 데이터로 결정

## 8. 미해결 가설 (구현 단계 검증)

| 가설 | 검증 방법 |
|------|-----------|
| 프록시가 `'gpt-5-codex'` 라는 모델 ID로 응답하는가? | Phase 1 완료 후 curl로 직접 호출 — `{"model":"gpt-5-codex","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}` |
| 프록시가 `'gemini-2.5-pro'` 라는 모델 ID로 응답하는가? | 동일 |
| 응답 안 하면? | 사용자에게 실제 ID 확인 → env default 교체 |

이 가설이 깨지면 모델 ID 문자열만 교체. registry 구조는 그대로.

## 9. 테스트 계획

### 9.1 Unit (vitest)

`shared/lib/llm/saju-model-registry.test.ts`:
- `parseSajuModelKey('claude' | 'codex' | 'gemini')` → 동일 키 반환
- `parseSajuModelKey(undefined | null | 'invalid' | {})` → `'claude'` 폴백
- `SAJU_MODEL_REGISTRY` 3 키 모두 존재, 각 `id` 비어있지 않음

### 9.2 Component (vitest + RTL)

`features/saju-model-picker/ui/SajuModelPicker.test.tsx`:
- `selected='claude'` → Claude 탭 활성 클래스 적용
- Codex 탭 클릭 → `router.replace('?model=codex', ...)` 호출 (mocked router)

### 9.3 Integration (운영 DB 가드 우회 필요)

`narrative-server` 캐시 격리:
- 같은 (profile, school, year, frame) 에 `modelId` 만 다른 2번 호출 → INSERT 2 row
- 같은 `modelId` 재호출 → cache hit, INSERT 없음

`TEST_DATABASE_URL` 환경변수 필수 (Gotcha #2). DB 미연결 시 ECONNREFUSED — pure unit만 통과해도 OK.

### 9.4 Manual / Browser 검증

1. `/saju-profile/[id]` 방문 → Claude 탭 활성, 4개 위젯 정상 렌더
2. Codex 탭 클릭 → URL `?model=codex` 갱신, 4개 위젯 lazy fetch (또는 hit)
3. Gemini 탭 클릭 → 동일
4. `?model=invalid` 직접 입력 → Claude로 폴백 (페이지 정상)
5. 브라우저 뒤로가기 → 이전 모델 선택 복원
6. SQL: `SELECT DISTINCT model_id FROM saju_yearly_narrative WHERE profile_id = '<test>'` → 사용한 모델 ID들이 분리 row로 존재 확인

## 10. 배포 순서 (단일 PR + 단계별 커밋)

**전략**: Phase 1~3을 하나의 PR로 묶되, 리뷰/롤백 용이성을 위해 **단계별 커밋 분리**. Phase 4는 PR 머지 후 운영 검증 작업.

### Commit 1 — Foundation

- `env.ts`: `SAJU_LLM_MODEL_CLAUDE / CODEX / GEMINI` 3개 추가
- `shared/lib/llm/saju-model-registry.ts` 신규
- Unit test
- **영향**: 없음 (사용 안 함)
- **검증**: `pnpm typecheck && pnpm lint && pnpm test`

### Commit 2 — narrative-server 인자화

- 4개 narrative-server에 `modelId` 인자 추가
- 호출부 (widget RSC 4개) 에서 기본값 (`SAJU_MODEL_REGISTRY.claude.id`) 전달
- **영향**: 동작 변화 없음 — 모두 Claude 모델로 계속 작동
- **마이그레이션**: 불필요 (캐시 키 `model_id` 이미 존재)

### Commit 3 — UI Picker

- `features/saju-model-picker` 신규
- `saju-profile/[profileId]/page.tsx`: searchParams 파싱 + picker 배치 + prop 전달
- Component test
- **영향**: UI 노출 — 사용자가 모델 선택 가능

### PR 머지 전 통합 검증

- `pnpm typecheck && pnpm lint && pnpm test` 모두 PASS
- 로컬 브라우저 6단계 (§9.4) 통과
- 단, Codex/Gemini 실제 호출은 **운영 환경에서만 가능** (프록시 192.168.0.5:8317 접근) — PR에서는 Claude만 검증

### Phase 4 — Proxy 호환성 검증 (PR 머지 후)

- Codex/Gemini 모델 ID로 실제 호출 → 응답 검증
- 프록시가 unknown provider 반환하면 env default 교체하여 hotfix PR
- schema 검증 실패율 모니터링 (모델별)
- **회귀 시**: env에서 해당 모델 ID 비활성화 (registry에서 제외하는 hotfix)

## 11. 롤백 시나리오

| 상황 | 조치 |
|------|------|
| Codex/Gemini 응답 품질 심각하게 부적합 | `SAJU_MODEL_KEYS = ['claude']` 한 줄 변경 → picker 숨김. registry/env default 코드 보존 |
| 프록시가 특정 모델 ID 거부 | env에서 해당 모델 ID 정정 후 재배포 |
| narrative-server 동작 회귀 | Commit 2 단위 revert (Commit 3은 picker만 사라지고 동작 영향 없음) 또는 PR 전체 revert |

## 12. 명시적 비범위

- saju-reading (상세 읽기) 의 모델 선택
- 모델별 prompt 튜닝
- 모델별 비용/속도 모니터링 대시보드
- 위젯별 다른 모델 선택 (혼합 사용)
- DB 기반 사용자별 모델 선호 저장

## 13. 참고 컨텍스트

- 현재 LLM 호출 구조: `apps/dashboard/src/shared/lib/llm/anthropic.ts` — 단일 SDK 클라이언트가 `ANTHROPIC_BASE_URL` 프록시를 향함
- 캐시 키 구조: `saju_*_narrative` 4개 테이블 모두 `model_id` 컬럼 보유
- 기존 retry 패턴: `callYearlyLlmAndParseWithRetry` (v0.3.1 hotfix #3)
- FSD 경계: `~/.claude/rules/fsd-architecture.md` + ESLint `eslint-plugin-boundaries`
- 운영 DB 가드: `tests/setup.ts` (Gotcha #2)
