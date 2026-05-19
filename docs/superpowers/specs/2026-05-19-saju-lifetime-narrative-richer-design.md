# Saju Lifetime Narrative v0.2 — Richer Edition 설계

- 작성일: 2026-05-19
- 작성자: gon + Claude Code (brainstorming)
- 상태: DESIGN (구현 전 spec)
- 대상: `apps/dashboard/src/features/saju-lifetime-tri/` 의 LLM narrative 시스템

## 1. 배경과 목표

### 1.1 현황

사주 삼국 분석 v0.1 의 평생 운세 (lifetime) narrative 는 4학파 (한국식·자평진전·맹파·일본 추명학) 관점으로 각 1줄짜리 system prompt 를 사용해 LLM 으로 생성된다. 결과는 본문 평균 400~500자 / 5문단 / 각 섹션 2~3줄.

운영 검증 결과 (김석곤 프로파일 기준) 다음 한계가 드러났다.

1. **분량 부족** — 각 섹션이 2~3줄에 그쳐 깊이 있는 설명 부족
2. **전문 용어 무설명** — `傷官格`, `怪罡`, `桃花`, `木旺水强` 같은 한자/명리 용어가 비전문가에게 벽
3. **실전 행동 지침 부족** — "이런 성향이다" 까지는 있지만 "그래서 어떻게 하라" 가 없음
4. **4학파 차별점 흐림** — 한국/자평/맹파/추명 탭의 톤이 비슷해 학파 고유 관점이 안 드러남

### 1.2 목표

각 학파 탭의 narrative 를 **비전문가가 깊이 이해하고 실제로 행동에 적용 가능한** 분석으로 확장.

| 지표 | v0.1 | v0.2 |
|---|---|---|
| 본문 분량 | 400~500자 | 1500~2000자 (3배) |
| 용어 풀이 | 없음 | 인라인 괄호 + 별도 keyTerms 배열 |
| 실전성 | 경향성 일반론만 | personality=경향성 / career·rel·health=장면 행동 / daeun=타이밍 (3층) |
| 학파 차별화 | 톤만 다름 | schoolSpecific 필드가 학파별로 다름 + 프롬프트 가이드 30~50줄 |
| max_tokens | 4096 | 8192 |

### 1.3 의사결정 요약

- **B 안 (스키마 확장 + 학파별 구조화 프롬프트)** 채택. A 안 (프롬프트만 강화) 은 일관성 보장 어려움, C 안 (다단계 LLM 호출) 은 비용·지연 3배 부담.
- **PROMPT_VERSION 키 추가** 로 자연스러운 캐시 무효화 (TRUNCATE 안 함, 프로파일별 수동 무효화 안 함).
- **전면 교체** (A/B 없음, feature flag 없음).
- **3층 실전성 분배**: personality = 경향성 / career·rel·health = 생활 장면 구체 행동 / daeunSummary = 운세 타이밍.

## 2. 출력 스키마 변경

### 2.1 공통 sections 확장

```typescript
// v0.1
sections: {
  personality: string;
  career: string;
  relationship: string;
  health: string;
  daeunSummary: string;
}

// v0.2 — 기존 5개 분량만 늘림 (각 200~350자) + 신규 2개
sections: {
  personality: string;     // 200~350자 — 경향성·기질 (일반론)
  career: string;          // 200~350자 — 직업 장면 구체 행동
  relationship: string;    // 200~350자 — 관계 장면 구체 행동
  health: string;          // 200~350자 — 건강 관리 구체 행동·계절성
  daeunSummary: string;    // 200~350자 — 대운 흐름 타이밍

  keyTerms: Array<{ term: string; gloss: string }>;
  // 본문 내 등장한 핵심 명리 용어 5~8개를 별도로 모음
  // UI 가 hover tooltip / 상단 칩 스트립으로 재사용
  // 예: { term: "傷官格", gloss: "상관격 — 자신의 재능을 밖으로 표출하려는 기질" }

  cautions: string[];      // 1~3개 — 메타 라벨 (기존 스크린샷의 "주의: 신살 ..." 자리)
}
```

### 2.2 학파별 schoolSpecific (학파마다 다름)

```typescript
// ko (한국식 자평 + 조후 + 신살)
schoolSpecific: {
  joohuFocus: string;       // 70~120자 — 보완해야 할 오행과 그 근거 (조후론)
  shinsalNotes: string[];   // 등장 신살별 해석 (각 1~2문장)
}

// cn-ziping (자평진전·적천수)
schoolSpecific: {
  gyeokgukRationale: string;  // 격국 성립/파괴 조건의 철학적 근거
  yongshinAnalysis: string;   // 용신 후보 비교와 채택 이유
}

// cn-mangpai (맹파 단건업)
schoolSpecific: {
  eventTimings: Array<{
    period: string;            // "30~35세 戊辰 대운"
    event: string;             // "재물 변동 또는 가족 변고"
  }>;
}

// jp (일본 추명학)
schoolSpecific: {
  palaceMap: Array<{
    palace: string;            // "命宮(명궁 — 본인의 본질)"
    note: string;
  }>;
}
```

