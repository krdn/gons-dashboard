// stock entity — server-only entrypoint.
// RSC, API route, Server Action, scripts 에서 사용.
// Phase 2 에서 listMarketQuote/fetchYahooSearch 구현 예정 (외부 시세 API 호출).
import "server-only";

export type { Quote, SearchResult, AssetClass, Market } from "./model/quote-types";

export async function listMarketQuote(_symbols: string[]): Promise<unknown> {
  throw new Error("listMarketQuote: Phase 2 에서 구현");
}

export async function fetchYahooSearch(_query: string): Promise<unknown> {
  throw new Error("fetchYahooSearch: Phase 2 에서 구현");
}
