# 사주 삼국 분석 — 한국·중국·일본 결합 명조 시스템 설계

**작성일**: 2026-05-16
**상태**: Draft → 사용자 리뷰 대기
**범위**: v0.1 = 평생 운세(Lifetime) 조각, 통합 설계는 6개 운세 유형 전부
**관련 spec**:
- `docs/superpowers/specs/2026-05-13-saju-detail-design.md` (기존 한국식 명조)
- `docs/superpowers/specs/2026-05-15-tiger-playmcp-area-design.md` (PlayMCP — 본 spec 의 비목표, 보존)
- 메모리: `saju-G1-day-pillar-correction` (canonical fixture 근거)

---

## 1. 목적과 배경

### 1.1 동기

기존 `packages/saju` 와 `/fortune` 영역은 한국식 명리(자평+조후+신살)만 다룬다. PlayMCP 1FATE 영역(`/tiger/*`)은 narrative 만 제공하고 4기둥·격국·용신·신살을 응답에 노출하지 않는다. 본 spec 은 **한·중·일 삼국의 명리학 강점을 결정형 알고리즘으로 통합**해, 사용자가 명조 자체를 한 화면에서 다각도로 비교·교차검증할 수 있는 영역을 추가한다.

### 1.2 삼국 분석법 강점 매트릭스

| 운세 유형 | 한국 (조후+신살) | 중국 자평 (격국·용신) | 중국 맹파 (응기) | 일본 (진태양시·통변성) | 삼국 결합 시 v0.x 핵심 가치 |
|----------|------------------|----------------------|------------------|-----------------------|--------------------|
| 평생(命) | △ 신살·조후 풍부 | ◎ 격국·용신·대운 골격 | ○ 사건성 평생 분기점 | ○ 명조 정확도 최상 | **명조 정확(JP) → 골격 해석(CN자평) → 한국식 신살·조후 보완** |
| 년(歲) | ○ 세운 + 조후 변화 | ○ 세군 천간지지 충합 | ◎ 응기 분기 시점 | △ | 응기 분기점(CN맹파) + 충합(CN자평) + 조후 변화(KO) |
| 월(月) | △ | ○ 월건 충합 | ◎ 응기 월령 | △ | 응기 월령(CN맹파) + 월건 충합(CN자평) |
| 일(日) | △ 일진 신살 | △ | △ 일주 응기 | △ 일주 명궁 | 한국식 일진 + 일본식 명궁 결합 — 상대적 약점 |
| 궁합 | ◎ 신살·일지합충 | ○ 격국 호환 | ○ 양인·도화 응기 | △ | 한국식 신살 다층 + 자평 격국 호환 |
| 기타(직업·건강·재물) | ◎ 조후 → 건강 | ◎ 용신 → 직업 | ◎ 응기 → 사건 시점 | △ | 세 학파 결합 가치 가장 큼 |

### 1.3 v0.1 조각: 평생 운세 (Lifetime)

`packages/saju` 를 확장해 4학파(KO·CN자평·CN맹파·JP) 결정형 어댑터를 구현하고, `/fortune/[profileId]` 안에 `<TriNationTabs />` 를 주입한다. 년/월/일/궁합/기타는 인터페이스만 정의하고 구현은 v0.2~v0.x.

### 1.4 검증된 사실 (메모리 기반)

| 항목 | 사실 |
|------|------|
| 본인 사주 (1967-03-29 05:30 부천) | 일주 = 壬辰 (만세력 라이브러리 2종 합의) |
| `lunar-javascript@1.7.7` + `korean-lunar-calendar@0.3.6` | 4기둥 결과 일치 확인 |
| PlayMCP 1FATE 한계 | 응답에 4기둥·십신·격국·용신·12운성·신살·대운표 미포함 — narrative only |
| 어제(2026-05-12) PlayMCP 사고 | 일주를 丁卯 로 잘못 분석. 卯時 癸卯 시주가 丁日·壬日 양쪽에서 나올 수 있는 모호성을 못 봄 |
| 본 spec 의 회귀 방지 | 본인 사주를 canonical fixture 로 박아 어떤 어댑터 변경도 壬辰 외 일주를 만들지 못하도록 강제 |