### 2.3 Zod 스키마 (학파별 discriminated)

```typescript
const baseOutputSchema = z.object({
  narrativeText: z.string().min(1500).max(2500),
  sections: z.object({
    personality: z.string().min(200),
    career: z.string().min(200),
    relationship: z.string().min(200),
    health: z.string().min(200),
    daeunSummary: z.string().min(200),
    keyTerms: z.array(z.object({
      term: z.string(),
      gloss: z.string(),
    })).min(3).max(10),
    cautions: z.array(z.string()).max(5),
  }),
  citations: z.array(z.string()).min(2),
});

const koSchema = baseOutputSchema.extend({
  schoolSpecific: z.object({
    joohuFocus: z.string(),
    shinsalNotes: z.array(z.string()),
  }),
});
// ziping / mangpai / jp 동일 패턴

const SCHOOL_SCHEMAS: Record<NarrativeSchool, ZodSchema> = {
  ko: koSchema,
  "cn-ziping": zipingSchema,
  "cn-mangpai": mangpaiSchema,
  jp: jpSchema,
};
```

## 3. 학파별 프롬프트 설계

### 3.1 공통 헤더 (전 학파 system prompt 앞에 붙음)

```
당신은 30년 경력의 사주 명리학 전문가입니다. 비전문가 사용자에게
자신의 명조를 깊이 이해시키는 것이 목표입니다.

[작성 원칙]
1. 분량: narrativeText 전체 1500~2000자 (5문단). 각 sections 필드는
   200~350자.
2. 용어 풀이: 한자 용어/명리 전문어가 처음 등장할 때 인라인 괄호로
   풀어 설명. 예: 傷官格(상관격 — 자신의 재능을 밖으로 표출하려는
   기질), 怪罡(괴강 — 강한 자존심과 결단력을 가진 살). 두 번째
   등장부터는 풀이 생략.
3. 섹션별 3층 구조:
   - personality: 경향성·기질 (일반론, "당신은 ~한 사람입니다")
   - career: 직업 장면 구체 행동 ("회의에서 ~할 때 ~하세요")
   - relationship: 관계 장면 구체 행동
   - health: 건강 관리 구체 행동·계절성·식단
   - daeunSummary: 대운 흐름의 시간대별 타이밍
4. 행동 지침은 "그래서 어떻게" 의 수준까지. 추상적 조언("균형 잡으세요")
   금지. 상황·시간·대상을 명시.
5. citations: 인용한 고전/전적의 편명까지 명시. 최소 2개.
```

### 3.2 학파별 차별화 (관점 + 용어 + schoolSpecific 필드)

**ko (한국식)** — 조후 + 신살 비중 강화. 박재완·박청화 임상 사주 톤. `joohuFocus` + `shinsalNotes` 강제. 자평진전 원전 인용 금지, 응기 시점 단정 금지.

**cn-ziping (자평진전)** — 격국·용신 철학적 근거 중심. 적천수·자평진전 인용. `gyeokgukRationale` + `yongshinAnalysis` 강제. 신살 깊이 다루기 금지, 응기 시점 단정 금지.

**cn-mangpai (맹파)** — 응기 시점 + 사건성 단어. 단건업 톤. `eventTimings` 배열 강제. 단정형 ("~한다", "~할 가능성이 높다" 약화 표현 금지). 격국 철학 토론 금지.

**jp (추명학)** — 12궁 단위 처세 분석. 통변성 중심. 高木乘 계열 톤. `palaceMap` 배열 강제 (12궁 중 명조에 의미 있는 5~8개). 격국·신살 깊이 다루기 금지.

### 3.3 사용자 메시지 (user content)

기존 cli-proxy 회피 패턴 유지 — JSON 스키마 지시를 user message 본문에 박는다.

```
명조 분석:
{frame JSON}

위 명조를 다음 JSON 스키마로만 답하세요. 마크다운, 펜스, prose 금지.
'{' 로 시작 '}' 로 끝:
{
  "narrativeText": "1500~2000자 5문단",
  "sections": { ... },
  "schoolSpecific": { ... 학파별 다름 ... },
  "citations": ["출처1", "출처2"]
}
```

### 3.4 프롬프트 관리

