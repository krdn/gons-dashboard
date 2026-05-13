# 사주 상세보기 페이지 — Design Spec

- **Date**: 2026-05-13
- **Scope**: 편 1 — 한자 사주 + 전체 사주 세그먼트 (팔자·십신·오행·격국·용신·대운 + LLM 해설 5섹션)
- **Non-goals (후속 spec)**: 세운(년도별), 궁합, 이름풀이, 일운 자동화
- **Status**: 사용자 승인 완료 (2026-05-13 brainstorm 세션)

## 1. 배경

현재 `widgets/fortune`은 PlayMCP `1fate-get_daily_fortune` 버그(longitude undefined)로 정적 스냅샷(`fortune-data.ts`)을 보여주는 데 그친다. 사용자는 어제(2026-05-12) PlayMCP에서 받은 1967-03-29 05:30 사주 풀이가 **한자 사주 비주얼·전체 분석·대운·세운**을 다 보여주는 형식이었음을 떠올려 동일한 깊이의 페이지를 대시보드 안에서 영구히 보고 싶어한다.

PlayMCP는 카카오 OAuth로 Claude.ai 클라이언트에만 노출된 MCP라 Next.js 백엔드에서 직접 호출 불가. 따라서 **결정적 사주 계산은 자체 구현**, **자연어 해설은 Anthropic 프록시(claude-opus-4-7)** 로 분리한다.

## 2. 데이터 흐름

```
fortune_profiles (기존)
   │  birthDate, birthTime, calendar, gender, birthCity
   ▼
packages/saju (신규 워크스페이스 패키지, 순수 함수)
   │  pillars / tenGods / elements / majorFortune
   ▼
saju_charts (신규, profile_id UNIQUE)   ←─ input_hash 비교 후 재생성
   │  결정적 계산 결과 캐시
   ▼
saju_readings (신규, (chart_id, section) UNIQUE)
   │  5개 섹션 LLM 해설 캐시 (overview/personality/career/health/major_fortune)
   ▼
/fortune/[profileId] (RSC) → widgets/saju-detail/* (dumb 컴포넌트)
```

## 3. 계산 레이어 — `packages/saju`

새 워크스페이스 패키지 (`@gons/saju`). dashboard와 미래 MCP 양쪽에서 공유 가능하도록 분리.

```
packages/saju/
├── src/
│   ├── pillars.ts       # birthDate+time → {year, month, day, hour} 각 {stem, branch}
│   ├── tenGods.ts       # 일간+타글자 → 십신 (比肩/劫財/食神/傷官/偏財/正財/偏官/正官/偏印/正印)
│   ├── elements.ts      # 8자 → 오행 분포 {木·火·土·金·水} + 강약 (신강/중화/신약)
│   ├── majorFortune.ts  # 성별+생일 → 대운 배열(10개) + 입대운 나이
│   ├── hanja.ts         # 천간/지지/십신/오행 한자↔한글 매핑 상수
│   └── types.ts         # SajuChart, Pillar, TenGod, Element, MajorFortune
├── package.json
└── tsconfig.json
```

**의존성**: 순수 TS. `pillars.ts` 내부에서만 만세력 라이브러리(`manseryeok` 1순위 후보 — Phase 0에서 평가) 의존. 나머지 모듈은 라이브러리 무관.

**공개 API**:

```ts
export interface Pillar { stem: string; branch: string; }
export interface SajuChart {
  pillars: { year: Pillar; month: Pillar; day: Pillar; hour: Pillar | null };
  elements: { wood: number; fire: number; earth: number; metal: number; water: number };
  tenGods: { yearStem: TenGod; yearBranch: TenGod; ... };
  pattern: string;       // 격국 예: '偏印格'
  yongSin: string[];     // 용신 예: ['金','土']
  majorFortunes: MajorFortune[]; // 10개
  inputHash: string;     // 캐시 키
}

export function computeSajuChart(input: {
  birthDate: string; birthTime: string | null;
  calendar: 'solar' | 'lunar'; gender: 'male' | 'female';
  birthCity: string | null;
}): SajuChart;
```