### 1.5 비목표 (v0.1)

- 년·월·일 운세 어댑터 구현 — 인터페이스만 v0.1, 구현은 v0.2 이후
- 궁합 어댑터 구현 — 인터페이스만 v0.1, 구현은 v0.3
- 기존 `/tiger/*` PlayMCP 영역 변경 — 보존
- 기존 `saju_charts` 테이블 마이그레이션 — 호환 유지
- 도시 데이터베이스 전수 — v0.1 은 한국 시군구 ~250 + 일본·중국 주요 도시 ~500, 그 외 수동 경도 입력
- 모바일 PWA 푸시
- 다국어 narrative 출력 (영어·일본어) — v0.1 한국어 only
- 자체 만세력 구현 — `lunar-javascript` + `korean-lunar-calendar` 합의 검증으로 충분
- 학파 간 충돌 시 자동 화해 — v0.1 은 충돌 표시만
- PlayMCP 의존 — 본 spec 은 PlayMCP 를 호출하지 않는다

---

## 2. 결정 (Decisions)

| ID | 결정 | 근거 |
|----|------|------|
| D1 | 스코프: 통합 설계 + v0.1 조각 1개 | 6개 운세 × 4학파 = 24 서브시스템, 단일 spec 으로는 너무 큼 |
| D2 | 사용자 범위: 로그인한 구글 계정 전체 | 기존 `fortune_profiles` 권한 구조 재사용 |
| D3 | 계산 소스: 100% 결정형 자체 구현 + LLM 은 서술용 | 외부 의존 제거, 명조 오류 추적 가능 |
| D4 | 구현 깊이: 원전·고전 기반 + 단위 테스트 80%+ | 어제 일주 오류 재발 방지, 유지보수성 |
| D5 | PlayMCP 미사용, 기존 `/tiger/*` 영역 보존 | 두 시스템 완전 독립 |
| D6 | v0.1 조각: 평생 운세 | "더 자세한 풀이" 요구와 직결, 명조 골격이 가장 큰 가치 |
| D7 | 기존 자산 활용: `packages/saju` 확장 + `/fortune` 섹션 주입 | 마이그레이션·중복 코드 회피 |
| D8 | LLM 전략: 삼국 관점별 별도 호출 3~4회 + Claude opus | 학파별 톤·용어·금지어 분리, 교차 검증 가능 |
| D9 | 아키텍처: 공통 명조 core + 국가별 해석 adapter (접근 A) | 4기둥 1회 결정 → 어댑터 캡슐화 → 확장성 |

---

## 3. 아키텍처

### 3.1 계층 구조

```
입력 — BirthInput
  └─ time/trueSolar.ts          # 일본식 진태양시 보정 (KST → 실태양시)
명조 결정형 계산 — core/
  └─ 4기둥 8글자 + 12운성 + 십신 + 합충형파해 + 신살
어댑터 — adapters/{ko,cn-ziping,cn-mangpai,jp}/lifetime.ts
  ├─ ko.lifetime          → 격국(억부) + 조후 + 신살 + 한국 직업·관계·건강
  ├─ cn-ziping.lifetime   → 자평진전 격국 + 적천수 용신
  ├─ cn-mangpai.lifetime  → 60년 대운별 응기 시점 분기
  └─ jp.lifetime          → 통변성 + 진태양시 정확도 + 12궁
통합 — compose/lifetime.ts
  └─ TriNationLifetime + crossCheck (4기둥 일치 / 격국 분기 / 용신 충돌)
LLM 서술 — Claude opus, 학파별 독립 호출
UI — /fortune/[profileId] 안의 <TriNationTabs />
```

### 3.2 패키지 구조

