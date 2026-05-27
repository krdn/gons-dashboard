# @krdn/saju 패키지 분리 설계 — 멀티프로젝트 재사용 라이브러리

**작성일**: 2026-05-27
**상태**: Draft → 사용자 리뷰 대기
**범위**: 사주 계산 + 프롬프트 + 스키마를 독립 GitHub 레포/패키지로 분리
**관련 spec**:
- `docs/superpowers/specs/2026-05-16-saju-tri-nation-analysis-design.md` (삼국 분석 원본 설계)
- `docs/superpowers/specs/2026-05-19-saju-tri-monthly-daily-design.md` (monthly/daily 확장)
- 메모리: `decision-monorepo-kept-2026-05-15` (재논의 트리거 — 외부 소비자 2개 이상)

---

## 1. 목적과 배경

### 1.1 동기

현재 사주 코드가 두 프로젝트에 **중복 구현**되어 있다:

| 프로젝트 | 위치 | 구현 방식 |
|----------|------|-----------|
| gons-dashboard | `packages/saju/` + `features/saju-*-tri/` | `@gons/saju` 워크스페이스 패키지 + dashboard 내 프롬프트/스키마/LLM 호출 |
| ai-afterschool-fsd | `features/analysis/saju/saju.ts` (312줄) | 계산 엔진 자체 재구현, 학생 맞춤 프롬프트 6종 |

문제:
- afterschool이 `packages/saju`를 사용하지 못함 — 같은 모노레포가 아니라 import 불가
- 사주 계산 로직이 두 곳에서 독립 유지보수 → 버그 수정이 한쪽만 반영되는 위험
- 프롬프트 버전 관리가 dashboard에 묶여 있어 다른 프로젝트가 재사용 불가
- 향후 신규 프로젝트마다 같은 코드를 복사해야 함

### 1.2 재논의 트리거 충족

`decision-monorepo-kept-2026-05-15`에서 정의한 재논의 트리거:
> "외부 소비자가 2개 이상일 때"

현재 소비자: gons-dashboard, ai-afterschool-fsd, + 향후 신규 프로젝트. 트리거 충족.

### 1.3 목표

- 사주 계산 + 프롬프트 + Zod 스키마를 **단일 독립 패키지** (`@krdn/saju`)로 분리
- **LLM SDK 비의존** — 소비자가 자체 LLM SDK로 호출 (dashboard: `@krdn/llm-gateway`, afterschool: `@ai-sdk/*`)
- **DB/인증 비의존** — 캐시·인증은 소비자가 주입
- 기존 `@krdn/llm-gateway`와 동일한 배포 패턴 (GitHub Packages, tarball)

---

## 2. 패키지 경계

### 2.1 포함 (In-scope)

| 영역 | 설명 |
|------|------|
| 계산 엔진 | 천간지지 변환, 오행 균형, 십성 배정, 대운 계산, 공망 |
| 학파별 어댑터 | 한국(조후+신살), 중국 자평(격국+용신), 중국 맹파(응기+사건성), 일본(12궁+통변성) |
| 프레임 빌더 | lifetime/yearly/monthly/daily 4시간축 프레임 구조화 |
| 프레임 해시 | SHA256 기반 캐시 키 생성 (소비자가 캐시 전략에 활용) |
| 프롬프트 템플릿 | 4시간축 × 4학파 = 16 프롬프트 (시스템 + 사용자 메시지) |
| Zod 응답 스키마 | LLM 응답 파싱·검증 (학파별 schoolSpecific union 포함) |
| 상수 | `ALGORITHM_VERSION`, `PROMPT_VERSIONS` (캐시 무효화 키) |

### 2.2 포함하지 않음 (Out-of-scope)

