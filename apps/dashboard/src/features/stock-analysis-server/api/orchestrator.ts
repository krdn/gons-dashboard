// analyzeStock 오케스트레이터 — 5 페르소나 병렬 호출 + 합의 + 글로벌 캐시 upsert.
// saju 의 getOrBuildNarrative 패턴 미러.
//
// Flow:
// 1. Yahoo 시세 / 펀더멘털 / 일봉 병렬 fetch
// 2. 사용자별 페르소나 모델 매핑 해석
// 3. 5 페르소나 병렬 호출 (Promise.allSettled — 1-2명 실패 허용)
// 4. 성공 >= 3 인 경우만 합의 빌더 호출 + DB upsert
// 5. 합의 빌더 실패 시 tallyVerdicts 다수결 fallback
import "server-only";
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
import {
  simpleMovingAverage,
  relativeStrengthIndex,
  lastFinite,
} from "@/shared/lib/ta/indicators";
import { upsertAnalysis } from "@/entities/stock-analysis/server";
import type { PortfolioHolding } from "@/entities/portfolio-holding/server";
import { callLlmAndParseWithRetry } from "./llm-call";

const MINIMUM_SUCCESS = 3;
const PERSONA_KEYS: PersonaKey[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
];

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
  // 1. Yahoo 시세 + 펀더멘털 + 일봉 (병렬, 펀더멘털/일봉은 실패 허용)
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
  const closes = dailyOHLC.map((d) => d.close);
  const snapshot: MarketSnapshot = {
    price: q.price,
    changePct: q.changePct,
    currency: q.currency,
    marketCap: fundamentals?.marketCap,
    per: fundamentals?.per,
    pbr: fundamentals?.pbr,
    dividendYield: fundamentals?.dividendYield,
    ma20: lastFinite(simpleMovingAverage(closes, 20)),
    ma60: lastFinite(simpleMovingAverage(closes, 60)),
    rsi14: lastFinite(relativeStrengthIndex(closes, 14)),
    asOf: q.fetchedAt,
  };

  // 2. 페르소나별 모델 해석 (user override + default 머지)
  const models = await resolvePersonaModels(args.userId);

  // 3. 펀더멘털 전무 시 value 페르소나 skip — LLM 비용 + retry 낭비 방지.
  //    value 는 PER/PBR/배당 정량 분석이 핵심이라 입력 없으면 "추정 불가"
  //    응답만 반복. Yahoo v7 401 등 외부 데이터 장애 시 의도된 실패로 처리.
  const hasFundamentals =
    snapshot.per != null ||
    snapshot.pbr != null ||
    snapshot.marketCap != null ||
    snapshot.dividendYield != null;
  const activePersonaKeys: PersonaKey[] = hasFundamentals
    ? PERSONA_KEYS
    : PERSONA_KEYS.filter((k) => k !== "value");

  // 4. 활성 페르소나 병렬 호출
  const personaInput = {
    symbol: args.symbol,
    displayName: args.displayName,
    assetClass: args.assetClass,
    market: args.market,
    snapshot,
    dailyOHLC,
  };
  const settled = await Promise.allSettled(
    activePersonaKeys.map(async (key) => {
      const builder = PERSONA_BUILDERS[key];
      const prompt = builder(personaInput);
      const model = models[key];
      const result = await callLlmAndParseWithRetry(
        prompt,
        model.id,
        PersonaAnalysisSchema,
      );
      // LLM 이 modelUsed 를 잘못 채울 수 있어 router 가 해석한 이름으로 강제 보정.
      return { ...result, persona: key, modelUsed: model.name };
    }),
  );

  const personas: Partial<Record<PersonaKey, PersonaAnalysis>> = {};
  const successfulResults: PersonaAnalysis[] = [];
  for (let i = 0; i < activePersonaKeys.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      personas[activePersonaKeys[i]] = r.value;
      successfulResults.push(r.value);
    }
  }

  // 4. 3명 미만 성공 시 캐시 저장 안 함 (incomplete result 는 cache pollution).
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
  const failedPersonas = PERSONA_KEYS.filter((k) => !personas[k]);
  const successfulPersonaKeys = successfulResults.map((p) => p.persona);
  let consensus: Consensus;
  try {
    consensus = await callLlmAndParseWithRetry(
      consensusPrompt,
      consensusModel.id,
      ConsensusSchema,
    );
  } catch {
    // 합의 빌더 실패 — fallback: 다수결 + 누적 리스크.
    // ConsensusSchema 제약을 모두 만족시켜야 cache write 가능:
    // - oneLineConsensus: 30-300자
    // - riskRanking: min(1), 각 항목 5-200자 (persona risks 재사용으로 보장)
    // - successfulPersonas: min(3) max(5)
    // - failedPersonas: min(0) max(2)
    const tally = tallyVerdicts(successfulResults);
    const oneLineConsensus = `5 페르소나 중 ${successfulResults.length}명 성공 — 다수결 합의 결과는 ${tally.majority} (${tally.score}). 합의 빌더 LLM 호출 실패로 폴백 사용.`;
    consensus = {
      verdict: tally.majority,
      score: tally.score,
      oneLineConsensus,
      agreements: [],
      disagreements: [],
      riskRanking: successfulResults.flatMap((p) => p.risks).slice(0, 5),
      modelUsed: consensusModel.name,
      successfulPersonas: successfulPersonaKeys,
      failedPersonas,
    };
    // Schema 위반 시 ParseError throw — 호출 측이 catch 해야 함.
    consensus = ConsensusSchema.parse(consensus);
  }

  // 6. DB upsert — 글로벌 캐시 (user_id NULL): 같은 종목/같은 날짜에 대해
  // 모든 사용자가 동일 결과 공유. 페르소나 model override 가 결과에 미치는
  // 영향은 v1 에서 무시 (per-user 캐시는 cost 폭발 위험).
  const today = new Date().toISOString().slice(0, 10);
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
      successfulResults.length === PERSONA_KEYS.length ? "success" : "partial",
    personas,
    consensus,
    marketSnapshot: snapshot,
  };
}