```
packages/saju/
├── src/
│   ├── core/
│   │   ├── types.ts                # 공용 타입
│   │   ├── chart.ts                # 4기둥·십신·12운성·합충형파해·신살
│   │   ├── stems-branches.ts       # 천간·지지·60갑자 상수
│   │   └── consensus.ts            # lunar-javascript + korean-lunar-calendar 합의 검증
│   ├── time/
│   │   ├── kst.ts                  # 기존
│   │   └── trueSolar.ts            # 신규 — 진태양시 보정 + 시주 모호성 감지
│   ├── adapters/
│   │   ├── ko/lifetime.ts
│   │   ├── cn-ziping/lifetime.ts
│   │   ├── cn-mangpai/lifetime.ts
│   │   └── jp/lifetime.ts
│   ├── daeun/
│   │   └── daeun.ts                # 60년 대운 + 양남음녀 순행 / 음남양녀 역행
│   ├── compose/
│   │   └── lifetime.ts             # TriNationLifetime + crossCheck
│   └── index.ts                    # public API barrel
└── tests/
    ├── fixtures/
    │   ├── canonical-1967.json     # 본인 사주 (壬辰 일주 골든)
    │   └── historical/*.json       # 추가 회귀 fixture
    └── *.test.ts
```

### 3.3 인터페이스 (TypeScript 시그니처)

```ts
// packages/saju/src/core/types.ts
export interface BirthInput {
  birthDateLocal: string;              // "1967-03-29"
  birthTimeLocal: string;              // "05:30" — 빈 문자열이면 시주 미상
  timezone: string;                    // IANA — "Asia/Seoul"
  longitudeDeg: number;                // 126.78 — 진태양시 보정 입력
  calendar: "solar" | "lunar";
  gender: "male" | "female";
}

export interface ResolvedMoment {
  utcInstant: Date;
  trueSolarMinutesOffset: number;      // 음수 = 표준시보다 일찍
  ambiguityWindow?: {                  // 시주 경계 ±5분 진입 시
    boundaryHour: number;
    candidateBranches: [string, string];
  };
  hourKnown: boolean;
}

export interface FourPillars {
  year:  { stem: HeavenlyStem; branch: EarthlyBranch };
  month: { stem: HeavenlyStem; branch: EarthlyBranch };
  day:   { stem: HeavenlyStem; branch: EarthlyBranch };
  hour:  { stem: HeavenlyStem; branch: EarthlyBranch } | null; // 시주 미상 시 null
}

export interface SajuChart {
  pillars: FourPillars;
  tenGods: TenGodsMap;                 // 8자리 — hour 가 null 이면 6자리
  twelveStages: TwelveStagesMap;
  interactions: Interactions;          // 합·충·형·파·해
  shensha: Shensha[];                  // 천을귀인·도화·역마·괴강·양인·문창귀인 등
  elementBalance: ElementBalance;      // 오행 분포 + 신강·신약 수치
}

export interface DaeunTable {
  startAge: number;                    // 입대운
  direction: "forward" | "backward";
  pillars: DaeunPillar[];              // 10년 단위 8~12개
}

export interface LifetimeFrame {
  school: "ko" | "cn-ziping" | "cn-mangpai" | "jp";
  pillarsAnnotated: PillarAnnotation[];
  formatGyeokguk: { name: string; reasoning: string };
  yongshin?: { element: FiveElement; reasoning: string };
  daeunHighlights: DaeunHighlight[];
  careerHints: string[];
  relationshipHints: string[];
  healthHints: string[];
  cautions: string[];
  schoolSpecific: Record<string, unknown>;   // 맹파 응기 시점 등
}

export interface TriNationLifetime {
  chart: SajuChart;
  daeun: DaeunTable;
  trueSolar: ResolvedMoment;
  frames: {
    ko: LifetimeFrame;
    cnZiping: LifetimeFrame;     // school enum: "cn-ziping"
    cnMangpai: LifetimeFrame;    // school enum: "cn-mangpai"
    jp: LifetimeFrame;
  };
  crossCheck: {
    pillarsAgree: boolean;
    gyeokgukConsensus: ConsensusReport;
    yongshinConflicts: Conflict[];
  };
}
// 표기 규칙: TypeScript object key 는 camelCase (cnZiping),
// DB enum/URL query param 은 kebab-case (cn-ziping).
// 변환은 `features/saju-lifetime-tri/lib/schoolKey.ts` 에서 일원화.

// 공용 Result 타입
export type Result<T> = { ok: true; value: T } | { ok: false; error: SajuError };
export type SajuErrorCode =
  | "INVALID_INPUT"
  | "OUT_OF_RANGE"
  | "AMBIGUOUS_HOUR"
  | "MISSING_HOUR"
  | "LIBRARY_MISMATCH";

// 진입점
export function buildTriNationLifetime(input: BirthInput): Promise<Result<TriNationLifetime>>;
```