## 4. DB 스키마 (Drizzle migration 0007)

```sql
CREATE TABLE saju_charts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL UNIQUE REFERENCES fortune_profiles(id) ON DELETE CASCADE,
  input_hash      text NOT NULL,
  year_stem       char(1) NOT NULL,
  year_branch     char(1) NOT NULL,
  month_stem      char(1) NOT NULL,
  month_branch    char(1) NOT NULL,
  day_stem        char(1) NOT NULL,
  day_branch      char(1) NOT NULL,
  hour_stem       char(1),
  hour_branch     char(1),
  elements        jsonb NOT NULL,
  ten_gods        jsonb NOT NULL,
  pattern         text NOT NULL,
  yong_sin        text[] NOT NULL,
  major_fortunes  jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saju_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id    uuid NOT NULL REFERENCES saju_charts(id) ON DELETE CASCADE,
  section     text NOT NULL CHECK (section IN ('overview','personality','career','health','major_fortune')),
  body        text NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, section)
);
```

**캐시 키 / 무효화**

- 차트: `profile_id` UNIQUE. `input_hash` 불일치 시 → `DELETE FROM saju_charts WHERE profile_id=?` (CASCADE로 readings 함께 삭제) → 재생성
- readings: `(chart_id, section)` UNIQUE → 섹션별 UPSERT. `model != CURRENT_MODEL` 행은 일괄 무효화 가능
- 슬롯만 잡고 이번 spec에 안 넣음: `saju_yearly_readings(chart_id, year, body)`, `saju_compatibility(chart_a_id, chart_b_id, body)`

추가로 0007 마이그레이션에 `llm_spend_log` 테이블 신설 (섹션 5 참조) — saju 전용이 아니라 미래 LLM 기능 공용.

**무효화 트리거**: `features/fortune-profile-manage/api/updateFortuneProfile.ts`에서 birthDate/birthTime/calendar/gender/birthCity 변경 감지 시 `revalidateSajuChart(profileId)` 호출 (내부에서 hash 비교 + DELETE).

## 5. LLM 해설 파이프라인 — `features/saju-reading`

```
features/saju-reading/
├── api/
│   ├── generateChart.ts          # profile → SajuChart (계산만, LLM 안 부름)
│   ├── generateReading.ts        # (chart, section) → reading (LLM 호출 + 캐시)
│   └── ensureChartAndReadings.ts # 페이지 진입점, 5섹션 병렬 보장
├── lib/
│   ├── prompts.ts                # 섹션별 시스템/유저 프롬프트
│   └── hashProfile.ts            # 입력 해시 (SHA-256 of normalized fields)
└── index.ts
```

**섹션 5종 (편 1 범위)**

1. `overview` — 종합 풀이 (관인상생 같은 구조적 특징, ~300자)
2. `personality` — 성격·기질 (~200자)
3. `career` — 직업·적성 (~200자)
4. `health` — 건강 (오행 결함 기반, ~150자)
5. `major_fortune` — 대운 10개 한 줄씩 + 현재 대운 풀이 (~400자)

**프롬프트 규칙**

- 시스템: "당신은 명리학자입니다. 한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고, 사주 구조에서 도출되는 결론만 제시합니다."
- 유저: 섹션별 차트 JSON + 지시문. 차트 외 PII(이름·생일 원본·도시명)는 프롬프트에 직접 넣지 않음
- `temperature: 0.3` (결정적 톤)
- 모델: `SAJU_LLM_MODEL=claude-opus-4-7` (env)

**generateReading 흐름**

```
1. cache = SELECT * FROM saju_readings WHERE chart_id=? AND section=?
2. cache && cache.model === SAJU_LLM_MODEL → return cache.body
3. budget = SELECT SUM((payload->>'krw')::numeric) FROM llm_spend_log
                WHERE feature='saju' AND DATE(created_at)=today_kst
4. budget >= SAJU_LLM_DAILY_BUDGET_KRW → throw BudgetExceeded
5. anthropic.messages.create({...})
6. INSERT INTO llm_spend_log (feature, model, input_tokens, output_tokens, krw)
7. UPSERT INTO saju_readings (chart_id, section, body, model)
8. return body
```

