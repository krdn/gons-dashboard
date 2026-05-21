# Phase 3: 페르소나 + 합의 빌더

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** 5 페르소나 prompt builder, Zod schema (LLM 출력 강제), 합의 빌더, persona-router (모델 매핑 + override), Promise.allSettled 오케스트레이터, Mock LLM unit 테스트.

**완료 조건:**
- 5 페르소나 (`wallStreet`, `krExpert`, `value`, `growth`, `technical`) 각자 분석 prompt + Zod schema
- 합의 빌더 (`consensus`) — 성공한 페르소나 결과를 받아 다수결 + 핵심 리스크 정리
- `persona-router.ts` — default 매핑 + `stock_persona_preferences.overrides` 적용
- `analyzeStock(symbol, userId)` 오케스트레이터 — 5 병렬 + 합의 + DB upsert + 3명 미만 성공 시 fail (no cache write)
- Mock LLM unit 테스트 24+ (prompt 빌더, schema 검증, tally 다수결, 합의 prompt)
- `pnpm typecheck && pnpm lint && pnpm test` PASS

**전제:**
- Phase 2 PR (#107) 머지 완료 → main 에서 작업 브랜치 `feat/stock-analysis-phase-3` 컷
- `@gons/stock-analysis` 가 `fetchYahooQuotes`, `fetchYahooFundamentals`, `fetchYahooDailyOHLC` 를 export
- `entities/stock-analysis/server.ts` 의 `upsertAnalysis`, `getCachedAnalysis`, `PROMPT_VERSION` 등이 동작
- env 에 `SAJU_LLM_MODEL_CLAUDE`, `SAJU_LLM_MODEL_CODEX`, `SAJU_LLM_MODEL_GEMINI` 변수가 이미 존재 (saju v0.3.2 에서 도입)
- 면책: 본 phase 는 LLM 호출의 도메인 측면 (페르소나 다양성) 만 다룸. 면책 텍스트 표시 UI 는 Phase 5 (모달) 책임.

⚠️ **saju 패턴 미러:** `shared/lib/llm/saju-model-registry.ts` + `features/saju-lifetime-tri/api/narrative-server.ts` 의 검증된 패턴 재사용. 캐시 키, frame_hash, extractJsonObject helper, callLlmAndParseWithRetry 동일 구조.

---

## Task 3.1: Zod schemas — LLM 출력 강제

**Files:**
- Create: `packages/stock-analysis/src/schemas/persona.ts`
- Create: `packages/stock-analysis/src/schemas/consensus.ts`
- Create: `packages/stock-analysis/src/schemas/index.ts`

5명 페르소나 각자 출력 schema + 합의 schema. saju 의 `SCHOOL_SCHEMAS` 패턴 미러.

- [ ] **Step 1: persona.ts — PersonaAnalysisSchema**

```ts
import { z } from "zod";

export const PersonaKeySchema = z.enum([
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
]);
export type PersonaKey = z.infer<typeof PersonaKeySchema>;

export const VerdictSchema = z.enum(["BUY", "HOLD", "SELL"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ModelNameSchema = z.enum(["claude", "codex", "gemini"]);
export type ModelName = z.infer<typeof ModelNameSchema>;

export const PersonaAnalysisSchema = z.object({
  persona: PersonaKeySchema,
  verdict: VerdictSchema,
  oneLineThesis: z.string().min(20).max(200),
  narrative: z.string().min(300).max(800),
  keyMetrics: z.record(z.string(), z.union([z.number(), z.string()])),
  risks: z.array(z.string().min(5).max(200)).min(1).max(5),
  modelUsed: ModelNameSchema,
});

export type PersonaAnalysis = z.infer<typeof PersonaAnalysisSchema>;
```

⚠️ `narrative` min 300자 (spec §5.2 "본문 300-600자"). 800 까지 허용.
⚠️ `risks` 1~5개 (환각 가드 — 0개 응답 차단).

- [ ] **Step 2: consensus.ts — ConsensusSchema + MarketSnapshotSchema**

```ts
import { z } from "zod";
import { PersonaKeySchema, VerdictSchema, ModelNameSchema } from "./persona";

export const ConsensusSchema = z.object({
  verdict: VerdictSchema,
  score: z.string().regex(/^[0-5]\/5$/),
  oneLineConsensus: z.string().min(30).max(300),
  agreements: z.array(z.string().min(5).max(200)).min(0).max(5),
  disagreements: z.array(z.string().min(5).max(200)).min(0).max(5),
  riskRanking: z.array(z.string().min(5).max(200)).min(1).max(5),
  modelUsed: ModelNameSchema,
  successfulPersonas: z.array(PersonaKeySchema).min(3).max(5),
  failedPersonas: z.array(PersonaKeySchema).min(0).max(2),
});

export type Consensus = z.infer<typeof ConsensusSchema>;

export const MarketSnapshotSchema = z.object({
  price: z.number(),
  changePct: z.number(),
  currency: z.string(),
  marketCap: z.number().optional(),
  per: z.number().optional(),
  pbr: z.number().optional(),
  dividendYield: z.number().optional(),
  debtRatio: z.number().optional(),
  rsi14: z.number().optional(),
  ma20: z.number().optional(),
  ma60: z.number().optional(),
  asOf: z.string(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
```

⚠️ `successfulPersonas.min(3)` — 3명 미만 성공이면 합의 의미 없음. 오케스트레이터 사전 차단.

- [ ] **Step 3: index.ts**

```ts
export {
  PersonaAnalysisSchema,
  PersonaKeySchema,
  VerdictSchema,
  ModelNameSchema,
  type PersonaAnalysis,
  type PersonaKey,
  type Verdict,
  type ModelName,
} from "./persona";

export {
  ConsensusSchema,
  MarketSnapshotSchema,
  type Consensus,
  type MarketSnapshot,
} from "./consensus";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/stock-analysis/src/schemas/
git commit -m "feat(stock-analysis): Zod schemas (PersonaAnalysis / Consensus / MarketSnapshot)"
```

---

## Task 3.2: 5 페르소나 prompt builder

**Files:**
- Create: `packages/stock-analysis/src/personas/types.ts`
- Create: `packages/stock-analysis/src/personas/wallStreet.ts`
- Create: `packages/stock-analysis/src/personas/krExpert.ts`
- Create: `packages/stock-analysis/src/personas/value.ts`
- Create: `packages/stock-analysis/src/personas/growth.ts`
- Create: `packages/stock-analysis/src/personas/technical.ts`
- Create: `packages/stock-analysis/src/personas/index.ts`

각 페르소나 = 별도 파일 = 별도 prompt + system message.

- [ ] **Step 1: types.ts — 공통 입력 타입**

```ts
import type { MarketSnapshot } from "../schemas/consensus";

export interface PersonaInput {
  symbol: string;
  displayName: string;
  assetClass: "stock" | "crypto" | "commodity";
  market: string;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export type PromptBuilder = (input: PersonaInput) => BuiltPrompt;
```

- [ ] **Step 2: wallStreet.ts — 월스트리트 영문 IB 리서치 톤**

```ts
import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `You are a senior equity research analyst at a top-tier Wall Street investment bank (e.g. Goldman Sachs, Morgan Stanley).
Your analysis style: rigorous, fact-driven, with explicit reference to the provided market data.

CRITICAL CONSTRAINTS:
- Use ONLY the numerical data provided in the user message. Do NOT fabricate prices, P/E ratios, market cap, or any other figures.
- If a data point is missing, say "data unavailable" rather than estimating.
- Output STRICT JSON matching the PersonaAnalysisSchema (verdict / oneLineThesis / narrative / keyMetrics / risks / modelUsed).
- narrative: 300-600 Korean characters. Yes, write the narrative in Korean even though your reasoning style is Wall Street.
- This is NOT investment advice. State clearly that this is a hypothetical AI persona view.`;

export const wallStreet: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `Analyze ${input.symbol} (${input.displayName}, ${input.market}) from a Wall Street institutional perspective.

Market snapshot (use these EXACT figures):
${JSON.stringify(input.snapshot, null, 2)}

Daily OHLC (last 30 days, for technical context):
${JSON.stringify(input.dailyOHLC.slice(-30), null, 2)}

Required output (JSON only, no markdown code fence):
{
  "persona": "wallStreet",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "한 줄로 핵심 투자 논거 (20-200자)",
  "narrative": "300-600자, 한국어. 글로벌 시장 관점 + 12개월 목표가 시나리오 + 주요 catalyst",
  "keyMetrics": { "targetPrice12M": <number>, "implyUpside": "<percent>", "globalPeerPER": <number> },
  "risks": ["리스크1", "리스크2"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 3: krExpert.ts — 국내 증권사 한국어 톤**

```ts
import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 국내 대형 증권사 (예: 미래에셋, 한국투자, 삼성증권) 의 시니어 애널리스트입니다.
분석 스타일: KRX 미시구조 (외국인/기관/개인 수급, 공매도 잔고 등) 와 한국 거시 (원/달러, 금리, 정책) 에 정통.

엄격한 제약:
- 사용자 메시지에 제공된 숫자만 사용. P/E, 시가총액, 가격 등 절대 임의로 만들지 마세요.
- 데이터 누락 시 "데이터 없음" 표기.
- 출력은 PersonaAnalysisSchema 에 맞는 strict JSON.
- narrative 는 300-600자 한국어.
- 본 분석은 가상 AI 페르소나의 의견이며 투자자문이 아닙니다.`;

export const krExpert: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `종목 분석: ${input.symbol} (${input.displayName}, ${input.market})

시장 스냅샷 (이 수치 그대로 사용):
${JSON.stringify(input.snapshot, null, 2)}

최근 30 거래일 종가 / 거래량:
${JSON.stringify(input.dailyOHLC.slice(-30), null, 2)}

응답 형식 (JSON only, no markdown):
{
  "persona": "krExpert",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "20-200자, 국내 관점 한 줄 결론",
  "narrative": "300-600자. KRX 수급 (외인/기관/개인) + 환율/금리 영향 + 단기 박스권 vs 추세 판단",
  "keyMetrics": { "단기지지선": <number>, "단기저항선": <number>, "기관순매수일수": <number> },
  "risks": ["리스크1"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 4: value.ts — 가치 투자**

```ts
import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 가치 투자 펀드 매니저입니다 (예: Berkshire Hathaway 스타일).
분석 스타일: 펀더멘털 정량 분석 (PER, PBR, PSR, 배당, DCF, 안전 마진).

엄격한 제약:
- 제공된 PER, PBR, 배당수익률 수치만 사용. 임의 수치 생성 금지.
- 데이터 누락 시 "추정 불가" 명시.
- 출력은 PersonaAnalysisSchema strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견이며 투자자문이 아닙니다.`;

export const value: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `가치 투자 관점 분석: ${input.symbol} (${input.displayName})

펀더멘털 수치 (제공된 값만 사용):
- 가격: ${input.snapshot.price} ${input.snapshot.currency}
- 시가총액: ${input.snapshot.marketCap ?? "데이터 없음"}
- PER: ${input.snapshot.per ?? "데이터 없음"}
- PBR: ${input.snapshot.pbr ?? "데이터 없음"}
- 배당수익률: ${input.snapshot.dividendYield ?? "데이터 없음"}

응답 형식:
{
  "persona": "value",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "PER X배 / PBR Y배 기준 [저평가/적정/고평가] 판단",
  "narrative": "300-600자. PER 동종업 비교 + 배당 안정성 + 안전마진 계산",
  "keyMetrics": { "fairPER": <number>, "marginOfSafety": "<percent>", "dcfTarget": <number> },
  "risks": ["가치 함정 가능성", "배당 컷 리스크"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 5: growth.ts — 성장 투자**

```ts
import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 성장주 펀드 매니저입니다 (예: ARK Invest 스타일).
분석 스타일: 매출 성장률, 미래 시장 규모, 디스럽션 시나리오. Gemini 의 검색 도구가 있다면 최신 뉴스/실적을 활용.

엄격한 제약:
- 제공된 가격/시총 수치만 사용. P/E 같은 정량 비율은 보조 지표로 가볍게.
- 검색 도구로 얻은 정보는 narrative 에서 "최근 보고서에 따르면..." 같이 인용 표기. 출처 모호하면 표시 안 함.
- 출력 strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견.`;

export const growth: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `성장 투자 관점: ${input.symbol} (${input.displayName})

시장 스냅샷:
${JSON.stringify(input.snapshot, null, 2)}

응답 형식:
{
  "persona": "growth",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "성장 모멘텀 한 줄 (예: HBM 점유율 확대 + AI 수요 가속)",
  "narrative": "300-600자. 매출 성장률 + TAM/SAM 시나리오 + 디스럽션 변수 + 최신 catalyst",
  "keyMetrics": { "revenueGrowthYoY": "<percent>", "tamUSD": <number>, "competitiveMoat": "<설명>" },
  "risks": ["성장 둔화 신호", "신규 진입자"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 6: technical.ts — 기술적 분석**

```ts
import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 차트 기술 분석가입니다 (CMT 자격).
분석 스타일: RSI, 이동평균 (MA20/60), 거래량, 추세선, 지지/저항 레벨.

엄격한 제약:
- 제공된 일봉 데이터 (close, volume) 와 RSI/MA 만 분석. 임의 패턴 추측 금지.
- 출력 strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견.`;

export const technical: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `기술적 분석: ${input.symbol}

지표:
- 현재가: ${input.snapshot.price}
- RSI(14): ${input.snapshot.rsi14 ?? "계산 불가"}
- MA20: ${input.snapshot.ma20 ?? "계산 불가"}
- MA60: ${input.snapshot.ma60 ?? "계산 불가"}

최근 30 거래일 종가/거래량:
${JSON.stringify(input.dailyOHLC.slice(-30), null, 2)}

응답 형식:
{
  "persona": "technical",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "RSI X + MA20 [상회/하회] 기반 [상승/조정/반전] 시나리오",
  "narrative": "300-600자. 추세 + 지지/저항 + 거래량 다이버전스 + 단기 (1-2주) vs 중기 (1-3개월) 전망",
  "keyMetrics": { "supportLevel": <number>, "resistanceLevel": <number>, "rsi14": <number>, "trend": "uptrend|sideways|downtrend" },
  "risks": ["거짓 돌파 가능성", "거래량 감소"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 7: index.ts**

```ts
import { wallStreet } from "./wallStreet";
import { krExpert } from "./krExpert";
import { value } from "./value";
import { growth } from "./growth";
import { technical } from "./technical";
import type { PromptBuilder } from "./types";
import type { PersonaKey } from "../schemas/persona";

export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./types";

export const PERSONA_BUILDERS: Record<PersonaKey, PromptBuilder> = {
  wallStreet,
  krExpert,
  value,
  growth,
  technical,
};
```

- [ ] **Step 8: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/stock-analysis/src/personas/
git commit -m "feat(stock-analysis): 5 페르소나 prompt builder (wallStreet/krExpert/value/growth/technical)"
```

---

## Task 3.3: 합의 빌더

**Files:**
- Create: `packages/stock-analysis/src/consensus/builder.ts`
- Create: `packages/stock-analysis/src/consensus/index.ts`

5명 결과 → 합의 prompt + tally helper.

- [ ] **Step 1: builder.ts**

```ts
import type { BuiltPrompt } from "../personas/types";
import type { PersonaAnalysis, Verdict } from "../schemas/persona";

const SYSTEM = `당신은 투자 위원회의 의장입니다. 5명의 페르소나 (월스트리트 / 한국 전문가 / 가치 / 성장 / 기술적) 가 같은 종목을 각자 분석했습니다.
당신의 임무: 다수결로 종합 평가 (BUY/HOLD/SELL) 를 결정하고, 공통 의견과 의견이 갈리는 지점, 핵심 리스크 순위를 정리합니다.

엄격한 제약:
- 페르소나가 제시한 사실 (verdict, oneLineThesis, narrative) 만 종합. 새로운 데이터 추가 금지.
- 다수결: 5명 중 BUY 가 가장 많으면 BUY, 동률이면 HOLD 가 안전한 선택.
- score: "<BUY 수>/5" 형식 (예: "4/5"). 실패 페르소나는 0 vote 로 카운트 — denominator 항상 5.
- agreements: 모든/대부분의 페르소나가 동의한 포인트 (0-5 개).
- disagreements: 의견이 갈린 지점 (0-5 개).
- riskRanking: 페르소나들이 언급한 리스크를 중요도 순으로 정렬 (1-5 개).
- 본 분석은 가상 AI 페르소나의 종합 의견이며 투자자문이 아닙니다.`;

export function buildConsensusPrompt(
  personaResults: PersonaAnalysis[],
  modelUsed: "claude" | "codex" | "gemini",
): BuiltPrompt {
  return {
    system: SYSTEM,
    user: `5 페르소나 분석 결과 (성공: ${personaResults.length}명):

${personaResults
  .map(
    (p) => `── ${p.persona} (${p.modelUsed})
verdict: ${p.verdict}
oneLineThesis: ${p.oneLineThesis}
narrative: ${p.narrative}
risks: ${JSON.stringify(p.risks)}
keyMetrics: ${JSON.stringify(p.keyMetrics)}`,
  )
  .join("\n\n")}

응답 형식 (JSON only):
{
  "verdict": "BUY" | "HOLD" | "SELL",
  "score": "<count>/5",
  "oneLineConsensus": "30-300자 한국어 종합 한 줄",
  "agreements": ["공통 의견1"],
  "disagreements": ["갈린 지점1"],
  "riskRanking": ["가장 중요한 리스크1", "리스크2"],
  "modelUsed": "${modelUsed}",
  "successfulPersonas": ${JSON.stringify(personaResults.map((p) => p.persona))},
  "failedPersonas": []
}`,
  };
}

/**
 * 페르소나 결과의 다수결 verdict 를 미리 계산 (LLM 검증용 + fallback consensus).
 * Denominator 항상 5 (실패 페르소나는 abstain).
 */
export function tallyVerdicts(personaResults: PersonaAnalysis[]): {
  majority: Verdict;
  score: string;
  counts: Record<Verdict, number>;
} {
  const counts: Record<Verdict, number> = { BUY: 0, HOLD: 0, SELL: 0 };
  for (const p of personaResults) counts[p.verdict]++;
  const sorted = (["BUY", "HOLD", "SELL"] as Verdict[]).sort(
    (a, b) => counts[b] - counts[a],
  );
  const top = sorted[0];
  const second = sorted[1];
  // 동률 시 HOLD 우선 (안전한 선택)
  const majority = counts[top] === counts[second] ? "HOLD" : top;
  return { majority, score: `${counts[majority]}/5`, counts };
}
```

- [ ] **Step 2: index.ts**

```ts
export { buildConsensusPrompt, tallyVerdicts } from "./builder";
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @gons/stock-analysis typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/stock-analysis/src/consensus/
git commit -m "feat(stock-analysis): consensus 빌더 (5 페르소나 → 다수결 + 핵심 리스크)"
```

---

## Task 3.4: package index.ts 업데이트 + persona-router

**Files:**
- Modify: `packages/stock-analysis/src/index.ts` (schemas / personas / consensus export 추가)
- Create: `apps/dashboard/src/shared/lib/llm/persona-router.ts`

- [ ] **Step 1: package index.ts 업데이트**

Phase 2 의 yahoo export 옆에 추가:

```ts
// Public API for @gons/stock-analysis package.
export {
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchYahooSearch,
  YahooFetchError,
} from "./adapters/yahoo";
export type {
  NormalizedQuote,
  NormalizedSearchResult,
  NormalizedFundamentals,
  AssetClass,
  Market,
} from "./adapters/normalized-types";

// Schemas
export {
  PersonaAnalysisSchema,
  PersonaKeySchema,
  VerdictSchema,
  ModelNameSchema,
  ConsensusSchema,
  MarketSnapshotSchema,
  type PersonaAnalysis,
  type PersonaKey,
  type Verdict,
  type ModelName,
  type Consensus,
  type MarketSnapshot,
} from "./schemas";

// Personas + Consensus
export { PERSONA_BUILDERS } from "./personas";
export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./personas";
export { buildConsensusPrompt, tallyVerdicts } from "./consensus";
```

- [ ] **Step 2: persona-router.ts**

```ts
import "server-only";
import { env } from "@/shared/config/env";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { DEFAULT_PERSONA_MODELS } from "@/entities/stock-analysis/client";

export interface PersonaModelMapping {
  wallStreet: ModelName;
  krExpert: ModelName;
  value: ModelName;
  growth: ModelName;
  technical: ModelName;
  consensus: ModelName;
}

export interface ResolvedModel {
  name: ModelName;
  id: string;
}

const MODEL_ID_BY_NAME: Record<ModelName, string> = {
  claude: env.SAJU_LLM_MODEL_CLAUDE,
  codex: env.SAJU_LLM_MODEL_CODEX,
  gemini: env.SAJU_LLM_MODEL_GEMINI,
};

/**
 * 사용자별 페르소나 → 모델 매핑 해석.
 * 1. user override 로드 (없으면 빈 객체)
 * 2. DEFAULT_PERSONA_MODELS 와 머지 (override 가 우선)
 * 3. 각 ModelName 을 실제 proxy 모델 ID 로 매핑
 */
export async function resolvePersonaModels(
  userId: string,
): Promise<Record<PersonaOrConsensus, ResolvedModel>> {
  const rows = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, userId))
    .limit(1);
  const overrides = (rows[0]?.overrides ?? {}) as Partial<PersonaModelMapping>;

  const resolved = {} as Record<PersonaOrConsensus, ResolvedModel>;
  const personas: PersonaOrConsensus[] = [
    "wallStreet",
    "krExpert",
    "value",
    "growth",
    "technical",
    "consensus",
  ];
  for (const p of personas) {
    const name = overrides[p] ?? DEFAULT_PERSONA_MODELS[p];
    resolved[p] = { name, id: MODEL_ID_BY_NAME[name] };
  }
  return resolved;
}

/**
 * UI 의 PersonaModelPicker (Phase 4) 가 호출.
 */
export async function updatePersonaOverrides(
  userId: string,
  partial: Partial<PersonaModelMapping>,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, userId))
    .limit(1);
  const merged = { ...(existing[0]?.overrides ?? {}), ...partial };
  await db
    .insert(stockPersonaPreferences)
    .values({ userId, overrides: merged })
    .onConflictDoUpdate({
      target: stockPersonaPreferences.userId,
      set: { overrides: merged, updatedAt: new Date() },
    });
}
```

⚠️ `env.SAJU_LLM_MODEL_*` 재사용 — 같은 proxy / 같은 모델 ID 라 STOCK_LLM_MODEL_* 별도 도입 안 함. 만약 v1.1 에서 stock 전용 모델이 필요해지면 env 분리 검토.

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/stock-analysis/src/index.ts apps/dashboard/src/shared/lib/llm/persona-router.ts
git commit -m "feat(stock-analysis): package public API 확장 + persona-router (default + override)"
```

---

## Task 3.5: analyzeStock 오케스트레이터

**Files:**
- Create: `apps/dashboard/src/features/stock-analysis-server/api/llm-call.ts`
- Create: `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts`
- Create: `apps/dashboard/src/features/stock-analysis-server/index.ts`

5 페르소나 병렬 호출 + 합의 + DB upsert.

- [ ] **Step 1: llm-call.ts — LLM 호출 + JSON 파싱 + Zod 검증 + retry**

```ts
import "server-only";
import { z } from "zod";
import { anthropic } from "@/shared/lib/llm/anthropic";
import type { BuiltPrompt } from "@gons/stock-analysis";

const MAX_TOKENS = 4096;

/**
 * LLM 응답에서 JSON object 만 추출 (markdown code fence / leading text 제거).
 * saju 의 extractJsonObject 패턴 미러.
 */
export function extractJsonObject(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fenceMatch ? fenceMatch[1] : text;
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in LLM response");
  }
  return inner.slice(start, end + 1);
}

/**
 * LLM 1회 호출 + JSON.parse + Zod 검증.
 */
export async function callLlmAndParse<T extends z.ZodTypeAny>(
  prompt: BuiltPrompt,
  modelId: string,
  schema: T,
): Promise<z.infer<T>> {
  // Opus 4.x 는 temperature 매개변수 거부 (proxy 400).
  // 모델 ID 에 'opus' 포함 시 temperature 생략.
  const isOpus = modelId.includes("opus");
  type AnthropicCreateParams = Parameters<typeof anthropic.messages.create>[0];
  const params: AnthropicCreateParams = {
    model: modelId,
    max_tokens: MAX_TOKENS,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  };
  if (!isOpus) {
    (params as AnthropicCreateParams & { temperature?: number }).temperature = 0.5;
  }
  const res = await anthropic.messages.create(params);

  // Codex thinking block 회피 — find(b => b.type === "text").
  // saju 메모리 'fix(saju): Codex thinking block' 패턴 미러.
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`LLM response had no text block (model=${modelId})`);
  }
  const json = extractJsonObject(textBlock.text);
  const parsed = JSON.parse(json);
  return schema.parse(parsed);
}

/**
 * 재시도 wrapper. saju 의 callLlmAndParseWithRetry 패턴.
 */
export async function callLlmAndParseWithRetry<T extends z.ZodTypeAny>(
  prompt: BuiltPrompt,
  modelId: string,
  schema: T,
  maxRetries = 1,
): Promise<z.infer<T>> {
  let lastError: Error | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await callLlmAndParse(prompt, modelId, schema);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `LLM call failed after ${maxRetries + 1} attempts (model=${modelId}): ${lastError?.message}`,
  );
}
```

⚠️ Opus temperature gotcha + Codex thinking block gotcha 적용.

- [ ] **Step 2: orchestrator.ts**

```ts
import "server-only";
import { format } from "date-fns";
import {
  PERSONA_BUILDERS,
  PersonaAnalysisSchema,
  ConsensusSchema,
  buildConsensusPrompt,
  tallyVerdicts,
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  type PersonaAnalysis,
  type PersonaKey,
  type Consensus,
  type MarketSnapshot,
} from "@gons/stock-analysis";
import { resolvePersonaModels } from "@/shared/lib/llm/persona-router";
import { upsertAnalysis } from "@/entities/stock-analysis/server";
import type { PortfolioHolding } from "@/entities/portfolio-holding/server";
import { callLlmAndParseWithRetry } from "./llm-call";

const MINIMUM_SUCCESS = 3;

export interface AnalyzeStockArgs {
  symbol: string;
  displayName: string;
  assetClass: PortfolioHolding["assetClass"];
  market: string;
  userId: string;
}

export interface AnalyzeStockResult {
  status: "success" | "partial" | "failed";
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus | null;
  marketSnapshot: MarketSnapshot | null;
}

export async function analyzeStock(
  args: AnalyzeStockArgs,
): Promise<AnalyzeStockResult> {
  // 1. Yahoo 시세 + 펀더멘털 + 일봉 (병렬)
  const [quotes, fundamentals, dailyOHLC] = await Promise.all([
    fetchYahooQuotes([args.symbol]),
    fetchYahooFundamentals(args.symbol).catch(() => null),
    fetchYahooDailyOHLC(args.symbol, "1y").catch(() => []),
  ]);
  if (quotes.length === 0) {
    return {
      status: "failed",
      personas: {},
      consensus: null,
      marketSnapshot: null,
    };
  }
  const q = quotes[0];
  const snapshot: MarketSnapshot = {
    price: q.price,
    changePct: q.changePct,
    currency: q.currency,
    marketCap: fundamentals?.marketCap,
    per: fundamentals?.per,
    pbr: fundamentals?.pbr,
    dividendYield: fundamentals?.dividendYield,
    ma20: undefined, // Phase 3 후속에서 일봉으로 계산
    ma60: undefined,
    rsi14: undefined,
    asOf: q.fetchedAt,
  };

  // 2. 페르소나별 모델 해석
  const models = await resolvePersonaModels(args.userId);

  // 3. 5 페르소나 병렬 호출 (Promise.allSettled)
  const personaInput = {
    symbol: args.symbol,
    displayName: args.displayName,
    assetClass: args.assetClass,
    market: args.market,
    snapshot,
    dailyOHLC,
  };
  const personaKeys: PersonaKey[] = [
    "wallStreet",
    "krExpert",
    "value",
    "growth",
    "technical",
  ];
  const settled = await Promise.allSettled(
    personaKeys.map(async (key) => {
      const builder = PERSONA_BUILDERS[key];
      const prompt = builder(personaInput);
      const model = models[key];
      const result = await callLlmAndParseWithRetry(
        prompt,
        model.id,
        PersonaAnalysisSchema,
      );
      // LLM 이 modelUsed 를 잘못 채우면 강제 보정
      return { ...result, persona: key, modelUsed: model.name };
    }),
  );

  const personas: Partial<Record<PersonaKey, PersonaAnalysis>> = {};
  const successfulResults: PersonaAnalysis[] = [];
  for (let i = 0; i < personaKeys.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      personas[personaKeys[i]] = r.value;
      successfulResults.push(r.value);
    }
  }

  // 4. 3명 미만 성공 시 캐시 저장 안 함
  if (successfulResults.length < MINIMUM_SUCCESS) {
    return {
      status: "failed",
      personas,
      consensus: null,
      marketSnapshot: snapshot,
    };
  }

  // 5. 합의 빌더
  const consensusModel = models.consensus;
  const consensusPrompt = buildConsensusPrompt(
    successfulResults,
    consensusModel.name,
  );
  let consensus: Consensus;
  try {
    consensus = await callLlmAndParseWithRetry(
      consensusPrompt,
      consensusModel.id,
      ConsensusSchema,
    );
  } catch {
    // 합의 빌더 실패 — fallback: 다수결 + 누적 리스크
    const tally = tallyVerdicts(successfulResults);
    consensus = {
      verdict: tally.majority,
      score: tally.score,
      oneLineConsensus: `5 페르소나 중 ${successfulResults.length}명 성공. 다수결 = ${tally.majority}.`,
      agreements: [],
      disagreements: [],
      riskRanking: successfulResults.flatMap((p) => p.risks).slice(0, 5),
      modelUsed: consensusModel.name,
      successfulPersonas: successfulResults.map((p) => p.persona),
      failedPersonas: personaKeys.filter((k) => !personas[k]),
    };
  }

  // 6. DB upsert (글로벌 캐시 — user_id NULL)
  const today = format(new Date(), "yyyy-MM-dd");
  await upsertAnalysis({
    symbol: args.symbol,
    analysisDate: today,
    userId: null,
    personas,
    consensus,
    marketSnapshot: snapshot,
  });

  return {
    status:
      successfulResults.length === personaKeys.length ? "success" : "partial",
    personas,
    consensus,
    marketSnapshot: snapshot,
  };
}
```

⚠️ `ma20/ma60/rsi14` 계산은 Phase 3 후속 또는 Phase 5 (차트) 에서 처리. snapshot 에 undefined.

- [ ] **Step 3: index.ts**

```ts
export { analyzeStock } from "./api/orchestrator";
export type {
  AnalyzeStockArgs,
  AnalyzeStockResult,
} from "./api/orchestrator";
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @gons/dashboard typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/stock-analysis-server/
git commit -m "feat(stock-analysis): analyzeStock 오케스트레이터 (5 병렬 + 합의 + 글로벌 캐시)"
```

---

## Task 3.6: Mock LLM unit 테스트

**Files:**
- Create: `packages/stock-analysis/tests/personas.test.ts`
- Create: `packages/stock-analysis/tests/consensus.test.ts`

페르소나 prompt 빌더 + Zod schema + tally + 합의 prompt 검증.

- [ ] **Step 1: personas.test.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  PERSONA_BUILDERS,
  PersonaAnalysisSchema,
  type PersonaInput,
  type PersonaKey,
} from "../src";

const SAMPLE_INPUT: PersonaInput = {
  symbol: "AAPL",
  displayName: "Apple Inc.",
  assetClass: "stock",
  market: "NASDAQ",
  snapshot: {
    price: 180.5,
    changePct: 1.2,
    currency: "USD",
    marketCap: 3_000_000_000_000,
    per: 28.5,
    pbr: 42.1,
    dividendYield: 0.005,
    asOf: "2026-05-21T00:00:00Z",
  },
  dailyOHLC: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, "0")}`,
    close: 175 + i * 0.5,
    volume: 50_000_000,
  })),
};

describe("PERSONA_BUILDERS", () => {
  const PERSONAS: PersonaKey[] = [
    "wallStreet",
    "krExpert",
    "value",
    "growth",
    "technical",
  ];

  PERSONAS.forEach((persona) => {
    it(`${persona}: prompt 가 system + user 를 가지고 빈 문자열 아님`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      expect(prompt.system).toBeTruthy();
      expect(prompt.user).toBeTruthy();
      expect(prompt.system.length).toBeGreaterThan(50);
      expect(prompt.user.length).toBeGreaterThan(50);
    });

    it(`${persona}: user prompt 에 symbol 명시`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      expect(prompt.user).toContain("AAPL");
    });

    it(`${persona}: snapshot 의 수치가 prompt 에 인용됨`, () => {
      const prompt = PERSONA_BUILDERS[persona](SAMPLE_INPUT);
      const cited =
        prompt.user.includes("180.5") ||
        prompt.user.includes("28.5") ||
        prompt.user.includes("3000000000000") ||
        prompt.user.includes("3,000,000,000,000");
      expect(cited).toBe(true);
    });
  });
});

describe("PersonaAnalysisSchema", () => {
  it("정상 입력 통과", () => {
    const valid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "x".repeat(400),
      keyMetrics: { targetPrice12M: 200 },
      risks: ["미·중 반도체 규제 리스크"],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(valid)).not.toThrow();
  });

  it("narrative 가 너무 짧으면 fail", () => {
    const invalid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "짧음",
      keyMetrics: {},
      risks: ["리스크"],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(invalid)).toThrow();
  });

  it("risks 가 0개면 fail (환각 가드)", () => {
    const invalid = {
      persona: "wallStreet" as const,
      verdict: "BUY" as const,
      oneLineThesis: "메모리 사이클 회복 + HBM 점유율 확대로 매수 권장",
      narrative: "x".repeat(400),
      keyMetrics: {},
      risks: [],
      modelUsed: "claude" as const,
    };
    expect(() => PersonaAnalysisSchema.parse(invalid)).toThrow();
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 18 PASS (5 페르소나 × 3 케이스 + schema 3 케이스).

- [ ] **Step 2: consensus.test.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  tallyVerdicts,
  buildConsensusPrompt,
  type PersonaAnalysis,
  type PersonaKey,
  type Verdict,
} from "../src";

function persona(p: PersonaKey, v: Verdict): PersonaAnalysis {
  return {
    persona: p,
    verdict: v,
    oneLineThesis: "테스트용 한 줄 결론입니다 (20자 이상)",
    narrative: "x".repeat(400),
    keyMetrics: {},
    risks: ["테스트 리스크"],
    modelUsed: "claude",
  };
}

describe("tallyVerdicts", () => {
  it("5명 모두 BUY → 5/5 BUY", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "BUY"),
      persona("growth", "BUY"),
      persona("technical", "BUY"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("5/5");
    expect(r.counts.BUY).toBe(5);
  });

  it("4 BUY + 1 SELL → 4/5 BUY", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "BUY"),
      persona("growth", "BUY"),
      persona("technical", "SELL"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("4/5");
  });

  it("BUY 2 / SELL 2 / HOLD 1 동률 → HOLD 우선 (안전)", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "SELL"),
      persona("growth", "SELL"),
      persona("technical", "HOLD"),
    ]);
    expect(r.majority).toBe("HOLD");
  });

  it("3명만 성공 (2명 abstain): 2 BUY + 1 SELL → 2/5 BUY (denominator 5)", () => {
    const r = tallyVerdicts([
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "SELL"),
    ]);
    expect(r.majority).toBe("BUY");
    expect(r.score).toBe("2/5");
  });
});

describe("buildConsensusPrompt", () => {
  it("system + user 가 비어있지 않고 페르소나 결과를 인용", () => {
    const results = [
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "HOLD"),
    ];
    const prompt = buildConsensusPrompt(results, "claude");
    expect(prompt.system).toContain("투자 위원회");
    expect(prompt.user).toContain("wallStreet");
    expect(prompt.user).toContain("krExpert");
    expect(prompt.user).toContain("value");
  });

  it("modelUsed 가 user prompt 에 인용됨", () => {
    const results = [
      persona("wallStreet", "BUY"),
      persona("krExpert", "BUY"),
      persona("value", "HOLD"),
    ];
    const prompt = buildConsensusPrompt(results, "gemini");
    expect(prompt.user).toContain("gemini");
  });
});
```

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 24 PASS 총.

- [ ] **Step 3: Commit**

```bash
git add packages/stock-analysis/tests/
git commit -m "test(stock-analysis): personas + consensus 빌더 unit 테스트 (24 케이스)"
```

---

## Task 3.7: 통합 검증 + PR

- [ ] **Step 1: 전체 typecheck**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

- [ ] **Step 2: dashboard lint**

Run: `cd apps/dashboard && pnpm lint` (root OOM 우회 — Phase 2 T2.8 우려사항 #1)
Expected: PASS.

- [ ] **Step 3: 전체 test**

Run: `pnpm test`
Expected:
- stock-analysis: 11 (Phase 2) + 24 (Phase 3) = **35 PASS**
- saju: 152 PASS (변동 없음)
- 다른 패키지 PASS 유지

- [ ] **Step 4: 작업 commit 검증**

Run: `git log --oneline origin/main..HEAD`
Expected: 6 commit (T3.1 ~ T3.6).

- [ ] **Step 5: branch push + PR 생성**

```bash
git push -u origin feat/stock-analysis-phase-3

gh pr create --title "feat(stock-analysis): Phase 3 — 페르소나 + 합의 빌더" --body "$(cat <<'EOF'
## Summary
- 5 페르소나 prompt builder (월스트리트 / 한국 전문가 / 가치 / 성장 / 기술적) — 각자 도메인 시각 + 한국어 narrative 300-600자
- Zod schema 로 LLM 출력 강제 (PersonaAnalysis / Consensus / MarketSnapshot)
- 합의 빌더 — 5명 결과 → 다수결 + agreements/disagreements/riskRanking. tallyVerdicts helper 동률 시 HOLD 우선
- persona-router — 페르소나별 모델 매핑 (Claude 3 / Codex 2 / Gemini 1) + user override
- analyzeStock 오케스트레이터 — Yahoo fetch + 5 병렬 LLM (Promise.allSettled) + 합의 + 글로벌 캐시 upsert
- 부분 실패 처리 — 3명 미만 성공 시 cache 안 씀 (saju verifyConsensus 미러)
- 합의 빌더 실패 시 fallback (다수결 + 누적 리스크)
- Opus temperature gotcha + Codex thinking block gotcha 적용

## Notes
- env 재사용: SAJU_LLM_MODEL_{CLAUDE,CODEX,GEMINI}
- MA/RSI 계산 보류 (snapshot 의 ma20/ma60/rsi14 = undefined). 일봉 데이터는 페르소나 prompt 에 직접 전달
- 면책 텍스트: 모든 prompt system 에 "본 분석은 가상 AI 페르소나 의견이며 투자자문이 아닙니다" 명시. UI footer 는 Phase 5

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §1.2, §2, §6.3
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-3-personas-consensus.md

## Test plan
- [x] pnpm typecheck PASS
- [x] cd apps/dashboard && pnpm lint PASS
- [x] pnpm test — stock-analysis 35 PASS, saju 152 PASS
- [ ] (수동) Phase 6 lazy trigger 진입 후 실제 LLM 응답 검증

🤖 Generated with Claude Code
EOF
)"
```

---

## Phase 3 self-check

- [ ] `pnpm typecheck && (cd apps/dashboard && pnpm lint) && pnpm test` 모두 PASS
- [ ] 24+ stock-analysis 신규 테스트 PASS
- [ ] `persona-router` 가 default + override 둘 다 처리
- [ ] Promise.allSettled 가 부분 실패 허용 (≥3명 성공 시 합의 진행)
- [ ] 합의 빌더 실패 시 fallback consensus 생성
- [ ] PR 머지 후 main Docker 빌드 success

Phase 3 PR 머지 후 Phase 4 (Portfolio CRUD UI) 진입 — 실제 LLM 호출은 Phase 6 lazy trigger 에서 한 번에 검증.

---

## 횡단 관심사 (Phase 3 갱신)

- **Opus temperature gotcha** (메모리 `anthropic-opus-temperature-deprecated`): T3.5 의 `llm-call.ts` 가 모델 ID 에 "opus" 포함 시 temperature 생략.
- **Codex thinking block gotcha** (saju PR #103): T3.5 의 `find(b => b.type === "text")` 패턴.
- **모델 분산 검증:** unit 테스트만으로는 실제 분산 안 보임. Phase 6 lazy trigger 시점에 로그/추적.
- **MA/RSI 계산 backlog:** Phase 3 의도된 보류. Phase 5 (차트) 또는 Phase 3.5 hotfix.
- **score denominator** = 항상 `/5`. schema regex `^[0-5]\/5$` 유지.
- **글로벌 캐시 user_id NULL + NULLS NOT DISTINCT** (Phase 1 fix): T3.5 의 `upsertAnalysis({ userId: null })` 가 동일 (symbol, date) 에 한 row 만 유지. Phase 6 lazy trigger 시점 동시 INSERT 시 검증.
- **Phase 2 T2.7 우려 (API route entities 우회)**: 본 phase 의 orchestrator 는 package 직접 호출 + entities/stock-analysis 의 cache CRUD 통과 — FSD 의도와 부합.