### 3.4 v0.2 이후 확장 인터페이스 (v0.1 에선 시그니처만)

```ts
// 년·월·일 운세
export interface YearlyFrame { /* ... */ }
export function buildYearlyKo(chart: SajuChart, daeun: DaeunTable, targetYear: number): YearlyFrame;
export function buildYearlyCnZiping(/* ... */): YearlyFrame;
export function buildYearlyCnMangpai(/* ... */): YearlyFrame;
export function buildYearlyJp(/* ... */): YearlyFrame;

// 궁합
export interface CompatFrame { /* ... */ }
export function buildCompatKo(a: SajuChart, b: SajuChart): CompatFrame;
// ... 등
```

v0.1 에선 위 시그니처 파일만 두고 함수 본체는 `throw new Error("v0.2")` 로 표시.

---

## 4. 데이터 모델 (DB)

### 4.1 마이그레이션

```sql
-- 1. 기존 fortune_profiles 에 컬럼 추가
ALTER TABLE fortune_profiles
  ADD COLUMN longitude_deg numeric(7, 4);

-- 2. 결정형 LifetimeFrame 캐시
CREATE TABLE saju_lifetime_tri (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp', 'compose')),
  input_hash      text NOT NULL,         -- birth_* + longitude_deg 정규화 SHA-256
  schema_version  integer NOT NULL,      -- 어댑터 코드 변경 시 bump
  frame_jsonb     jsonb NOT NULL,        -- LifetimeFrame 또는 TriNationLifetime
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, school, input_hash, schema_version)
);

-- 3. LLM narrative 캐시
CREATE TABLE saju_lifetime_narrative (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  school          text NOT NULL CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp')),
  frame_hash      text NOT NULL,         -- LifetimeFrame 정규화 SHA-256
  model_id        text NOT NULL,         -- "claude-opus-4-7"
  narrative_text  text NOT NULL,
  sections_jsonb  jsonb NOT NULL,        -- {personality, career, relationship, health, daeun_summary}
  citations       text[] NOT NULL DEFAULT '{}',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, school, frame_hash, model_id)
);

CREATE INDEX idx_saju_lifetime_tri_profile ON saju_lifetime_tri(profile_id);
CREATE INDEX idx_saju_lifetime_narrative_profile ON saju_lifetime_narrative(profile_id);
```

### 4.2 캐시 무효화 매트릭스

| 변경 | 영향 |
|------|------|
| `fortune_profiles` 의 birth_* 또는 longitude_deg 수정 | CASCADE → `saju_lifetime_tri` + `saju_lifetime_narrative` 전부 삭제 |
| 어댑터 코드 변경 (schema_version bump) | 해당 학파의 `saju_lifetime_tri` row 무효 |
| LLM 모델 변경 (model_id) | `saju_lifetime_narrative` 만 무효, `saju_lifetime_tri` 는 유지 |
| 사용자가 명시적 refresh 클릭 | UI 가 해당 row 삭제 후 재계산 트리거 |

---

## 5. API

### 5.1 라우트

| 메서드 | 경로 | 책임 |
|--------|------|------|
| GET | `/api/saju/lifetime/:profileId` | 결정형 `TriNationLifetime` 반환 (캐시 first) |
| GET | `/api/saju/lifetime/:profileId/narrative?school=ko` | 학파별 LLM narrative 반환 (캐시 first, lazy) |
| POST | `/api/saju/lifetime/:profileId/refresh` | 캐시 무효화 + 재계산 |

### 5.2 응답 schema (zod)

```ts
// /api/saju/lifetime/:profileId — 결정형, 빠른 응답
export const lifetimeResponseSchema = z.object({
  triNation: triNationLifetimeSchema,
  cachedAt: z.string().datetime(),
  fromCache: z.boolean(),
});

// /api/saju/lifetime/:profileId/narrative
export const narrativeResponseSchema = z.object({
  school: z.enum(["ko", "cn-ziping", "cn-mangpai", "jp"]),
  narrativeText: z.string(),
  sections: z.object({
    personality: z.string(),
    career: z.string(),
    relationship: z.string(),
    health: z.string(),
    daeunSummary: z.string(),
  }),
  citations: z.array(z.string()),
  modelId: z.string(),
  generatedAt: z.string().datetime(),
  fromCache: z.boolean(),
});
```

