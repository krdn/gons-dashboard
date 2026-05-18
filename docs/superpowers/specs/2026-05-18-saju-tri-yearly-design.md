---
title: 사주 삼국 분석 v0.2 — 년운(歲運) + 용신(yongshin) 설계
date: 2026-05-18
status: design
related:
  - docs/superpowers/specs/2026-05-16-saju-tri-nation-analysis-design.md (v0.1)
  - docs/superpowers/plans/2026-05-16-saju-tri-nation-lifetime.md (v0.1 plan)
---

# 사주 삼국 분석 v0.2 — 년운(歲運) + 용신(yongshin) 설계

## 1. 배경 — 왜 v0.2 가 필요한가

v0.1 평생운 출시 후 두 가지 부채가 남았다:

1. **4학파 어댑터에 `TODO(v0.2)` 용신 미구현** — 어댑터의 `chart.yongSin` 가 `null` 이라 LLM narrative 가 용신 추론을 자유롭게 하고 있다. v0.1 spec §10.4 로드맵의 v0.2 정의도 "년운세" 인데, 년운은 용신 강약 변화가 핵심이라 용신 미구현 상태로는 무의미하다.
2. **세운(歲運) 분석 부재** — v0.1 plan 의 `buildYearly{Ko,CnZiping,CnMangpai,Jp}` 시그너처는 `throw new Error("v0.2")` 스텁만 있다. 사용자는 "올해 어떻게 흐르는가" 라는 가장 일상적인 질문에 대한 답이 없는 상태.

v0.2 범위는 이 둘을 묶어 해소한다 — **용신 계산 → 년운 frame → LLM narrative** 의 결정형 파이프라인 완성.

## 2. 범위

### 2.1 In-scope

- 4학파별 용신(yongshin) 계산 1개 알고리즘씩 구현
- 학파별 `YearlyFrame` 결정형 빌더 구현 (`packages/saju/src/adapters/{school}/yearly.ts`)
- 4학파 합성 `TriNationYearly` + crossCheck 검증
- API 라우트 2종 (`/api/saju/yearly/[profileId]`, `.../narrative`)
- LLM narrative 학파별 lazy 호출 + DB 영구 캐시 (v0.1 동일 패턴)
- UI 위젯 `SajuTriYearly` + `/fortune/[profileId]` 통합
- DB 마이그레이션 2 테이블 신규

### 2.2 Out-of-scope (v0.3 이후)

- 월운(月運) / 일운(日運)
- 궁합(宮合) — v0.4
- 학파별 다중 용신 후보 + 점수 표시 — 단일 대표 알고리즘으로 시작
- 과거/미래 임의 연도 분석 — v0.2 는 "현재 세운 1년" 만
- 기존 `generateYearlyReading` (단일 LLM 세운) 폐기 — 사용자 적응 기간 보호 위해 유지

## 3. 기술 설계

### 3.1 학파별 용신 알고리즘 (각 1개씩 대표)

| 학파 | 알고리즘 | 핵심 룰 (요약) | 출력 |
|------|---------|---------------|------|
| KO | 억부 + 조후 혼합 | (1) 신강/신약 판정 (인성·비겁 합 vs 식상·재성·관성 합) → 억부 용신 후보. (2) 월령 조후 보정 (한랭/조열 판정) → 조후 용신 후보. (3) 둘이 일치하면 강용신, 충돌하면 조후 우선. | `{ primary; secondary; gisin[] }` |
| CN자평 | 억부 단일 | 신강/신약 판정 후 보조 오행 도출. 식신생재 / 관인상생 구조 인식. 조후 미반영. | `{ primary; gisin[] }` |
| CN맹파 | 단건업 구전 체계 표 | 일간 + 월지 조합 표(단건업 체계)에서 용신 직접 매핑. 응기 시점 hint 동반. | `{ primary; gisin[]; emergenceHint }` |
| JP | 阿部泰山 12궁 통변성 | 일간 12궁 위치별 통변성 우선순위 (재성→관성→인성→식상→비겁). 길흉 통변성 분리. | `{ favorable: 통변성[]; unfavorable: 통변성[] }` |

용신 계산은 `packages/saju/src/adapters/{school}/yongshin.ts` 에 분리하고 같은 학파의 `lifetime.ts` + `yearly.ts` 에서 재사용한다.

### 3.2 년운 frame 구조

