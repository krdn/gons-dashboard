# Saju Tri Narrative v0.3.1 — Yearly/Monthly Richer Edition 설계

- 작성일: 2026-05-19
- 작성자: gon + Claude Code
- 상태: DESIGN (구현 전 spec)
- 대상: `apps/dashboard/src/features/saju-{yearly,monthly}-tri/` 의 LLM narrative 시스템

---

## 1. 배경과 목표

### 1.1 현황

v0.3 (PR #90~96) 으로 4학파 × 4도메인 (lifetime / yearly / monthly / daily) narrative 가 운영 가동 중. 그러나 **PR #87 (lifetime v0.2 richer)** 의 풍성도 패턴이 lifetime 1개 도메인에만 적용되고, yearly/monthly 는 v0.1 (간소형) 패턴을 미러링한 채 머지됨.

운영 검증 결과 (김석곤 profile_id `76896374-e6a5-47e3-8a0b-0347ac2944d2`, 2026 세운):

| 도메인 | 학파 | v1 (영어 strength) | v2 (종아격 frame) | 변화 |
|--------|------|--------------------|-------------------|------|
| yearly | ko        | 742자 | 819자 | +10% |
| **yearly** | **cn-ziping** | **862자** | **587자** | **-32% ⚠️ 회귀** |
| yearly | cn-mangpai | 681자 | (미방문) | — |
| yearly | jp        | (없음) | (미방문) | — |
| lifetime | (4학파) | 700~750자 | **algorithm_version=2 row 부재** | — |
| monthly | (4학파) | (신규 v0.3) | (운영 데이터 부족) | — |

### 1.2 진단된 root cause

**lifetime은 PR #87 에서 `prompts.ts` 로 분리 + COMMON_HEADER + 학파별 800자+ BODY + PROMPT_VERSION 키 도입으로 풍성도 강화 완료.**

반면 yearly/monthly 는 다음 패턴을 그대로 보유:

| 항목 | lifetime (v0.2) | yearly/monthly (v0.3 현재) |
|------|---|---|
| SCHOOL_PROMPT 형태 | COMMON_HEADER + KO/ZIPING/MANGPAI/JP_BODY (각 800자+) | 1줄 톤 (`narrative-server.ts` 내 inline) |
| 분량 정책 | 1500~2000자 5문단 + 인라인 용어풀이 | 미지정 |
| MAX_TOKENS | 8192 | 4096 |
| PROMPT_VERSION 키 | =2 (캐시 자동 무효화 가능) | 없음 |
| schoolSpecific | 학파별 union | 없음 (sections 5필드만) |
| 용어풀이 | keyTerms + cautions | 없음 |

cn-ziping yearly 회귀의 본질: 1줄 톤 `"중국 자평진전·적천수 원전 톤. 격국·용신·억부 중심으로 본 올해 세운(歲運)."` 만으로는 LLM 이 격국·용신·종격 개념을 풀어쓸 지침을 못 받음. ko 가 +10% 인 이유는 종격 frame 의 rationale 길이 자체가 LLM 에게 충분한 정보를 줘서 ko 톤이 우연히 잘 풀어줬을 뿐.

### 1.3 데이터 검증 — advisor 가설 반증

advisor 1차 라운드에서 "prompt 가 종격 모름 → root cause" 가설 제기. 실측 데이터로 반증:

김석곤 ko 2026 algorithm_version=2 narrative 첫 문장 (운영 DB 인용):

> "2026년 병오(丙午) 세운은 **종아격(從兒格)으로 식상의 흐름을 따르는 당신에게** 화(火) 기운의 재성을 강하게 끌어오는 해입니다. ..."

prompt 본문에 종아·종격·식상 단어 0건. LLM 이 frame 의 `rationale: "가종 종아격으로 식상의 흐름을 따른다"` 와 `basisShenStrength="종아"` 만 받아 정확히 풀어냄. **결론: 종격 용어를 prompt 에 박는 것은 nice-to-have. 진짜 회귀는 ZIPING_BODY 부재로 인한 분량·구조화 손실.**

### 1.4 목표

| 지표 | yearly v0.3 / monthly v0.3 | yearly/monthly v0.3.1 |
|---|---|---|
| 본문 분량 (yearly) | 400~860자 | 1200~1600자 (3문단~5문단) |
| 본문 분량 (monthly) | (미측정) | 800~1200자 (3문단) |
| 용어 풀이 | 없음 | 인라인 괄호 + keyTerms 배열 |
| 실전성 | 경향성 일반론만 | personality=경향성 / career·rel·health=장면 행동 / daeun=타이밍 (3층, lifetime v0.2 와 동일) |
| 학파 차별화 | 톤만 다름 | schoolSpecific 필드 학파별 분기 (lifetime v0.2 패턴 재사용) |
| max_tokens | 4096 | 6144 (yearly) / 4096 (monthly) |
| 캐시 키 | (profileId, school, targetYear, [targetMonth,] frameHash, modelId, algorithmVersion) | + **promptVersion** 추가 |

### 1.5 범위 결정

- **포함**: yearly + monthly narrative (각 4학파)
- **제외 (의도)**:
  - **daily** — cron 일배치 + UI 카드 (150~300자 압축이 의도된 분량). 풍성도 강화 대신 단정형 톤 유지가 product 의도.
  - **신규 알고리즘** — v0.4 backlog (종격 잔여 학파, 격국 6종 등) 와 독립.
  - **frame 자체 변경** — `@gons/saju` 패키지의 YearlyFrame/MonthlyFrame 구조 변경 금지. prompt + UI 만 손댐.

### 1.6 의사결정 요약

- **B 안 (스키마 확장 + 학파별 구조화 프롬프트)** 채택 — lifetime v0.2 와 동일 패턴.
- **PROMPT_VERSION 키 추가** 로 자연스러운 캐시 무효화. yearly/monthly 모두 PROMPT_VERSION=2 부터 시작 (=1 은 v0.3.1 이전 의미).
- **전면 교체** (A/B 없음, feature flag 없음). 기존 v1 row 는 보존 (감사).
- **prompts.ts 분리 패턴**: yearly + monthly 모두 `api/prompts.ts` 신설. 4 파일 (lifetime/yearly/monthly 각자, daily 제외).

---

## 2. 출력 스키마 변경

### 2.1 yearly sections 확장

```typescript
// shared/lib/db/schema.ts — YearlyNarrativeSections 교체

export interface YearlyNarrativeSections {
  personality: string;     // 200~280자 — 올해 드러나는 기질·태도
  career: string;          // 200~280자 — 직업·재물 흐름 (장면 행동)
  relationship: string;    // 200~280자 — 인연·가족 관계 (장면 행동)
  health: string;          // 200~280자 — 건강 주의점 (계절성)
  daeunSummary: string;    // 200~280자 — 현 대운 구간이 올해에 미치는 영향

  keyTerms: NarrativeKeyTerm[];   // 본문 등장 핵심 용어 4~6개
  cautions: string[];             // 1~3개 — 메타 라벨
}
```

### 2.2 monthly sections 확장

monthly 는 yearly 보다 짧은 분량 정책 (800~1200자) — sections 도 각 150~200자.

```typescript
// shared/lib/db/schema.ts — MonthlyNarrativeSections 교체

export interface MonthlyNarrativeSections {
  personality: string;     // 150~200자
  career: string;          // 150~200자
  relationship: string;    // 150~200자
  health: string;          // 150~200자
  daeunSummary: string;    // 150~200자

  keyTerms: NarrativeKeyTerm[];   // 본문 등장 핵심 용어 3~5개
  cautions: string[];             // 0~2개
}
```

### 2.3 학파별 schoolSpecific (lifetime v0.2 재사용)

`shared/lib/db/schema.ts` 의 `SchoolSpecificKo/Ziping/Mangpai/Jp` 와 `SchoolSpecific` union 을 yearly/monthly narrative 에서도 그대로 재사용. 신규 타입 추가 없음.

| 학파 | 필드 |
|------|------|
| ko | `joohuFocus`, `shinsalNotes[]` |
| cn-ziping | `gyeokgukRationale`, `yongshinAnalysis` |
| cn-mangpai | `eventTimings[]` (period, event) |
| jp | `palaceMap[]` (palace, note) |

yearly 의 경우 `eventTimings` 는 "올해 분기별" 응기 시점, `palaceMap` 은 "올해 활성화되는 궁" 으로 의미를 좁힘. monthly 는 "이번 달 분기" 로 더 좁힘. **타입은 공유, 의미만 도메인별로 narrow.**

---

## 3. DB Schema 변경

### 3.1 yearly + monthly narrative 테이블에 `prompt_version` + `school_specific_jsonb` 컬럼 추가

```typescript
// schema.ts:723 sajuYearlyNarrative — 추가
promptVersion: integer("prompt_version").notNull().default(1),
schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),

// uniqueIndex 갱신
uniqueIndex("saju_yearly_narrative_cache_key").on(
  t.profileId, t.school, t.targetYear, t.frameHash, t.modelId,
  t.promptVersion,    // 추가
  t.algorithmVersion,
),
```

monthly 도 동일 패턴:

```typescript
// schema.ts:813 sajuMonthlyNarrative — 추가
promptVersion: integer("prompt_version").notNull().default(1),
schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),

// uniqueIndex 갱신 — promptVersion 포함
uniqueIndex("saju_monthly_narrative_cache_key").on(
  t.profileId, t.school, t.targetYear, t.targetMonth, t.frameHash, t.modelId,
  t.promptVersion,    // 추가
  t.algorithmVersion,
),
```

### 3.2 daily narrative 테이블 — 변경 없음

`saju_daily_narrative` 는 v0.3.1 범위 외. 컬럼·인덱스 그대로 유지.

### 3.3 Migration

`pnpm db:generate` → `apps/dashboard/drizzle/0017_<random>_richer_yearly_monthly.sql` 생성. 기존 row 는 `prompt_version=1`, `school_specific_jsonb=null` 로 채워짐. v0.3.1 신규 row 는 `prompt_version=2` 로 자동 분리.

---

## 4. Prompt 구조 — lifetime/api/prompts.ts 패턴 미러링

### 4.1 신규 파일 — `features/saju-yearly-tri/api/prompts.ts`

```typescript
export const PROMPT_VERSION = 2;

export type NarrativeSchool = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

const COMMON_HEADER = `당신은 30년 경력의 사주 명리학 전문가입니다.
비전문가 사용자에게 올해 한 해의 흐름을 깊이 이해시키는 것이 목표입니다.

[작성 원칙]
1. 분량: narrativeText 1200~1600자 (4~5문단). 각 sections 필드는 200~280자.
2. 용어 풀이: 한자 용어·명리 전문어가 처음 등장할 때 인라인 괄호로 풀어 설명.
   예: 종아격(從兒格 — 일간이 식상에 종속하는 격국), 식상생재(食傷生財 — 식상이 재성을 생하는 흐름).
3. 섹션별 3층 구조:
   - personality: 올해 드러나는 기질·태도 ("당신은 올해 ~한 태도로")
   - career: 직업·재물 장면 행동 ("Q3 분기 회의에서 ~할 때 ~하세요")
   - relationship: 관계 장면 행동
   - health: 건강 관리 + 계절성 + 식단
   - daeunSummary: 현 대운 구간이 올해에 미치는 영향과 분기별 타이밍
4. 행동 지침은 "그래서 어떻게" 수준. 추상적 조언("균형 잡으세요") 금지. 상황·시간·대상 명시.
5. citations: 인용한 고전/전적의 편명. 최소 2개.`;

// 학파별 BODY — lifetime prompts.ts 의 KO_BODY/ZIPING_BODY/MANGPAI_BODY/JP_BODY 와
// 동일 어휘·강조점이지만 "올해 한 해" 관점에 맞춰 일부 문구 조정.
//
// 핵심 차이:
//  - lifetime: 평생 명조의 본질·궁극적 흐름
//  - yearly: 올해 세운 frame 의 영향, 분기별 타이밍, 현 대운과의 상호작용
const KO_BODY = `[학파 고유 관점 — 한국식 자평+조후+신살, 올해 세운]
...
[작성 시 강조점]
- 올해 세운 간지가 명조의 조후를 어떻게 흔드는지 한 문단 이상.
- 등장 신살 (괴강·도화·역마·화개 등) 이 올해에 어떻게 발현되는지.
- schoolSpecific.joohuFocus 에 올해 보완해야 할 오행과 그 근거.
- schoolSpecific.shinsalNotes 에 명조 + 세운 결합으로 발현되는 신살.
[금지]
- 자평진전 원전 인용. 그건 cn-ziping 의 영역.
- 응기 시점 단정 ("Q3 에 변동"). 그건 cn-mangpai 의 영역.`;

const ZIPING_BODY = `[학파 고유 관점 — 중국 자평진전·적천수, 올해 세운]
...
[작성 시 강조점]
- 올해 세운 간지가 격국 성립/파괴에 미치는 영향. 종격 케이스는 종아·종재·종살 cascade.
- 용신과 세운 간지의 관계 (用神 강화 / 손상 / 중립).
- schoolSpecific.gyeokgukRationale 에 격국·종격 성립 조건과 세운 영향.
- schoolSpecific.yongshinAnalysis 에 용신 후보 비교와 세운에서의 작용.
[금지]
- 신살을 메인으로 다루기. 그건 ko 의 영역.
- 응기 시점 단정. 그건 cn-mangpai 의 영역.`;

const MANGPAI_BODY = `[학파 고유 관점 — 중국 맹파 단건업, 올해 세운]
...
[작성 시 강조점]
- 올해 분기별 응기 시점을 구체적으로. 추상적 "올해 후반" 금지.
- 사건의 결을 단어로 (재물 변동, 가족 변고, 이동, 결혼).
- schoolSpecific.eventTimings 에 올해 분기별 (period, event) 3~6개.
[금지]
- "~할 가능성이 높다" 류 약화 표현. 단정형 우선.
- 격국 철학 토론. 그건 cn-ziping 의 영역.`;

const JP_BODY = `[학파 고유 관점 — 일본 추명학, 올해 세운]
...
[작성 시 강조점]
- 올해 활성화되는 12궁 5~8개 골라 각각 처세.
- 통변성으로 세운 간지의 의미 해설.
- schoolSpecific.palaceMap 에 (palace, note) 쌍 5~8개.
[금지]
- 격국 성립/파괴 토론. 그건 cn-ziping 의 영역.
- 신살을 메인으로 다루기. 그건 ko 의 영역.`;

export const SCHOOL_PROMPTS: Record<NarrativeSchool, string> = {
  ko: `${COMMON_HEADER}\n\n${KO_BODY}`,
  "cn-ziping": `${COMMON_HEADER}\n\n${ZIPING_BODY}`,
  "cn-mangpai": `${COMMON_HEADER}\n\n${MANGPAI_BODY}`,
  jp: `${COMMON_HEADER}\n\n${JP_BODY}`,
};
```

### 4.2 신규 파일 — `features/saju-monthly-tri/api/prompts.ts`

yearly 와 같은 패턴, 단:

- COMMON_HEADER: `narrativeText 800~1200자 (3문단)` + 각 section `150~200자`
- BODY: "이번 달" 관점 — 분기 대신 주차, 응기 시점은 "이번 달 상순·중순·하순" 으로 narrow
- 학파 BODY 4종 — yearly 의 BODY 와 같은 어휘·강조점, "이번 달" 로 시제만 변경

### 4.3 신규 파일 — `features/saju-yearly-tri/api/schemas.ts` + `features/saju-monthly-tri/api/schemas.ts`

lifetime/api/schemas.ts 패턴 미러링. 학파별 discriminated union 으로 sections + schoolSpecific 검증.

---

## 5. narrative-server.ts 변경

### 5.1 yearly 변경점

```typescript
// before
import { ALGORITHM_VERSION, type YearlyFrame } from "@gons/saju";
const MAX_NARRATIVE_TOKENS = 4096;
const SCHOOL_PROMPT: Record<NarrativeSchool, string> = { ko: "1줄", ... };

// after
import { ALGORITHM_VERSION, type YearlyFrame } from "@gons/saju";
import { PROMPT_VERSION, SCHOOL_PROMPTS, type NarrativeSchool } from "./prompts";
import { SCHOOL_SCHEMAS, type NarrativeOutput } from "./schemas";
const MAX_NARRATIVE_TOKENS = 6144;
```

캐시 조회·삽입 모두 `promptVersion` 컬럼 추가. lifetime 패턴 그대로 `onConflictDoUpdate` 로 자가 치유 가능하게 함 (현재는 `onConflictDoNothing`).

반환 타입 `YearlyNarrativeResult` 에 `promptVersion: number` + `schoolSpecific: SchoolSpecific` 추가.

### 5.2 monthly 변경점

yearly 와 같은 패턴. `MAX_NARRATIVE_TOKENS = 4096` (yearly 보다 짧은 분량 정책).

### 5.3 daily 변경 없음

`saju-daily-tri/api/narrative-server.ts` 손대지 않음.

---

## 6. UI 변경

### 6.1 신규 컴포넌트 — lifetime 의 컴포넌트 재사용 가능 여부 검토

lifetime v0.2 의 6개 컴포넌트 (KeyTermsStrip / NarrativeSection / CitationsFootnote / SchoolSpecificCard + 학파별 4종) 는 features 슬라이스 안에 위치 — FSD 의존성 방향상 yearly/monthly 가 직접 import 할 수 없음.

**옵션 A**: lifetime 의 UI 컴포넌트를 `shared/ui/saju-narrative/` 로 승격 → 3 도메인이 모두 import.
**옵션 B**: yearly/monthly 가 lifetime 의 컴포넌트를 코드 복제 (FSD 결정사항과 일관 — Phase 3 narrative-server.ts 의 extractJsonObject 와 동일 패턴).

**의사결정: 옵션 A 채택.** 이유:
1. UI 는 학파별 schoolSpecific 렌더링 외에는 stateless 컴포넌트 — shared 로 올려도 cross-feature 결합 없음.
2. 3 도메인 (lifetime/yearly/monthly) 이 같은 시각적 표현 (KeyTerm chip, NarrativeSection h4+body, Citation footnote) 을 갖는 것이 디자인 일관성에 유리.
3. lifetime UI 컴포넌트가 `LifetimeNarrativeSections` 가 아닌 `{ heading: string; body: string }` 같은 일반 prop 만 받도록 작은 리팩토링.

이동 대상:
```
features/saju-lifetime-tri/ui/KeyTermsStrip.tsx
features/saju-lifetime-tri/ui/NarrativeSection.tsx
features/saju-lifetime-tri/ui/CitationsFootnote.tsx
features/saju-lifetime-tri/ui/school-specific/*.tsx (5개)
                            ↓
shared/ui/saju-narrative/KeyTermsStrip.tsx
shared/ui/saju-narrative/NarrativeSection.tsx
shared/ui/saju-narrative/CitationsFootnote.tsx
shared/ui/saju-narrative/school-specific/*.tsx (5개)
```

### 6.2 yearly UI 갱신

`features/saju-yearly-tri/ui/` 의 narrative 렌더링 컴포넌트가 신규 sections (keyTerms / cautions) + schoolSpecific 를 사용하도록 갱신.

### 6.3 monthly UI 갱신

`features/saju-monthly-tri/ui/` 도 동일.

(상세 컴포넌트 목록은 plan 의 Phase 4 에서 코드 레벨로 명시)

---

## 7. 캐시 무효화 전략

### 7.1 PROMPT_VERSION bump

yearly + monthly 의 `prompts.ts` 가 `PROMPT_VERSION = 2` 로 export. 기존 v0.3 row 는 모두 `prompt_version=1` 로 default 채워짐. 신규 row 는 `prompt_version=2` 로 자동 분리.

### 7.2 운영 영향

- 4학파 × N년 (yearly) + 4학파 × N월 (monthly) 의 다음 cache miss 시 LLM 1회 호출 (Opus 4.x, 약 6144 tokens, 학파당 비용 약 $0.5).
- 김석곤 한 사람 기준 대략 4학파 × 5년 × $0.5 = $10 + monthly 4학파 × 12개월 × $0.3 = $15 → 첫 페이지 방문 시 발생.
- 기존 v1 row 는 그대로 남아 감사용으로 보존 (TRUNCATE 안 함).

### 7.3 schoolSpecificJsonb null 케이스

기존 v1 row 는 `school_specific_jsonb=null`. v0.3.1 코드가 캐시 조회 시 `promptVersion=2` 필터로 v1 row 제외 → null 케이스 도달 불가. 단, 도달 시 fall-through + 경고 로그 패턴은 lifetime narrative-server.ts:113-119 와 동일하게 적용.

---

## 8. 테스트 전략

### 8.1 단위 테스트

- `features/saju-yearly-tri/api/schemas.test.ts` (신규) — 학파별 스키마가 합법/위법 입력 거부.
- `features/saju-monthly-tri/api/schemas.test.ts` (신규) — 동일.
- `features/saju-yearly-tri/api/narrative-server.test.ts` (기존, 변경 없음) — extractJsonObject 만 테스트.
- `features/saju-monthly-tri/api/narrative-server.test.ts` — 같은 패턴 추가.

### 8.2 통합 테스트

기존 yearly/monthly route 통합 테스트가 새 캐시 키 (promptVersion 포함) 로 통과하는지 확인. 운영 DB 가드 (`tests/setup.ts`) 그대로 유효.

### 8.3 운영 검증

- 김석곤 lifetime + yearly cn-ziping/cn-mangpai/jp + monthly 페이지 방문 → v2 row 자동 생성.
- 분량 측정 SQL:

```sql
SELECT school, target_year, prompt_version, algorithm_version,
       length(narrative_text) AS chars
FROM saju_yearly_narrative
WHERE profile_id = '76896374-e6a5-47e3-8a0b-0347ac2944d2'
ORDER BY target_year DESC, school, prompt_version DESC;
```

목표 분량 (cn-ziping 2026):
- v1 (영어 strength): 862자
- v2 (종아격, prompt 회귀): 587자
- **v3 (종아격, richer): 1200~1600자**

### 8.4 회귀 테스트

- packages/saju vitest 144/144 PASS 유지 — 본 작업은 `@gons/saju` 미터치.
- dashboard vitest 319/321 PASS 유지 (2 pre-existing FK fail) + 신규 schemas.test.ts 추가.
- typecheck + lint pass.

---

## 9. 마이그레이션 순서 (운영 배포 시)

1. PR 머지 → GHA build & push (`ghcr.io/krdn/gons-dashboard:latest` 갱신)
2. 운영에서 `I_KNOW_THIS_IS_PROD=1 pnpm --filter @gons/dashboard db:migrate` 실행 (0017 적용)
3. `docker --context home-server compose pull app && up -d app`
4. 헬스체크: `curl https://gons.krdn.kr/api/health` → `{"status":"ok"}`
5. 김석곤 lifetime + yearly + monthly 페이지 직접 방문 → v2 row 자동 생성
6. 분량 SQL 로 검증 (위 8.3)

---

## 10. 비범위 (Non-goals)

- **daily narrative 강화** — 의도된 짧은 분량 유지. (v0.4 이후 검토)
- **신규 알고리즘** — 종격 잔여 학파 (mangpai·jp), 격국 6종 등은 v0.4.
- **frame 자체 변경** — `@gons/saju` 의 YearlyFrame/MonthlyFrame 구조 유지.
- **UI 디자인 시스템 변경** — 본 작업은 prompt + UI 컴포넌트 구조 변경만. SajuPatternCard 등 frame 위젯 가독성은 별도 작업.
- **A/B 테스트** — 전면 교체.

---

## 11. v0.4 Backlog (참조)

- daily narrative 톤 강화 (단정형 + 짧은 분량 유지하면서)
- prompt_version 컬럼을 모든 narrative 테이블에서 표준화 (v0.3.1 에서 yearly/monthly 만 추가)
- shared/ui/saju-narrative/ 의 design token 통일 (lifetime 컴포넌트 승격 시 자연스럽게 정리됨)
- yearly/monthly 의 schoolSpecific 와 lifetime 의 schoolSpecific 가 같은 union 이라 의미 narrowing 이 type 차원에서 안 됨 — 도메인별 distinct type 분리 검토