### 5.3 인증·권한·rate limit

- 모든 라우트: NextAuth `auth()` 세션 + `fortune_profiles.user_id` 일치 검사
- LLM 호출: 사용자당 분당 5회 — `shared/lib/llm/rateLimit.ts` (신규)
- 결정형 라우트: rate limit 없음 (캐시 hit 비용 무시 가능)

---

## 6. UI

### 6.1 라우트 변경

| 경로 | 상태 | 내용 |
|------|------|------|
| `/fortune/[profileId]` | 확장 | 상단 `<CrossCheckBadge />` + `<TriNationTabs />` 주입, 기존 한국식 풀이는 유지 |
| `/fortune/[profileId]/lifetime/[school]` | 신규 | 학파별 상세 페이지 — school = ko / cn-ziping / cn-mangpai / jp / compose |
| `/fortune/profiles/new` | 확장 | 출생 도시 자동완성 + 경도 필드 |

### 6.2 FSD 슬라이스

```
src/
├── features/
│   └── saju-lifetime-tri/              # 신규
│       ├── api/lifetime-client.ts
│       ├── model/{schema.ts, types.ts}
│       ├── ui/
│       │   ├── TriNationTabs.tsx       # 5탭: KO·CN자평·CN맹파·JP·통합
│       │   ├── LifetimeFrameCard.tsx
│       │   ├── CrossCheckBadge.tsx
│       │   ├── DaeunTimeline.tsx
│       │   └── CitySelector.tsx        # 자동완성 + 경도 fallback
│       └── lib/
├── widgets/
│   └── saju-tri-lifetime/
│       └── ui/SajuTriLifetime.tsx      # server component, RSC 진입점
└── entities/saju-chart/                # 기존 타입에 TriNationLifetime 추가
```

### 6.3 컴포넌트 책임

```ts
// widgets/saju-tri-lifetime/ui/SajuTriLifetime.tsx (server component)
// 1. RSC 에서 buildTriNationLifetime() 호출 (< 200ms, 캐시 hit 시 < 50ms)
// 2. crossCheck + 4 frame 을 props 로 내려보냄
// 3. <TriNationTabs /> 가 클라이언트에서 narrative lazy fetch

// features/saju-lifetime-tri/ui/TriNationTabs.tsx (client component)
// ├─ Tab "ko"          → <LifetimeFrameCard school="ko" /> + 클릭 시 narrative fetch
// ├─ Tab "cn-ziping"   → 격국·용신 강조
// ├─ Tab "cn-mangpai"  → 응기 분기점 강조
// ├─ Tab "jp"          → 진태양시 정확도 표시
// └─ Tab "compose"     → 삼국 비교표 (LLM 없이 결정형 결과만)
```

### 6.4 시각 구성 (텍스트 mockup)

`CrossCheckBadge` (상단):
```
┌─ 삼국 교차검증 ────────────────────────────────┐
│ ✓ 4기둥 일치: 丁未 / 癸卯 / 壬辰 / 癸卯         │
│ ⚠ 격국 분기: KO=傷官格, CN-ziping=傷官生財格   │
│ ⓘ 진태양시 보정 -32분 (부천 126.78°E)           │
│ ✓ 시주 모호성 없음 (보정 후 卯時 안정)          │
└────────────────────────────────────────────────┘
```

`LifetimeFrameCard`:
```
┌─ 한국 관점 (자평+조후+신살) ─────────────────────┐
│ 격국: 傷官格 (월지 卯木이 일간 壬水를 누설)      │
│ 용신: 戊土(편관) — 신강 명조 제어               │
│ 조후: 봄 卯月 출생, 木旺·火弱 → 火土 보강 필요    │
│ 신살: 괴강(壬辰) · 도화(卯卯重) · 천을귀인(無)  │
│                                                  │
│ [narrative lazy — 클릭 시 LLM 호출]              │
│ [더 자세히 보기 → /fortune/.../lifetime/ko]      │
└──────────────────────────────────────────────────┘
```