```
apps/dashboard/src/features/saju-lifetime-tri/api/prompts.ts (신규)
├── PROMPT_VERSION = 2
├── COMMON_HEADER (위 3.1 텍스트)
└── SCHOOL_PROMPTS: Record<NarrativeSchool, string>
    ├── ko (COMMON_HEADER + 학파 가이드 30~50줄)
    ├── cn-ziping
    ├── cn-mangpai
    └── jp
```

## 4. UI 변경

### 4.1 구조

```
TriNationTabs (탭 컨테이너 — 변경 최소)
└── 활성 학파:
    LifetimeFrameCard (격국·직업·관계·건강·주의 메타 — 그대로)
    ├── KeyTermsStrip            ← 상단, 인라인 풀이 backup
    ├── NarrativeSection × 5     ← personality / career / rel / health / daeun
    ├── SchoolSpecificCard       ← 학파별 분기 렌더
    │   ├── ko: JoohuFocus + ShinsalNotes
    │   ├── ziping: GyeokgukRationale + YongshinAnalysis
    │   ├── mangpai: EventTimings 타임라인
    │   └── jp: PalaceMap 12궁 그리드
    └── CitationsFootnote        ← 하단, 출처 인용
```

### 4.2 신규 컴포넌트 5종

```
apps/dashboard/src/features/saju-lifetime-tri/ui/
├── KeyTermsStrip.tsx           # client (hover tooltip)
├── NarrativeSection.tsx        # RSC
├── CitationsFootnote.tsx       # RSC
└── school-specific/
    ├── SchoolSpecificCard.tsx  # RSC — discriminated union 분기
    ├── KoSchoolDetail.tsx
    ├── ZipingSchoolDetail.tsx
    ├── MangpaiSchoolDetail.tsx
    └── JpSchoolDetail.tsx
```

### 4.3 디자인 토큰

기존 토큰 그대로 (`--color-hairline`, `--color-surface`, `--color-surface-2`, `--color-text-secondary`). 새 색상 토큰 도입 안 함. 라이트 모드 고정.

### 4.4 접근성 (Polish A a11y 와 일관)

- NarrativeSection h4 는 `aria-level={4}` 명시
- KeyTermsStrip 은 `role="list"` + 각 term `role="listitem"`
- SchoolSpecificCard 의 학파별 detail 은 시맨틱 `<dl>` 또는 `<table>` (12궁의 경우)
- 색상 대비 4.5:1 유지

## 5. API + 캐시 + 마이그레이션

### 5.1 라우트 — 응답 본문에 필드 추가

```typescript
// 현재
{ school, narrativeText, sections, citations, modelId, generatedAt, fromCache }

// v0.2
{ school, narrativeText, sections, schoolSpecific, citations,
  modelId, promptVersion, generatedAt, fromCache }
```

기존 클라이언트가 모르는 필드 무시 → 호환 안전.

### 5.2 narrative-server.ts 변경 요약

- `MAX_NARRATIVE_TOKENS = 8192` (4096 → 8192)
- `SCHOOL_PROMPT` (1줄 dict) 제거 → `SCHOOL_PROMPTS` import (`./prompts`)
- 캐시 조회/저장 키에 `promptVersion` 추가
- `narrativeOutputSchema` 단일 → 학파별 `SCHOOL_SCHEMAS[school]`
- 반환값에 `schoolSpecific`, `promptVersion` 추가

### 5.3 Drizzle 스키마

```typescript
sajuLifetimeNarrative = pgTable("saju_lifetime_narrative", {
  // ... 기존 컬럼
  promptVersion: integer("prompt_version").notNull().default(1),
  schoolSpecificJsonb: jsonb("school_specific_jsonb").$type<SchoolSpecific>(),
}, (t) => ({
  uniqueRow: uniqueIndex("saju_lifetime_narrative_unique_idx")
    .on(t.profileId, t.school, t.frameHash, t.modelId, t.promptVersion),
}));
```

### 5.4 마이그레이션 SQL

```sql
ALTER TABLE saju_lifetime_narrative
  ADD COLUMN prompt_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN school_specific_jsonb JSONB;

DROP INDEX IF EXISTS saju_lifetime_narrative_unique_idx;
CREATE UNIQUE INDEX saju_lifetime_narrative_unique_idx
  ON saju_lifetime_narrative (profile_id, school, frame_hash, model_id, prompt_version);
```

### 5.5 캐시 무효화 전략

- 기존 row (`prompt_version=1`) 유지 (감사 + 비교)
- 새 narrative 는 `prompt_version=2` 로 적재
- 한 명조에 v1/v2 두 row 공존 가능 (5KB × 2 학파 = 무시 가능)
- 향후 v3 도 동일 패턴 (`PROMPT_VERSION = 3` bump)

### 5.6 배포 순서