```ts
// packages/saju/src/types/yearly.ts (신규)

import type { Stem, Branch, OhHaeng } from "./common";
import type { Yongshin } from "./yongshin"; // 학파별 union

export interface YearlyFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  targetYear: number; // 2026 (현재 세운 한정)

  // 세군(歲君) — 그 해의 천간지지
  yearGanji: { stem: Stem; branch: Branch };

  // 현재 시점의 대운 + 전환 정보
  currentDaeun: {
    startAge: number;
    endAge: number;
    ganji: { stem: Stem; branch: Branch };
  };
  daeunTransition: {
    willTransitionAt: number; // 전환 나이
    nextGanji: { stem: Stem; branch: Branch };
  } | null; // 올해 안 전환 없으면 null

  // 세군-원국 간 상호작용 (결정형 룰 기반)
  ganjiInteractions: {
    type: "충" | "합" | "형" | "파" | "해";
    subject: { pillar: "year" | "month" | "day" | "hour"; element: Stem | Branch };
    object: Stem | Branch;
  }[];

  // 용신 강약 변화 (yongShin 기반)
  yongShinDelta: {
    reinforced: OhHaeng[];
    weakened: OhHaeng[];
    netVerdict: "favorable" | "unfavorable" | "mixed";
  };

  // 학파 고유 키워드 (KO=조후 변화, CN맹파=응기 분기 등)
  schoolSpecificHints: Record<string, string>;

  // 신살 (대운+세운 결합)
  shensha: { name: string; pillar: string }[];
}

export interface TriNationYearly {
  targetYear: number;
  frames: {
    ko: YearlyFrame;
    cnZiping: YearlyFrame;
    cnMangpai: YearlyFrame;
    jp: YearlyFrame;
  };
  crossCheck: {
    agreement: "high" | "medium" | "low";
    notes: string[]; // "3학파가 火 강화 합의" 등
  };
}
```

### 3.3 빌더 시그너처

```ts
// packages/saju/src/adapters/{school}/yearly.ts

export function buildYearlyKo(args: {
  chart: SajuChart;
  daeun: DaeunTable;
  targetYear: number;
  yongShin: KoYongshin; // 같은 학파 lifetime 결과에서 추출
}): YearlyFrame;

// CN자평, CN맹파, JP 도 동일 패턴
```

```ts
// packages/saju/src/compose/yearly.ts

export function buildTriNationYearly(args: {
  chart: SajuChart;
  daeun: DaeunTable;
  targetYear: number;
  triLifetime: TriNationLifetime; // 4학파 lifetime 한꺼번에
}): TriNationYearly;
```

### 3.4 결정형 / LLM 경계

- **결정형**: 세군 천간지지, 대운 전환점, 세군-원국 간 충합형해파, 용신 오행 강약 변화, 신살.
- **LLM 해석**: 위 결정형 frame 을 입력으로 받아 학파별 narrative 5문단 (성격 흐름, 직업 변화, 관계 흐름, 건강 주의, 대운 전환 의미) 작성.

LLM 호출은 v0.1 `narrative-server.ts` 의 패턴 그대로:

- PR #76 의 "user message 본문에 JSON 스키마 지시" 패턴 재사용 (cli-proxy-api 호환).
- 동일 `extractJsonObject` 추출기, 동일 zod 스키마 (sections 5개 필드는 lifetime 과 동일).

## 4. 데이터 모델 (DB)

### 4.1 마이그레이션

```sql
-- packages/db/migrations/0046_saju_yearly_tri.sql

CREATE TABLE saju_yearly_tri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp','compose')),
  target_year     integer NOT NULL,
  input_hash      text NOT NULL,
  schema_version  integer NOT NULL,
  frame_jsonb     jsonb NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, school, target_year, input_hash, schema_version)
);

CREATE INDEX idx_saju_yearly_tri_lookup ON saju_yearly_tri (profile_id, target_year);

CREATE TABLE saju_yearly_narrative (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko','cn-ziping','cn-mangpai','jp')),
  target_year     integer NOT NULL,
  frame_hash      text NOT NULL,
  model_id        text NOT NULL,
  narrative_text  text NOT NULL,
  sections_jsonb  jsonb NOT NULL,
  citations       text[] NOT NULL DEFAULT '{}',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, school, target_year, frame_hash, model_id)
);

CREATE INDEX idx_saju_yearly_narrative_lookup ON saju_yearly_narrative (profile_id, target_year);
```

### 4.2 CASCADE 규칙

