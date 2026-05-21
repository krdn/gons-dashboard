export interface YahooQuoteRaw {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  currency?: string;
  shortName?: string;
  longName?: string;
  marketCap?: number;
  trailingPE?: number;
  priceToBook?: number;
  trailingAnnualDividendYield?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}

export interface YahooQuoteResponse {
  quoteResponse: {
    result: YahooQuoteRaw[];
    error: { code: string; description: string } | null;
  };
}

export interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType: string; // 'EQUITY' | 'CRYPTOCURRENCY' | 'FUTURE' | 'ETF' | ...
  exchange?: string;
  exchDisp?: string;
}

export interface YahooSearchResponse {
  quotes: YahooSearchQuote[];
  count?: number;
}

export interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: { symbol: string; regularMarketPrice?: number; currency?: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}
