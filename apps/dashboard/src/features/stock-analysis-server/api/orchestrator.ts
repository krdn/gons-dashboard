// analyzeStock 오케스트레이터 — 5 페르소나 병렬 호출 + 합의 + 글로벌 캐시 upsert.
// saju 의 getOrBuildNarrative 패턴 미러.
//
// Flow (PR 2):
// 1. Yahoo (quote / fundamentals / 일봉) + DART (KR 종목만) 4-way 병렬 fetch
// 2. mergeSnapshot 으로 yahoo + DART 우선순위 머지
// 3. 사용자별 페르소나 모델 매핑 해석
// 4. hasFundamentals 검사 — value 페르소나 skip 여부 결정 (PR #119 유지)
// 5. 활성 페르소나 병렬 호출 (Promise.allSettled — 1-2명 실패 허용)
// 6. 성공 >= 3 인 경우만 합의 빌더 호출 + DB upsert (promptVersion 전달)
// 7. 합의 빌더 실패 시 tallyVerdicts 다수결 fallback
import "server-only";
import {
  PERSONA_BUILDERS,
  PERSONA_PROMPT_VERSION,
  PersonaAnalysisSchema,
  ConsensusSchema,
  buildConsensusPrompt,
  tallyVerdicts,
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchDartFinancials,
  type PersonaAnalysis,
  type PersonaKey,
  type Consensus,
  type MarketSnapshot,
} from "@gons/stock-analysis";
import {
  resolvePersonaModels,
  upsertAnalysis,
} from "@/entities/stock-analysis/server";
import type { PortfolioHolding } from "@/entities/portfolio-holding/server";
import { env } from "@/shared/config/env";
import { mergeSnapshot } from "./merge-snapshot";
import { callLlmAndParseWithRetry } from "./llm-call";
import { getCachedDailyOHLC } from "./cached-daily-ohlc";

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

// stdout 한 줄 JSON — source 가용성 추적용. 운영에서 grep 모니터링.
function logSnapshotSources(
  symbol: string,
  info: { yahoo: boolean; dart: boolean; source: string | undefined },
): void {
  console.log(
    JSON.stringify({
      level: "info",
      scope: "stock-analysis",
      event: "snapshot-sources",
      ts: new Date().toISOString(),
      symbol,
      ...info,
    }),
  );
}

export async function analyzeStock(
  args: AnalyzeStockArgs,
): Promise<AnalyzeStockResult> {
  // 1. DART 는 KR 종목 + key 있음 + 토글 ON 모두 만족 시에만.
  const isKrx = args.symbol.endsWith(".KS") || args.symbol.endsWith(".KQ");
  const krxCode = isKrx ? args.symbol.replace(/\.(KS|KQ)$/, "") : null;
  const enableDart =
    env.STOCK_FUNDAMENTALS_SOURCES !== "off" &&
    krxCode != null &&
    env.DART_OPENAPI_AUTH_KEY != null;

  // 2. 4-way 병렬 fetch — DART 는 wrapped catch (실패 시 null, yahoo 만으로 진행)
  const [quotes, yahooFund, dailyOHLC, dartResult] = await Promise.all([
    fetchYahooQuotes([args.symbol]),
    fetchYahooFundamentals(args.symbol).catch(() => null),
    getCachedDailyOHLC(args.symbol, "1y").catch(() => []),
    enableDart && krxCode
      ? fetchDartFinancials(krxCode, env.DART_OPENAPI_AUTH_KEY!).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  if (quotes.length === 0) {
    return {
      status: "failed",
      personas: {},
      consensus: null,
      marketSnapshot: null,
    };
  }

  // 3. mergeSnapshot 으로 우선순위 머지 (DART > yahoo)
  // MA20/MA60/RSI14 계산은 mergeSnapshot 내부에서 처리 (main의 fix #121 동작 유지).
  const closes = dailyOHLC.map((d) => d.close);
  const snapshot = mergeSnapshot(quotes[0], yahooFund, dartResult, closes);
  logSnapshotSources(args.symbol, {
    yahoo: !!yahooFund,
    dart: !!dartResult,
    source: snapshot.fundamentalsSource,
  });

  // 4. 페르소나별 모델 해석 (user override + default 머지)
  const models = await resolvePersonaModels(args.userId);

  // 5. 펀더멘털 전무 시 value 페르소나 skip — PR #119 유지.
  //    PR 2: trailingEPS/BPS 도 hasFundamentals 신호로 — DART 만 있어도 value 활성.
  const hasFundamentals =
    snapshot.per != null ||
    snapshot.pbr != null ||
    snapshot.marketCap != null ||
    snapshot.dividendYield != null ||
    snapshot.trailingEPS != null ||
    snapshot.trailingBPS != null;
  const activePersonaKeys: PersonaKey[] = hasFundamentals
    ? PERSONA_KEYS
    : PERSONA_KEYS.filter((k) => k !== "value");

  // 6. 활성 페르소나 병렬 호출
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

  // 7. 3명 미만 성공 시 캐시 저장 안 함 (incomplete result 는 cache pollution).
  if (successfulResults.length < MINIMUM_SUCCESS) {
    return {
      status: "failed",
      personas,
      consensus: null,
      marketSnapshot: snapshot,
    };
  }

  // 8. 합의 빌더
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
    consensus = ConsensusSchema.parse(consensus);
  }

  // 9. DB upsert — promptVersion 동적 전달 (PERSONA_PROMPT_VERSION="v2").
  //    v1 cache row 는 매칭 안 됨 → 다음 호출에서 자동 재분석.
  const today = new Date().toISOString().slice(0, 10);
  await upsertAnalysis({
    symbol: args.symbol,
    analysisDate: today,
    userId: null,
    personas,
    consensus,
    marketSnapshot: snapshot,
    promptVersion: PERSONA_PROMPT_VERSION,
  });

  return {
    status:
      successfulResults.length === PERSONA_KEYS.length ? "success" : "partial",
    personas,
    consensus,
    marketSnapshot: snapshot,
  };
}
