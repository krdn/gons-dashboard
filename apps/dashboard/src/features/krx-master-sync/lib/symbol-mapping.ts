// 공공데이터 API 는 6자리 코드 + KOSPI/KOSDAQ marketCategory 만 제공.
// Yahoo 심볼은 KOSPI=".KS", KOSDAQ=".KQ" 접미사 필요.
export function toYahooSymbol(
  krxCode: string,
  marketCategory: "KOSPI" | "KOSDAQ",
): string {
  const suffix = marketCategory === "KOSPI" ? ".KS" : ".KQ";
  return `${krxCode}${suffix}`;
}

// API 응답에는 securityType 필드가 없어 종목명에서 추론.
// 우선순위: REIT > ETN > SPAC > ETF > EQUITY
export type SecurityType = "EQUITY" | "ETF" | "ETN" | "REIT" | "SPAC";

const ETF_PREFIXES = [
  "KODEX",
  "TIGER",
  "ARIRANG",
  "ACE",
  "KBSTAR",
  "HANARO",
  "SOL",
  "PLUS",
  "RISE",
  "WOORI",
  "마이티",
  "히어로즈",
];

export function inferSecurityType(koreanName: string): SecurityType {
  const upper = koreanName.toUpperCase();
  if (koreanName.includes("리츠")) return "REIT";
  if (upper.includes("ETN")) return "ETN";
  if (koreanName.includes("스팩")) return "SPAC";
  for (const p of ETF_PREFIXES) {
    if (upper.startsWith(p.toUpperCase())) {
      return "ETF";
    }
  }
  return "EQUITY";
}