`saju_lifetime_tri` 와 동일하게 `fortune_profiles` 삭제 시 모든 행 정리.
LifetimeFrame 의 `frame_hash` 가 바뀌면 (어댑터 코드 변경 → schema_version bump) 새 캐시 생성. **년운 frame 은 lifetime 의 yongShin 을 입력으로 받으므로 lifetime frame_hash 가 input_hash 의 일부**. lifetime 캐시 무효화 시 년운도 자연스럽게 무효화된다.

## 5. API

### 5.1 라우트

```
GET /api/saju/yearly/[profileId]?year=2026
  → TriNationYearly (4학파 결정형 frame)

GET /api/saju/yearly/[profileId]/narrative?school=ko&year=2026
  → { narrativeText, sections, citations, modelId, generatedAt, fromCache }
```

`year` 쿼리는 v0.2 에서 **현재 KST 연도로 고정** 검증 (다른 연도 입력 시 400 INVALID_YEAR). v0.3 에서 과거/미래 확장 시 가드 완화.

### 5.2 에러 분기 (v0.1 narrative route 패턴 재사용)

| 에러 | HTTP | code |
|------|------|------|
| 미인증 | 401 | Unauthorized |
| 잘못된 학파/연도 | 400 | INVALID_SCHOOL / INVALID_YEAR |
| 프로필 없음 | 404 | PROFILE_NOT_FOUND |
| lifetime 빌드 실패 (v0.2 년운은 lifetime 의존) | 422 | LifetimeBuildError |
| LLM/JSON/zod 실패 | 500 | INTERNAL_ERROR (toUserMessage 매핑) |
| Rate limit (5/min/user, lifetime narrative 와 공유) | 429 | RATE_LIMIT + retryAfterMs |

### 5.3 toUserMessage 매핑 확장

`features/saju-lifetime-tri/lib/errorMessage.ts` 의 EXACT_MAP 에 `INVALID_YEAR → "지원하지 않는 연도입니다."` 추가. 단위 테스트 1 case 추가.

## 6. UI

### 6.1 위젯 위치

```
/fortune/[profileId] page.tsx
├── <SajuDetailHeader />
├── <SajuTriLifetime />              ← v0.1 (변경 없음)
├── <SajuTriYearly />                ← 신규 v0.2
├── <YearlyResultSection />          ← 기존 generateYearlyReading (유지)
├── <DailySection />
├── 사주팔자 / 오행 / 격국 ...
```

### 6.2 컴포넌트 구조 (v0.1 미러)

```
src/widgets/saju-tri-yearly/
├── index.ts
└── ui/SajuTriYearly.tsx                # server component, getOrBuildYearly 호출

src/features/saju-tri-yearly/
├── api/yearly-server.ts                # getOrBuildYearly + getOrBuildYearlyNarrative
├── ui/TriYearlyTabs.tsx                # state lift-up (v0.1 G 패턴)
├── ui/YearlyFrameView.tsx              # presentational (v0.1 G 패턴)
├── ui/YearlyFrameCard.tsx              # 단독 라우트용
├── ui/YearlyCrossCheckBadge.tsx
└── lib/errorMessage.ts                 # 또는 lifetime 의 것 재사용
```

### 6.3 a11y / 디자인 토큰

v0.1 Polish A (`role="tablist/tab/tabpanel"` + 방향키 + `aria-selected`) + Polish B (`--color-surface-2` sub-block) 패턴 100% 재사용.

## 7. 검증

### 7.1 Canonical fixture

`packages/saju/tests/fixtures/canonical-yearly-2026.json` — 본인 사주 (1967-03-29 05:30) 의 2026년 세운 골든 frame. 4학파 모두 포함.

### 7.2 회귀 fixture

`packages/saju/tests/fixtures/yearly-regression-100.json` — 100개 명조 × 2026년 세운 결정형 출력. 어댑터 변경 시 회귀 감지.

### 7.3 검증 명령