`DaeunTimeline`: 60년 가로 막대 + 학파별 마커
- KO: 토금운 강조
- CN자평: 용신·기신 색 그라데이션
- CN맹파: 응기 분기점 마커 (결혼·이직·이주·건강)
- JP: 명궁 변화 마커

### 6.5 모바일

- TriNationTabs: 좌우 스와이프 + 상단 도트 인디케이터 (4탭)
- DaeunTimeline: 세로 스택 + 학파 필터 셀렉트
- 폰트: Noto Sans + Noto Serif KR/JP/SC 한자 fallback

---

## 7. 에러 처리

### 7.1 입력 단계

| 케이스 | 처리 |
|--------|------|
| 출생 도시 미입력 / 경도 미상 | 한국 표준 경도 127°E 폴백 + UI 경고 배지 "진태양시 보정 부정확" |
| 출생 시각 미상 | 시주 계산 불가 → 3기둥(년·월·일)만 계산, `hourKnown=false`. JP 어댑터는 정확도 ⚠ |
| 진태양시 보정으로 시주 경계 ±5분 진입 | `ambiguityWindow` 채워서 반환 → UI 가 두 후보 시지 표시 + 사용자 확인 후 고정 |
| 음력 입력 | 만세력 라이브러리로 양력 변환 |
| 1900년 이전 / 2100년 이후 | reject — 만세력 신뢰 범위 외 |

### 7.2 계산 단계

- `computeChart`, `computeDaeun`, `buildLifetime*` 는 순수 함수, throw 금지, `Result<T>` 반환
- `SajuError.code`: `INVALID_INPUT`, `OUT_OF_RANGE`, `AMBIGUOUS_HOUR`, `MISSING_HOUR`, `LIBRARY_MISMATCH`
- 어댑터 1개 실패해도 다른 어댑터는 계속 진행, compose 단계에서 placeholder + 안내
- **만세력 합의 검증**: `lunar-javascript` 와 `korean-lunar-calendar` 결과 불일치 시 `LIBRARY_MISMATCH` 반환, UI 가 양쪽 결과 표시 (G1 일주 오류 재발 방지)

### 7.3 LLM 단계

- 학파별 호출 독립. 한 학파 narrative 실패해도 다른 학파는 정상 노출
- UI 실패 메시지: "이 관점의 풀이를 불러오지 못했습니다. 다시 시도" + 결정형 frame 은 그대로 표시
- zod 검증 실패 → 1회 재시도 → 실패 시 raw text 폴백 + 경고 배지
- Rate limit 429 → 클라이언트 백오프 3·6·12초

---

## 8. 캐시

| 데이터 | 위치 | 키 | TTL |
|--------|------|-----|------|
| 결정형 LifetimeFrame | DB `saju_lifetime_tri` | `(profile_id, school, input_hash, schema_version)` | 영구 (입력 동일하면 결과 동일) |
| LLM narrative | DB `saju_lifetime_narrative` | `(profile_id, school, frame_hash, model_id)` | 영구 (사용자 명시 refresh 시만 무효화) |
| 4기둥 결과 (chart) | 프로세스 메모리 LRU 100 | `inputHash` | 프로세스 lifetime |
| 만세력 합의 검증 결과 | 프로세스 메모리 LRU 100 | `birthDate + timezone` | 프로세스 lifetime |

`inputHash` 계산: 기존 `apps/dashboard/src/features/tiger-consult/lib/hash.ts` 패턴 재사용. SHA-256 of 정규화된 입력.

---

## 9. 테스트 전략

### 9.1 단위 테스트 (Vitest, 목표 커버리지 80%+)