| 영역 | 이유 | 소비자 책임 |
|------|------|-------------|
| LLM SDK 호출 | 프로젝트마다 SDK가 다름 | `@krdn/llm-gateway`, `@ai-sdk/*` 등 |
| DB/ORM | 프로젝트마다 DB 스택이 다름 | Drizzle, Prisma 등 |
| 캐시 저장소 | DB 테이블 설계는 소비자 결정 | Redis, PostgreSQL 등 |
| 인증 | 프로젝트마다 인증 체계가 다름 | NextAuth, 자체 인증 등 |
| HTTP 라우트 | API 설계는 소비자 결정 | Next.js API routes 등 |
| Rate limiting | 소비자 인프라 의존 | 자체 구현 |
| 도메인 특화 프롬프트 | afterschool 학생 분석 등은 소비자 영역 | 패키지 프롬프트 위에 레이어링 |

---

## 3. 아키텍처

### 3.1 소비자 통합 패턴

```
@krdn/saju (패키지)
  ┌──────────────────────────────────────────────┐
  │  computeSajuChart()  →  SajuChart            │
  │  buildXxxFrame()     →  Frame + hash         │
  │  buildXxxPrompt()    →  { system, user }     │
  │  xxxResponseSchema   →  Zod validator        │
  │  ALGORITHM_VERSION, PROMPT_VERSIONS          │
  └──────────────────────────────────────────────┘
              │                    │
    ┌─────────┴─────────┐  ┌─────┴──────────────┐
    │  gons-dashboard    │  │  ai-afterschool    │
    │  ───────────────   │  │  ──────────────    │
    │  @krdn/llm-gateway │  │  @ai-sdk/*         │
    │  Drizzle + PG      │  │  Prisma + PG       │
    │  NextAuth          │  │  자체 인증           │
    │  캐시 테이블 4종     │  │  자체 캐시           │
    └────────────────────┘  └────────────────────┘
```

### 3.2 소비자 코드 예시

```typescript
import {
  computeSajuChart,
  buildLifetimeFrame,
  buildLifetimePrompt,
  lifetimeResponseSchema,
  computeFrameHash,
  PROMPT_VERSIONS,
} from "@krdn/saju";

// 1. 계산
const chart = computeSajuChart({ birthDate, birthTime, gender, calendar });

// 2. 프레임 구성
const frame = buildLifetimeFrame(chart, "ko");
const cacheKey = `${computeFrameHash(frame)}:${PROMPT_VERSIONS.lifetime}`;

// 3. 캐시 확인 (소비자 DB)
const cached = await myDb.findNarrative(cacheKey);
if (cached) return cached;

// 4. 프롬프트 획득
const { system, user, schema } = buildLifetimePrompt(frame, "ko");

// 5. LLM 호출 (소비자 SDK)
const raw = await myLlm.generate({ system, user });

// 6. 응답 검증
const parsed = lifetimeResponseSchema.parse(JSON.parse(raw));

// 7. 캐시 저장 (소비자 DB)
await myDb.saveNarrative(cacheKey, parsed);
```

### 3.3 프롬프트 확장 훅

소비자가 도메인 특화 프롬프트를 올릴 수 있는 열린 구조:

```typescript
// afterschool 예시: 학생 맞춤 레이어
const base = buildLifetimePrompt(frame, "ko");
const studentPrompt = `${formatStudentInfo(student)}\n\n${base.user}\n\n학습 유형 분석도 포함해주세요.`;
const result = await aiSdk.generateText({ system: base.system, prompt: studentPrompt });
```

패키지는 프롬프트를 "닫힌 블랙박스"가 아니라 "조합 가능한 빌딩블록"으로 제공.

---

## 4. 디렉토리 구조

