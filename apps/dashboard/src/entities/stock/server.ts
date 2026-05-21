// stock entity — server-only entrypoint.
// RSC, API route, Server Action, scripts 에서 사용.
// Yahoo adapter (@gons/stock-analysis) 를 dashboard 친화적 이름으로 노출.
import "server-only";
import {
  fetchYahooQuotes,
  fetchYahooSearch as fetchYahooSearchRaw,
} from "@gons/stock-analysis";

export type {
  Quote,
  SearchResult,
  Fundamentals,
  AssetClass,
  Market,
} from "./model/quote-types";

export async function listMarketQuote(symbols: string[]) {
  return fetchYahooQuotes(symbols);
}

export async function fetchYahooSearch(query: string) {
  return fetchYahooSearchRaw(query);
}