| 모듈 | 테스트 종류 | 픽스처 |
|------|------------|--------|
| `time/trueSolar.ts` | 한국 4도시 (부천·서울·부산·제주) + 도쿄·베이징 경도 → 분 단위 보정값 | 일본 추명학 표준 보정값 표 |
| `core/chart.ts` 4기둥 | 60갑자 5사이클 (300년) 의 음력 변환 + lunar-javascript / korean-lunar-calendar 합의 | 100건 사주 fixture |
| `core/chart.ts` 십신·12운성 | 60갑자 전수 십신 매핑 | 자평진전 표 |
| `core/chart.ts` 신살 | 천을귀인·도화·역마·괴강·양인·문창귀인 등 | 적천수 표 |
| `daeun/daeun.ts` | 양남음녀 순행 / 음남양녀 역행 + 입대운 만년령 | 만세력 사이트 4건 결과 |
| `adapters/ko/lifetime.ts` | 격국 분기 (정격 8 + 외격 3) + 조후 사계 명조 | 박재완 명리요강 예제 |
| `adapters/cn-ziping/lifetime.ts` | 자평진전 격국 + 적천수 용신 (억부·조후·통관·병약·전왕) | 자평진전 원전 예제 10건 |
| `adapters/cn-mangpai/lifetime.ts` | 응기 분기 시점 — 사용자 실제 과거 사건 역검증 | 단건업 체계 예제 5건 |
| `adapters/jp/lifetime.ts` | 통변성 + 12궁 + 진태양시 정확도 | 아베 다이잔 추명학 표 |
| `compose/lifetime.ts` | 4 frame crossCheck — 4기둥 일치 / 격국 분기 / 용신 충돌 | 합성 fixture |

### 9.2 통합 테스트 (Vitest + DB)

- 신규 테이블 schema 검증
- `fortune_profiles` 수정 시 `saju_lifetime_*` CASCADE
- `/api/saju/lifetime` RSC 호출 — 캐시 hit / miss
- 기존 `tests/setup.ts` 의 prod DB 가드 그대로 활용

### 9.3 Canonical Fixture — 본인 사주

`packages/saju/tests/fixtures/canonical-1967.json`:

```json
{
  "input": {
    "birthDateLocal": "1967-03-29",
    "birthTimeLocal": "05:30",
    "timezone": "Asia/Seoul",
    "longitudeDeg": 126.78,
    "calendar": "solar",
    "gender": "male"
  },
  "expected": {
    "pillars": {
      "year":  { "stem": "丁", "branch": "未" },
      "month": { "stem": "癸", "branch": "卯" },
      "day":   { "stem": "壬", "branch": "辰" },
      "hour":  { "stem": "癸", "branch": "卯" }
    },
    "elementBalance": { "wood": 2, "fire": 1, "earth": 2, "metal": 0, "water": 3 },
    "daeun": { "startAge": 8, "direction": "backward" },
    "ko": { "gyeokguk": "傷官格" }
  }
}
```

모든 어댑터 변경 PR 은 이 fixture 의 `pillars.day = 壬辰` 결과를 깨지 못한다.

### 9.4 E2E (v0.1 외, 선택)

- Playwright: `/fortune/[profileId]` 진입 → TriNationTabs 4탭 렌더 → 한 학파 클릭 → narrative 표시
- v0.1 에서는 unit + integration 만 의무

---

## 10. 범위 · 일정 · 비목표

### 10.1 v0.1 범위 (이번 spec)

§1.3 + §3 + §4 + §5 + §6 + §7 + §8 + §9 전부.

### 10.2 v0.1 비목표

§1.5 참고.

### 10.3 작업 견적 (Plan 단계에서 세분화)

| Phase | 내용 | 추정 Task |
|-------|------|----------|
| Phase 0 | DB 마이그레이션 + 도시 데이터셋 import + canonical fixture | 2 |
| Phase 1 | `time/trueSolar.ts` + 입력 폼 확장 + unit 테스트 | 2 |
| Phase 2 | `core/chart.ts` 확장 — 십신·12운성·합충형파해·신살 + 만세력 합의 검증 | 3 |
| Phase 3 | `daeun/daeun.ts` 확장 + 양남음녀 / 음남양녀 | 2 |
| Phase 4 | 어댑터 4종 (`ko`, `cn-ziping`, `cn-mangpai`, `jp`) | 4 |
| Phase 5 | `compose/lifetime.ts` + crossCheck | 2 |
| Phase 6 | API 라우트 + LLM 호출 + zod schema + rate limit | 2 |
| Phase 7 | UI — `<TriNationTabs />`, `<LifetimeFrameCard />`, `<CrossCheckBadge />`, `<DaeunTimeline />`, `/fortune/[profileId]/lifetime/[school]` | 3 |
| Phase 8 | 통합 테스트 + canonical fixture 회귀 + 빌드/lint/typecheck | 2 |
| **합계** | | **약 22 Task** |