- `pnpm test saju/yearly` — 어댑터 단위 + canonical + 회귀
- `pnpm typecheck` / `pnpm lint`
- 운영 narrative API curl 검증 (PR #72~#76 과 동일 절차)

## 8. 마이그레이션 / 롤아웃

### 8.1 단계

1. DB 마이그레이션 (테이블 2개) — `pnpm db:migrate`
2. 코드 머지 (PR 1개 — feat 큼) 또는 phase 별 분할 PR (yongshin → yearly 어댑터 → API → UI 순서)
3. 운영 배포 — docker-deploy-verify 4단계 패턴 (image SHA, GHA run, .next grep, API 응답)
4. 사용자 검증 — 본인 프로필에서 2026년 세운 표시 확인

### 8.2 롤백 가드

- `SajuTriYearly` 위젯이 throw 해도 `SajuTriLifetime` 등 다른 위젯에 영향 없음 (server component error boundary 단위 분리).
- DB 마이그레이션은 신규 테이블만 추가 — 기존 데이터 변경 0.

## 9. 위험 & 완화

| 위험 | 영향 | 완화 |
|------|------|------|
| 학파별 용신 알고리즘이 단일 룰로는 실제 명리학자 판정과 불일치 | 중 | "v0.2 단일 룰" 명시 + LLM narrative 가 보조 해석. v0.3 에서 다중 후보 + 점수. |
| 단건업 맹파 응기 알고리즘이 공식 원전 부족 | 중 | v0.1 과 동일 한계 명시. 결정형은 표 기반 매핑까지만, prose 는 LLM. |
| 세군-원국 충합형해파 계산 복잡도 (이미 v0.1 interactions.ts 있음) | 저 | v0.1 `core/interactions.ts` 재사용 (대운+세군 결합 케이스만 추가). |
| LLM 비용 증가 (학파 4 × 사용자 N × 매년 신규) | 중 | DB 영구 캐시 + 5/min rate limit (lifetime 과 공유). 매년 1월 1일 KST 만 새 호출. |
| 기존 `generateYearlyReading` 과 동시 표시 시 정보 과잉 | 저 | 위젯 분리, 사용자 적응 후 v0.3 에서 통합 여부 결정. |

## 10. 마일스톤

대략적인 작업량 (Task 단위):

| Phase | 내용 | Task 수 |
|-------|------|---------|
| Phase 0 | DB 마이그레이션 + 신규 type 파일 | 2 |
| Phase 1 | 학파별 yongshin 계산 (4 학파) | 4 |
| Phase 2 | 학파별 yearly 어댑터 (4 학파) | 4 |
| Phase 3 | compose/yearly + crossCheck | 1 |
| Phase 4 | API 라우트 2개 + zod 스키마 | 2 |
| Phase 5 | UI 위젯 + 학파별 단독 라우트 (선택) | 3 |
| Phase 6 | 통합 테스트 + canonical + 회귀 | 2 |
| Phase 7 | 빌드/lint/typecheck + 운영 배포 | 1 |
| **합계** | | **약 19 Task** |

## 11. 성공 기준 (Acceptance Criteria)

1. 본인 사주(1967-03-29 05:30) 진입 시 v0.1 평생운 아래에 v0.2 년운 위젯 표시.
2. 4학파 frame 모두 렌더 + crossCheck 배지 표시 (예: "3학파가 火 강화 합의").
3. 학파별 narrative lazy 로딩 + DB 캐시 hit < 50ms.
4. 1967 fixture 의 2026 세운 골든 frame 회귀 검증 PASS.
5. `pnpm typecheck` / `pnpm lint` / `pnpm test` 통과.
6. 학파 4개 어댑터의 `chart.yongSin` 가 더 이상 null 이 아님 (TODO(v0.2) 해소).
7. 운영 배포 후 narrative API 200 응답 확인 (4단계 검증).

## 12. 미해결 질문 (구현 중 결정)

- 단건업 맹파 용신 표의 정확한 출처 — 구전 체계 정리서 어느 본을 표준으로 할지 (v0.2 구현 시 한 본 명시)
- JP 12궁 통변성 우선순위의 阿部泰山 본 vs 박재완 한국식 차이 처리 — JP 어댑터는 일본 본만 사용
- 캐시 무효화 정책: 2026년 1월 1일 KST 부터 2027 frame 자동 생성? → v0.2 는 사용자가 페이지 진입 시 lazy 생성, 자동 prebuild 없음

## 13. 참고 자료

- v0.1 spec: `docs/superpowers/specs/2026-05-16-saju-tri-nation-analysis-design.md`
- v0.1 plan: `docs/superpowers/plans/2026-05-16-saju-tri-nation-lifetime.md`
- 자평진전(子平眞詮) 용신론, 적천수(滴天髓) 억부론, 단건업 응기 체계 정리서, 阿部泰山『四柱推命学全集』12궁 용신
- PR #72~#76 — narrative LLM 응답 안정화 (cli-proxy-api 호환)