`llm_spend_log` 테이블은 0007 마이그레이션에 함께 추가 — saju 전용으로 만들지 말고 미래 기능도 쓸 수 있게 `feature text NOT NULL` 컬럼으로 일반화:

```sql
CREATE TABLE llm_spend_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature       text NOT NULL,   -- 'saju' | 'email-classify' | ...
  model         text NOT NULL,
  input_tokens  integer NOT NULL,
  output_tokens integer NOT NULL,
  krw           numeric(10,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_spend_log_feature_day_idx
  ON llm_spend_log (feature, (date_trunc('day', created_at AT TIME ZONE 'Asia/Seoul')));
```

**ensureChartAndReadings 흐름**

```
1. chart = SELECT FROM saju_charts WHERE profile_id=?
2. computed = computeSajuChart(profile)
3. if (!chart || chart.input_hash !== computed.inputHash):
     DELETE FROM saju_charts WHERE profile_id=?  -- CASCADE drops readings
     INSERT INTO saju_charts (...computed)
     chart = computed
4. results = await Promise.allSettled([
     generateReading(chart, 'overview'),
     generateReading(chart, 'personality'),
     generateReading(chart, 'career'),
     generateReading(chart, 'health'),
     generateReading(chart, 'major_fortune'),
   ])
5. return { chart, readings: {section: body|null} }  -- 실패한 섹션은 null
```

부분 실패 허용 — 차트(계산값)는 항상 보임, 실패한 LLM 섹션만 `[해설 생성 실패 — 새로고침]` placeholder.

## 6. 페이지 / UI

**라우트**: `/fortune/[profileId]` (RSC, `dynamic = 'force-dynamic'`)
- ownership 가드: `profile.userId === session.user.id` 아니면 `notFound()`

**진입 동선 2곳**
1. 홈 위젯 `FortuneCardClient` — select 옆 `[상세][관리]` 링크 2개 (관리 옆에 상세 추가)
2. `/fortune` 페이지 `FortuneProfileCard` — 카드 우상단 '상세보기' 링크

**컴포넌트 트리** (`widgets/saju-detail`)

```
SajuDetailHeader        # 이름·관계·생년 + 백링크
SajuPillarsBoard        # 4주 한자 그리드 (메인 비주얼)
SajuElementsChart       # 오행 분포 막대/도넛
SajuTenGodsTable        # 십신 배치표
SajuPatternCard         # 격국·신강도·용신/기신
SajuMajorFortuneStrip   # 대운 10개 + 현재 대운 강조
SajuReadingSection      # 5개 해설 (overview/personality/career/health/major_fortune)
```

각 컴포넌트는 dumb — props만 받고 데이터 페치는 page.tsx의 `ensureChartAndReadings`.

**SajuPillarsBoard 비주얼**

```
┌──────────┬──────────┬──────────┬──────────┐
│  시주    │  일주    │  월주    │  연주    │
│ (時柱)   │ (日柱)   │ (月柱)   │ (年柱)   │
├──────────┼──────────┼──────────┼──────────┤
│   癸     │   丁     │   癸     │   丁     │  ← 천간 (text-4xl, font-hanja)
│  (계)    │  (정)    │  (계)    │  (정)    │  ← 한글 음 (text-xs)
│  편관    │   ─      │  편관    │  비견    │  ← 십신 라벨
├──────────┼──────────┼──────────┼──────────┤
│   卯     │   卯     │   卯     │   未     │  ← 지지
│  (묘)    │  (묘)    │  (묘)    │  (미)    │
│  편인    │  편인    │  편인    │  식신    │
└──────────┴──────────┴──────────┴──────────┘
```

- 일간(丁) 칸은 강조 (테두리 + accent 배경)
- 시맨틱 `<table>` + `<th scope="col">`, 한자에 `lang="ko-Hani"`
- 모바일: 가로 스크롤 대신 2×2 그리드 reflow (시-일 / 월-연)