```
krdn/saju/                          # GitHub 레포
├── src/
│   ├── core/                       # 계산 엔진
│   │   ├── chart.ts                # computeSajuChart
│   │   ├── pillars.ts              # 천간지지 변환, 공망
│   │   ├── ten-gods.ts             # 십성 배정
│   │   ├── five-elements.ts        # 오행 균형 분석
│   │   ├── major-fortune.ts        # 대운 계산
│   │   └── schools/                # 학파별 어댑터
│   │       ├── ko.ts               # 한국 (조후 + 신살)
│   │       ├── cn-ziping.ts        # 중국 자평 (격국 + 용신)
│   │       ├── cn-mangpai.ts       # 중국 맹파 (응기 + 사건성)
│   │       └── jp.ts               # 일본 (12궁 + 통변성)
│   │
│   ├── frames/                     # 프레임 빌더 (LLM 입력 구조화)
│   │   ├── lifetime.ts             # buildLifetimeFrame
│   │   ├── yearly.ts               # buildYearlyFrame
│   │   ├── monthly.ts              # buildMonthlyFrame
│   │   ├── daily.ts                # buildDailyFrame
│   │   └── hash.ts                 # computeFrameHash (SHA256)
│   │
│   ├── prompts/                    # 프롬프트 템플릿
│   │   ├── system.ts               # 공통 시스템 프롬프트
│   │   ├── common.ts               # COMMON_HEADER, 캐릭터 카운트 가이드
│   │   ├── lifetime/               # 시간축별 × 학파별
│   │   │   ├── ko.ts
│   │   │   ├── cn-ziping.ts
│   │   │   ├── cn-mangpai.ts
│   │   │   └── jp.ts
│   │   ├── yearly/
│   │   │   └── (동일 4파일)
│   │   ├── monthly/
│   │   │   └── (동일 4파일)
│   │   └── daily/
│   │       └── (동일 4파일)
│   │
│   ├── schemas/                    # Zod 응답 스키마
│   │   ├── common.ts               # 공통 필드 (narrativeText, sections, citations)
│   │   ├── lifetime.ts             # lifetimeResponseSchema
│   │   ├── yearly.ts               # yearlyResponseSchema
│   │   ├── monthly.ts              # monthlyResponseSchema
│   │   └── daily.ts                # dailyResponseSchema
│   │
│   ├── types.ts                    # 공개 타입
│   ├── constants.ts                # ALGORITHM_VERSION, PROMPT_VERSIONS
│   └── index.ts                    # public API barrel
│
├── tests/
│   ├── core/                       # 계산 엔진 테스트
│   ├── frames/                     # 프레임 빌더 테스트
│   ├── prompts/                    # 프롬프트 스냅샷 테스트
│   └── schemas/                    # 스키마 검증 테스트
│
├── package.json
├── tsconfig.json
├── tsup.config.ts                  # ESM + CJS 듀얼 빌드
├── vitest.config.ts
├── CHANGELOG.md
├── CLAUDE.md
└── README.md
```

---

## 5. Public API

### 5.1 계산

```typescript
export function computeSajuChart(input: SajuInput): SajuChart;
export function hashProfile(input: SajuInput): string;
```

### 5.2 프레임 빌더

```typescript
export function buildLifetimeFrame(chart: SajuChart, school: School): LifetimeFrame;
export function buildYearlyFrame(chart: SajuChart, school: School, year: number): YearlyFrame;
export function buildMonthlyFrame(chart: SajuChart, school: School, year: number, month: number): MonthlyFrame;
export function buildDailyFrame(chart: SajuChart, school: School, date: string): DailyFrame;
export function computeFrameHash(frame: AnyFrame): string;
```

### 5.3 프롬프트

```typescript
export function buildLifetimePrompt(frame: LifetimeFrame, school: School): PromptBundle;
export function buildYearlyPrompt(frame: YearlyFrame, school: School): PromptBundle;
export function buildMonthlyPrompt(frame: MonthlyFrame, school: School): PromptBundle;
export function buildDailyPrompt(frame: DailyFrame, school: School): PromptBundle;
```

### 5.4 스키마

```typescript
export { lifetimeResponseSchema, yearlyResponseSchema, monthlyResponseSchema, dailyResponseSchema };
```

