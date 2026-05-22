// 단일 소스는 @gons/stock-analysis — 여기서는 dashboard 친화적 이름으로 re-export.
// AssetClass/Market 은 cross-cutting 이라 shared 를 거쳐서 가져온다
// (entities/portfolio-holding 도 같은 경로로 import 함).
//
// `@gons/stock-analysis/client` 서브패스 — top-level entrypoint 는 yahoo-finance2
// (Node-only) 를 import 그래프에 끌어와서 client component graph 가 빌드 실패.
export type { AssetClass, Market } from "@/shared/lib/stock/types";
export type {
  NormalizedQuote as Quote,
  NormalizedSearchResult as SearchResult,
  NormalizedFundamentals as Fundamentals,
} from "@gons/stock-analysis/client";