```bash
# 1. PR 머지 후 GHA Build & Push 완료 대기
gh run watch

# 2. 마이그레이션 적용 (운영 DB) — 코드 배포보다 먼저!
I_KNOW_THIS_IS_PROD=1 pnpm db:migrate

# 3. 도커 새 이미지 받기·교체
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d app cron

# 4. 헬스체크
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"

# 5. 브라우저 검증 (4탭, 본문 분량, schoolSpecific 분기)
```

### 5.7 롤백

- **빠른 롤백**: `PROMPT_VERSION = 1` 로 되돌리고 도커 재배포. DB schema 는 유지 (`DEFAULT 1` 호환).
- **완전 롤백**: schema migration 도 revert 가능하지만 컬럼 추가만 했으므로 불필요. v2 row 무해.

## 6. Phase 분해 + 검증 게이트

### Phase 1 — DB schema + migration

**파일:**
- `apps/dashboard/src/shared/lib/db/schema.ts`
- `apps/dashboard/drizzle/<NNNN>_richer_narrative.sql` (`pnpm db:generate` 산출)

**게이트:**
- `pnpm db:generate` 결과 검토
- `pnpm typecheck`
- 로컬 테스트 DB INSERT/SELECT 동작 확인

### Phase 2 — 프롬프트 + 학파별 zod 스키마

**파일:**
- `apps/dashboard/src/features/saju-lifetime-tri/api/prompts.ts` (신규)
- `apps/dashboard/src/features/saju-lifetime-tri/api/schemas.ts` (신규)

**게이트:**
- `pnpm typecheck`
- 학파별 schema 가 mock JSON 응답 통과 단위 테스트

### Phase 3 — narrative-server 갱신

**파일:**
- `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts`
- `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.test.ts`

**게이트:**
- 단위 테스트 통과 (anthropic SDK `vi.mock`)
- `pnpm typecheck` + `pnpm lint`

### Phase 4 — UI 본문 컴포넌트

**파일:**
- `ui/KeyTermsStrip.tsx`, `ui/NarrativeSection.tsx`, `ui/CitationsFootnote.tsx` (신규)
- `ui/LifetimeFrameCard.tsx` 갱신

**게이트:**
- `pnpm typecheck` + `pnpm lint`
- 로컬 dev visual 확인 (분량 확장 시각 확인)

### Phase 5 — UI 학파별 detail

**파일:**
- `ui/school-specific/SchoolSpecificCard.tsx` + 4개 학파별 컴포넌트 (신규)
- `ui/LifetimeFrameCard.tsx` 에 SchoolSpecificCard 추가

**게이트:**
- `pnpm typecheck` + `pnpm lint`
- 4탭 visual 확인 (학파별 detail 분기)

### 통합 게이트

- 4탭 전체 렌더 확인
- v2 결과 확인 위해 로컬 DB `DELETE FROM saju_lifetime_narrative WHERE profile_id = '<test>'` 후 재호출
- 운영 배포 순서 (5.6) 준수

## 7. 비용 영향

- max_tokens 4096 → 8192: 출력 비용 2배
- 입력 (system prompt) 1줄 → 약 1500자: 입력 비용 약 5배 (입력은 출력의 1/3 → 총 약 2.5배)
- 캐시 hit rate 매우 높음 (frame 안 변함) → 정상 운영 비용은 1회성
- 김석곤 1명: 4학파 × 1회 = 약 $0.4 (Opus 기준 추정)

## 8. 범위 외 (의도적 제외)

- yearly/monthly narrative 적용 안 함 (이번엔 lifetime 만)
- A/B 테스트, feature flag (전면 교체)
- LLM 자가 비평 다단계 호출 (C 안 기각)
- 새 디자인 토큰·색상 (라이트 모드 + 기존 일관성)
- E2E 테스트 (v0.1 도 미추가)

## 9. 향후 v3 후보 (이번 spec 범위 외)

- yearly/monthly narrative 에 동일 패턴 확장
- 학파 간 cross-check 강화 (v0.1 의 verifyConsensus 외에 narrative 수준 비교)
- 명조 도식 (오행 비율 차트, 12궁 시각화) 자동 생성
- daeun 구간별 narrative 분리 (현재는 daeunSummary 1개로 통합)

## 10. 참고 문서

- v0.2 yearly spec: `docs/superpowers/specs/2026-05-18-saju-tri-yearly-design.md` (관련 참고)
- 사주 삼국 분석 v0.1: `docs/superpowers/specs/2026-05-16-saju-tri-nation-analysis-design.md`
- 캐시 무효화 패턴: `apps/dashboard/src/features/saju-lifetime-tri/api/narrative-server.ts` 의 `SCHEMA_VERSION 별도 정책 없음` 주석 (이번 spec 으로 해소)
- cli-proxy JSON 강제 회피: 동 파일의 user message 본문 스키마 지시 (유지)
