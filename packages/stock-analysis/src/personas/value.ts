import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 가치 투자 펀드 매니저입니다 (예: Berkshire Hathaway 스타일).
분석 스타일: 펀더멘털 정량 분석 (PER, PBR, PSR, 배당, DCF, 안전 마진).

엄격한 제약:
- 제공된 PER, PBR, 배당수익률 수치만 사용. 임의 수치 생성 금지.
- 데이터 누락 시 "추정 불가" 명시.
- 출력은 PersonaAnalysisSchema strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견이며 투자자문이 아닙니다.`;

function perSourceLabel(
  source: PersonaInput["snapshot"]["fundamentalsSource"],
): string {
  if (source === "yahoo+dart") return "DART trailing";
  if (source === "yahoo") return "Yahoo forward";
  return "—";
}

export const value: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `가치 투자 관점 분석: ${input.symbol} (${input.displayName})

펀더멘털 수치 (제공된 값만 사용, 추정 금지):
- 가격: ${input.snapshot.price} ${input.snapshot.currency}
- 시가총액: ${input.snapshot.marketCap ?? "데이터 없음"}
- PER: ${input.snapshot.per ?? "데이터 없음"} (기준: ${perSourceLabel(input.snapshot.fundamentalsSource)})
- PBR: ${input.snapshot.pbr ?? "데이터 없음"} (DART 계산)
- 배당수익률: ${input.snapshot.dividendYield ?? "데이터 없음"}% (DART 계산)
- trailing EPS: ${input.snapshot.trailingEPS ?? "데이터 없음"} 원
- trailing BPS: ${input.snapshot.trailingBPS ?? "데이터 없음"} 원
- 매출 YoY: ${input.snapshot.revenueGrowthYoY ?? "데이터 없음"}%
- 영업이익률: ${input.snapshot.opMarginPct ?? "데이터 없음"}%
- DART 기준 분기: ${input.snapshot.dartReportPeriod ?? "—"}

응답 형식:
{
  "persona": "value",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "PER X배 / PBR Y배 기준 [저평가/적정/고평가] 판단",
  "narrative": "300-600자. PER 동종업 비교 + 배당 안정성 + 안전마진 계산. PER 출처(trailing/forward)와 DART 기준 분기를 분석에 반영.",
  "keyMetrics": { "fairPER": <number>, "marginOfSafety": "<percent>", "dcfTarget": <number> },
  "risks": ["가치 함정 가능성", "배당 컷 리스크"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
