// KRX (KOSPI/KOSDAQ) 주요 종목 한글 → Yahoo 심볼 매핑.
// Yahoo v1/finance/search 가 한글 쿼리를 "Invalid Search Query" 로 거부하기 때문에
// 한글 입력은 이 정적 맵으로 substring 매칭하여 폴백 검색을 제공한다.
//
// 운영 정책:
// - v1.0 은 사용자 1인용 → KOSPI/KOSDAQ Top 종목 ~50개로 충분
// - 신규 종목 요청은 PR 한 줄 추가로 처리
// - 각 심볼은 v8 chart 로 ping 검증 후 commit (scripts/verify-krx-symbols.ts)
// - v1.1 KIS/Polygon 폴백 도입 시 이 맵은 cache 역할로 유지

import type { NormalizedSearchResult } from "./normalized-types";

export interface KrxEntry {
  symbol: string; // Yahoo 심볼 (e.g. "005930.KS")
  ko: string; // 한글 종목명
  exchange: "KSE" | "KOSDAQ";
}

// KOSPI 대형주 + KOSDAQ 주요 종목. 약 50개.
// 우선주(우)는 일부만 — 사용자 요청 시 추가.
export const KRX_SYMBOLS: KrxEntry[] = [
  // ─── KOSPI Top ───
  { symbol: "005930.KS", ko: "삼성전자", exchange: "KSE" },
  { symbol: "005935.KS", ko: "삼성전자우", exchange: "KSE" },
  { symbol: "000660.KS", ko: "SK하이닉스", exchange: "KSE" },
  { symbol: "207940.KS", ko: "삼성바이오로직스", exchange: "KSE" },
  { symbol: "373220.KS", ko: "LG에너지솔루션", exchange: "KSE" },
  { symbol: "005380.KS", ko: "현대차", exchange: "KSE" },
  { symbol: "000270.KS", ko: "기아", exchange: "KSE" },
  { symbol: "068270.KS", ko: "셀트리온", exchange: "KSE" },
  { symbol: "105560.KS", ko: "KB금융", exchange: "KSE" },
  { symbol: "055550.KS", ko: "신한지주", exchange: "KSE" },
  { symbol: "035420.KS", ko: "NAVER", exchange: "KSE" },
  { symbol: "035720.KS", ko: "카카오", exchange: "KSE" },
  { symbol: "012330.KS", ko: "현대모비스", exchange: "KSE" },
  { symbol: "051910.KS", ko: "LG화학", exchange: "KSE" },
  { symbol: "006400.KS", ko: "삼성SDI", exchange: "KSE" },
  { symbol: "066570.KS", ko: "LG전자", exchange: "KSE" },
  { symbol: "003550.KS", ko: "LG", exchange: "KSE" },
  { symbol: "032830.KS", ko: "삼성생명", exchange: "KSE" },
  { symbol: "017670.KS", ko: "SK텔레콤", exchange: "KSE" },
  { symbol: "030200.KS", ko: "KT", exchange: "KSE" },
  { symbol: "015760.KS", ko: "한국전력", exchange: "KSE" },
  { symbol: "034730.KS", ko: "SK", exchange: "KSE" },
  { symbol: "086790.KS", ko: "하나금융지주", exchange: "KSE" },
  { symbol: "138040.KS", ko: "메리츠금융지주", exchange: "KSE" },
  { symbol: "316140.KS", ko: "우리금융지주", exchange: "KSE" },
  { symbol: "009150.KS", ko: "삼성전기", exchange: "KSE" },
  { symbol: "010130.KS", ko: "고려아연", exchange: "KSE" },
  { symbol: "003670.KS", ko: "포스코퓨처엠", exchange: "KSE" },
  { symbol: "005490.KS", ko: "POSCO홀딩스", exchange: "KSE" },
  { symbol: "011200.KS", ko: "HMM", exchange: "KSE" },
  { symbol: "009540.KS", ko: "HD한국조선해양", exchange: "KSE" },
  { symbol: "010140.KS", ko: "삼성중공업", exchange: "KSE" },
  { symbol: "047810.KS", ko: "한국항공우주", exchange: "KSE" },
  { symbol: "267260.KS", ko: "HD현대일렉트릭", exchange: "KSE" },
  { symbol: "329180.KS", ko: "HD현대중공업", exchange: "KSE" },
  { symbol: "012450.KS", ko: "한화에어로스페이스", exchange: "KSE" },
  { symbol: "402340.KS", ko: "SK스퀘어", exchange: "KSE" },
  { symbol: "352820.KS", ko: "하이브", exchange: "KSE" },
  { symbol: "041510.KQ", ko: "에스엠", exchange: "KOSDAQ" },
  { symbol: "035900.KQ", ko: "JYP Ent", exchange: "KOSDAQ" },
  { symbol: "036570.KS", ko: "엔씨소프트", exchange: "KSE" },
  { symbol: "251270.KS", ko: "넷마블", exchange: "KSE" },
  { symbol: "259960.KS", ko: "크래프톤", exchange: "KSE" },
  // ─── KOSDAQ Top ───
  { symbol: "247540.KQ", ko: "에코프로비엠", exchange: "KOSDAQ" },
  { symbol: "086520.KQ", ko: "에코프로", exchange: "KOSDAQ" },
  { symbol: "196170.KQ", ko: "알테오젠", exchange: "KOSDAQ" },
  // 엘앤에프: 코스닥 → 코스피 이전상장으로 .KS 사용 (2024 이전상장).
  { symbol: "066970.KS", ko: "엘앤에프", exchange: "KSE" },
  // 셀트리온헬스케어 (091990) 는 2024 셀트리온 본사 합병으로 상장폐지 → 맵에서 제거.
  { symbol: "058470.KQ", ko: "리노공업", exchange: "KOSDAQ" },
  { symbol: "112040.KQ", ko: "위메이드", exchange: "KOSDAQ" },
  { symbol: "293490.KQ", ko: "카카오게임즈", exchange: "KOSDAQ" },
  { symbol: "263750.KQ", ko: "펄어비스", exchange: "KOSDAQ" },
];

// 한글 (가-힣) 문자가 하나라도 포함되면 true.
export function isHangul(s: string): boolean {
  return /[가-힯]/.test(s);
}

// 쿼리 정규화 — 공백, "(주)", "주식회사" 제거 + 소문자화.
function normalize(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/\(주\)/g, "")
    .replace(/주식회사/g, "")
    .toLowerCase();
}

// 한글 substring 검색 — 정규화한 쿼리가 정규화한 종목명에 포함되면 매칭.
export function searchKrxSymbols(query: string): NormalizedSearchResult[] {
  const q = normalize(query);
  if (q.length === 0) return [];
  return KRX_SYMBOLS.filter((e) => normalize(e.ko).includes(q))
    .slice(0, 10)
    .map((e) => ({
      symbol: e.symbol,
      displayName: e.ko,
      assetClass: "stock",
      market: "KRX",
      exchange: e.exchange,
    }));
}