**SajuMajorFortuneStrip**: 10개 가로 스트립, 각 칸 `간지(한자) + 한글음 + 시작 나이`. 현재 대운에 accent underline + '진행 중' 배지. 클릭 시 `major_fortune` 섹션의 해당 단락으로 스크롤.

**SajuReadingSection**: 5개 카드. `react-markdown` 의존성 추가. 우상단 작은 '재생성' 버튼은 `ADMIN_EMAILS` 매칭 시만 (server action에서도 재확인).

**디자인 토큰 (globals.css 추가)**

```css
--font-hanja: 'Noto Serif KR', 'Noto Serif TC', serif;
--color-wood:  oklch(70% 0.13 145);  /* 청록 */
--color-fire:  oklch(65% 0.20  30);  /* 적 */
--color-earth: oklch(70% 0.10  80);  /* 황 */
--color-metal: oklch(78% 0.02 250);  /* 백/은 */
--color-water: oklch(50% 0.12 250);  /* 흑/청 */
```

폰트: `<link rel="preconnect" href="https://fonts.googleapis.com">` + `font-display: swap`.

## 7. 환경 변수

```
SAJU_LLM_MODEL=claude-opus-4-7         # 옵셔널, 기본 claude-opus-4-7
SAJU_LLM_DAILY_BUDGET_KRW=1000         # 옵셔널, 기본 1000원
SAJU_LLM_TEMPERATURE=0.3               # 옵셔널, 기본 0.3
```

`shared/config/env.ts`에 Zod 옵셔널 필드 추가. `.env.example`에 주석 포함 등록.

## 8. 보안

- ownership 가드: `/fortune/[profileId]` RSC + 모든 server action에서 `profile.userId === session.user.id` 검증
- '재생성' server action: 클라이언트 가드 단독 금지, 서버에서도 `ADMIN_EMAILS` 매칭 재확인
- LLM 프롬프트: 차트 결정적 결과만, 이름·생일 원본·도시명 직접 안 넣음 (PII 최소화)
- `llm_spend_log` (feature='saju'): 모델·토큰수·KRW만 저장, 프롬프트 본문은 저장 안 함

## 9. 테스트 전략

| 계층 | 위치 | 내용 |
|------|------|------|
| Unit (계산) | `packages/saju/src/*.test.ts` | 골든 케이스 5종 — 1967-03-29 05:30 / 출생시 모름 / 절기 경계일 / 윤달 / 자정 직전 |
| Unit (LLM) | `features/saju-reading/api/*.test.ts` | anthropic mock, cache hit/miss, 모델 변경 시 무효화, 비용 가드 |
| Integration | `features/saju-reading/api/ensureChartAndReadings.integration.test.ts` | profile 수정 → input_hash 변경 → 차트·readings 무효화 + 재생성 (TEST_DATABASE_URL 필요) |
| E2E | — | 1차 PR은 안 함. 사용자 수동 검수 |

**골든 케이스 #1 (회귀 기준)**

```
입력: 1967-03-29 05:30, 양력, 남자, 도시 미정
기대:
  pillars = { year:{丁,未}, month:{癸,卯}, day:{丁,卯}, hour:{癸,卯} }
  elements = { wood:3, fire:2, earth:1, metal:0, water:2 }
  pattern = '偏印格'
  yongSin = ['金','土']
  majorFortunes[0] = { startAge:9, stem:'壬', branch:'寅' }
```

## 10. 롤아웃 — Phase / PR 분할

| Phase | 범위 | 산출물 | 검증 |
|-------|------|--------|------|
| **0** | `packages/saju` + 만세력 라이브러리 평가 | npm 패키지 평가 보고서 + 골든 케이스 통과 | `pnpm --filter @gons/saju test` |
| **1** | DB 0007 + `features/saju-reading` + `ensureChartAndReadings` | 마이그레이션 + LLM mock 테스트 통과 | `pnpm typecheck` / `pnpm test` / dev DB 마이그레이션 |
| **2** | `/fortune/[profileId]` + 6개 widgets + 진입 링크 | 운영 배포 + 사용자 수동 검수 | `pnpm build` + health check |
| **3 (후속)** | 세운 (`saju_yearly_readings`, 년도 선택 UI) | 별도 spec |
| **4 (후속)** | 궁합 (`saju_compatibility`, 프로필 2인 선택 UI) | 별도 spec |