### 5.5 타입

```typescript
export type School = "ko" | "cn-ziping" | "cn-mangpai" | "jp";
export type PromptBundle = { system: string; user: string; schema: z.ZodType };
export type SajuInput = {
  birthDate: string;
  birthTime?: string;
  gender: "M" | "F";
  calendar: "solar" | "lunar";
};
export type SajuChart = { /* 4기둥, 오행, 십성, 대운 등 */ };
export type LifetimeFrame = { /* 학파별 lifetime 분석 데이터 */ };
export type YearlyFrame = { /* + 세운 데이터 */ };
export type MonthlyFrame = { /* + 월운 데이터 */ };
export type DailyFrame = { /* + 일운 데이터 */ };
export type AnyFrame = LifetimeFrame | YearlyFrame | MonthlyFrame | DailyFrame;
```

### 5.6 상수

```typescript
export const ALGORITHM_VERSION: string;
export const PROMPT_VERSIONS: {
  lifetime: number;
  yearly: number;
  monthly: number;
  daily: number;
};
```

---

## 6. 배포

### 6.1 레지스트리

- **GitHub Packages** (private, `@krdn` scope)
- 기존 `@krdn/llm-gateway`와 동일 패턴: `"@krdn/saju": "github:krdn/saju#v1.0.0"`
- CI: GitHub Actions로 태그 push 시 자동 빌드·퍼블리시

### 6.2 소비자 설치

```bash
# .npmrc (이미 @krdn/llm-gateway 사용 중이면 설정 완료)
@krdn:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}

# 설치
pnpm add @krdn/saju@github:krdn/saju#v1.0.0
```

### 6.3 버전 관리

- Semantic Versioning (semver)
- 계산 알고리즘 변경 → minor (프레임 해시가 바뀌므로 캐시 자동 무효화)
- 프롬프트 변경 → minor (PROMPT_VERSIONS 상수가 바뀌므로 캐시 자동 무효화)
- Breaking API 변경 → major
- 의존성: `korean-lunar-calendar`, `lunar-javascript`, `zod` (기존과 동일)

---

## 7. 마이그레이션 전략

### Phase 1: 새 레포 생성 + 코드 이식

**목표**: `krdn/saju` 레포에 v1.0.0 태그 퍼블리시. 기존 프로젝트에 영향 없음.

| 작업 | 소스 (gons-dashboard) | 대상 (krdn/saju) |
|------|----------------------|------------------|
| 계산 엔진 | `packages/saju/src/*` | `src/core/*` |
| 프레임 빌더 | `features/saju-*-tri/api/` 내 프레임 생성 로직 | `src/frames/*` |
| 프롬프트 | `features/saju-*-tri/api/prompts.ts` (4파일 × 4학파) | `src/prompts/**` |
| Zod 스키마 | `features/saju-*-tri/api/` 내 response schema | `src/schemas/*` |
| 상수 | `ALGORITHM_VERSION`, `PROMPT_VERSION` | `src/constants.ts` |

**검증**:
- 기존 `packages/saju` 테스트를 이식 + 프롬프트 스냅샷 테스트 추가
- `pnpm test` 전 항목 통과
- v1.0.0 태그 + GitHub Packages 퍼블리시

### Phase 2: gons-dashboard 전환

**목표**: dashboard가 `@krdn/saju` 패키지를 소비. `packages/saju/` 워크스페이스 제거.

```
Before:
  dashboard → packages/saju (계산)
  dashboard → features/saju-*-tri (프롬프트 + 스키마 + LLM 호출 + 캐시)

After:
  dashboard → @krdn/saju (계산 + 프롬프트 + 스키마)
  dashboard → features/saju-*-tri (LLM 호출 + 캐시만 남음)
```