### 10.4 v0.2~v0.x 로드맵 (참고)

| 버전 | 추가 |
|------|------|
| v0.2 | 년운세 — KO 세운+조후 / CN자평 충합 / CN맹파 응기 / JP 파동 |
| v0.3 | 월운세·일운세 — 응기 월령·일진 신살·일주 명궁 |
| v0.4 | 궁합 — KO 신살·일지합충 / CN자평 격국 호환 / CN맹파 양인·도화 응기 |
| v0.5 | 기타 — 직업 (용신), 건강 (조후), 재물 (재성·식상 응기) |
| v0.x | 도시 데이터 확장, 영어/일본어 narrative, 모바일 PWA 알림, 역사 인물 데이터셋 |

---

## 11. 성공 기준 (Acceptance Criteria)

1. 본인 사주 (1967-03-29 05:30 부천) 진입 시 4개 학파 frame 모두 렌더되고, 어떤 학파도 일주를 壬辰 외로 분석하지 않는다 (canonical fixture).
2. 입력 폼에서 도시 선택 시 진태양시 보정값이 표시되고 ±5분 경계면 시주 모호성 배지 노출.
3. 결정형 frame: 첫 진입 < 200ms, 캐시 hit < 50ms.
4. LLM narrative 는 학파별 lazy 로딩, 한 학파 실패해도 다른 학파 정상.
5. `pnpm typecheck`, `pnpm lint`, `pnpm test` 모두 통과 (커버리지 80%+).
6. 4기둥 합의 검증으로 `lunar-javascript` 와 `korean-lunar-calendar` 불일치 케이스 fail-fast.
7. 기존 `/tiger/*` PlayMCP 영역은 코드 변경 없이 그대로 동작.

---

## 12. 위험 & 완화

| 위험 | 영향 | 완화 |
|------|------|------|
| 어댑터별 격국 알고리즘 차이로 인한 결과 불일치 | 중 | crossCheck 로 명시 표시, 사용자에게 학파별 판단 노출 |
| 맹파(盲派) 응기 알고리즘은 공식 원전 부족, 구전 체계 | 중 | v0.1 에선 단건업 체계 표 기반 결정형 룰 + LLM 보조 해석 명시. 정확도 보증은 학파 한계로 제한 표시 |
| LLM 토큰 비용 — 학파별 3~4회 호출 × Claude opus | 중 | DB 영구 캐시로 재호출 회피, 사용자당 분당 5회 rate limit |
| 도시 데이터셋 750개로 부족 | 저 | 수동 경도 입력 fallback, v0.x 에 확장 |
| 만세력 라이브러리 둘 다 같은 버그가 있을 가능성 | 저 | canonical fixture + 100건 회귀 fixture 로 변경 감지 |
| 학파 표기·용어 일관성 (영문 키와 한자 표시) | 저 | `school` enum 고정 + i18n 디렉터리에 한자·한글·영문 매핑 |

---

## 13. 미해결 질문 (v0.1 전 결정 필요 없음)

- 사용자가 학파 우선순위를 본인 선호로 저장할 수 있는 설정 — v0.2 후보
- AB 테스트 framework — 학파별 narrative 선호도 측정 — v0.x
- 역사 인물 사주 데이터셋 노출 — 흥미 기능, v0.x

---

## 14. 참고 자료

- 자평진전(子平眞詮) — 송대 자평 정통
- 적천수(滴天髓) — 명조 용신론 원전
- 궁통보감(窮通寶鑑) — 조후론 원전
- 단건업(段建業) 맹파 체계 정리서 — 응기 알고리즘 근거
- 阿部泰山『四柱推命学全集』— 일본 추명학 표준
- 박재완『명리요강』, 박청화『춘하추동 신사주학』— 한국 현대 명리 해설
- `lunar-javascript@1.7.7` + `korean-lunar-calendar@0.3.6` — 만세력 합의 검증
- 메모리 `saju-G1-day-pillar-correction` — canonical fixture 근거