이번 spec은 Phase 0~2까지만.

## 11. 만세력 라이브러리 평가 (Phase 0 진입 게이트)

1순위 후보: `manseryeok` (Korean). 대안: `korean-lunar-calendar`, `lunar-javascript`.

평가 단계:
1. 3개 패키지를 sandbox에서 골든 케이스 5종 실행
2. 4주 결과 비교표를 spec 부록으로 기록
3. 1위 선정 + 결정 근거. 2위는 폴백 후보로 spec에 기록
4. **모두 1개 이상 케이스에서 틀리면 → escape hatch**: 절기 시각 테이블 JSON 직접 임베드 (1~2일 추가)

## 12. 리스크

| # | 리스크 | 완화 |
|---|--------|------|
| R1 | 만세력 라이브러리 정확도 부족 | 평가 단계 진입 게이트 + 절기 테이블 임베드 escape hatch |
| R2 | LLM 비용 폭주 | 일별 KRW 가드 + `events` 테이블 합산 + 영구 캐시 |
| R3 | 한자 폰트 FOUT | preconnect + `font-display: swap` |
| R4 | `input_hash` 충돌(도시 표기 흔들림) | 정규화 함수 `trim().toLowerCase()` 후 hash |
| R5 | 출생시 모르는 프로필 | hour pillar null 허용. 일/시주 의존 해설(major_fortune 일부)은 "출생시 불명으로 정확도 제한" 디스클레이머 표시 |

## 13. 통합 체크 (CLAUDE.md Gotcha 대조)

| Gotcha | 영향 / 대응 |
|--------|------|
| #1 client barrel server-only 누출 | `packages/saju`는 순수, server-only API 없음. dumb 위젯들은 deep import로 받음 |
| #2 TEST_DATABASE_URL | integration 테스트 1개 추가. 기존 13개 ECONNREFUSED 패턴 동일 |
| #3 locale hydration mismatch | 한자/한글 음은 locale-free. 출생일 표시는 기존 `formatYMD` 재사용 |
| #4 Compose 자동등록 | 무관 |
| #5 Drizzle hidden-thrash | 무관 (project 도메인 아님) |
| #6 OAuth refreshAccountTokens | 무관 (Google scope 변경 없음) |

CI / docker-compose / GHA 변경 없음. env 3개 추가만.

## 14. 비-목표

- 일운(오늘의 운세) 자동화 — 현행 `fortune-data.ts` 정적 스냅샷 유지
- 세운(매년 운세) — Phase 3 (후속 spec)
- 궁합(프로필 2인) — Phase 4 (후속 spec)
- 이름풀이
- PlayMCP 자동 호출 (구조적으로 차단)

## 15. 결정 근거 요약

| 결정 | 이유 |
|------|------|
| `packages/saju`를 워크스페이스 패키지로 | dashboard / 미래 MCP 양쪽 공유. 계산은 순수 함수라 분리해도 비용 없음 |
| 차트와 해설 테이블 분리 | 결정적 vs 비결정적. 모델 변경 시 readings만 무효화. 섹션 단위 부분 캐시 미스 허용 |
| 한자 큰 + 한글 음 작은 표기 | 사용자 합의 (전통적 느낌 + 가독성). hover/툴팁 의존 안 함 |
| LLM 해설 영구 캐시 | 원국은 평생 불변. 프로필 변경 시만 hash 기반 무효화 |
| 라이브러리 의존 (직접 절기 테이블 X) | YAGNI — 평가 단계에서 만족스러우면 그걸로. 안 되면 escape hatch |
| Phase 분할 PR 3개 | 각 PR이 typecheck/lint/test 통과 가능한 작은 단위. Phase 0이 가장 큰 리스크라 먼저 분리 |