단계:
1. `package.json`에 `@krdn/saju` 의존성 추가 (`github:krdn/saju#v1.0.0`)
2. `packages/saju/` 워크스페이스 제거 (pnpm-workspace.yaml 수정)
3. features 4개의 `prompts.ts` → `@krdn/saju`에서 import로 교체
4. features 4개의 response schema → `@krdn/saju`에서 import로 교체
5. `narrative-server.ts`에서 프레임 빌더 호출부를 `@krdn/saju`로 교체
6. `shared/lib/llm/saju-model-registry*.ts` 유지 (dashboard 전용 LLM 라우팅)

**남는 것** (dashboard 전용):
- `narrative-server.ts`: LLM 호출 (`@krdn/llm-gateway`) + 캐시 (Drizzle) + rate limit
- API 라우트: `/api/saju/*/narrative`
- DB 스키마: `sajuLifetimeNarrative` 등 캐시 테이블
- UI 컴포넌트: 위젯, 탭, 프로필 관리

**검증**: `pnpm typecheck && pnpm lint && pnpm build` + 운영 배포 후 각 학파×시간축 narrative 호출 확인.

### Phase 3: afterschool 전환

**목표**: afterschool이 312줄 자체 구현을 `@krdn/saju`로 교체.

1. `package.json`에 `@krdn/saju` 의존성 추가
2. `features/analysis/saju/saju.ts` (312줄) → `computeSajuChart` import로 교체
3. 학생 맞춤 프롬프트는 유지 — 패키지 프롬프트 위에 레이어링:

```typescript
import { computeSajuChart, buildLifetimeFrame, buildLifetimePrompt } from "@krdn/saju";

const chart = computeSajuChart(studentBirthInfo);
const frame = buildLifetimeFrame(chart, "ko");
const base = buildLifetimePrompt(frame, "ko");

// afterschool 전용 학생 분석 레이어
const studentPrompt = `${formatStudentInfo(student)}\n\n${base.user}\n\n학습 유형 분석도 포함해주세요.`;
const result = await aiSdk.generateText({ system: base.system, prompt: studentPrompt });
```

**검증**: 동일 입력에 대해 기존 자체 구현과 `@krdn/saju` 계산 결과 비교 테스트.

---

## 8. 리스크와 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 프롬프트 버전 불일치 | 캐시 miss 급증 | `PROMPT_VERSIONS` 상수를 패키지가 export → 소비자 캐시 키에 포함 |
| afterschool 계산 결과 차이 | 자체 구현과 `@krdn/saju` 결과가 다를 수 있음 | Phase 3 전에 동일 입력 비교 테스트 수행, 차이 발견 시 패키지에 맞춤 |
| GitHub Packages 인증 | CI에서 private 패키지 설치 시 토큰 필요 | `.npmrc` + `GITHUB_TOKEN` (기존 `@krdn/llm-gateway`와 동일 패턴) |
| 패키지 업데이트 전파 지연 | 프롬프트 수정이 모든 소비자에 즉시 반영 안 됨 | GHA 자동 업데이트 워크플로 (기존 llm-gateway 패턴 재사용) |
| 순환 의존 | 패키지가 소비자 코드를 참조하는 실수 | 패키지에 `"server-only"` 미포함, Node 전용 API 사용 금지, CI에서 `--no-external` 빌드 검증 |

---

## 9. 성공 기준

- [ ] `@krdn/saju` v1.0.0 GitHub Packages 퍼블리시 완료
- [ ] gons-dashboard가 `@krdn/saju`를 소비하며 기존과 동일한 narrative 생성 확인
- [ ] `packages/saju/` 워크스페이스 제거 후 `pnpm typecheck && pnpm build` 통과
- [ ] afterschool이 312줄 자체 구현을 제거하고 `@krdn/saju` 사용
- [ ] 동일 입력에 대해 계산 결과 일치 검증 (비교 테스트)
- [ ] 프롬프트 버전 변경 시 캐시 키가 자동으로 무효화되는 흐름 검증
