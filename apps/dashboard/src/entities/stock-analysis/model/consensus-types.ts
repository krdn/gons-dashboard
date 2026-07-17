// 단일 정의 소스는 @gons/stock-analysis. 여기서는 dashboard 안에서 익숙한 import path 유지 +
// boundaries 룰 회피용 re-export. (persona-types.ts 와 동일 패턴)
//
// 과거엔 MarketSnapshot/Consensus 를 수기 interface 로 복제했으나, 패키지 스키마의
// PR2 필드(trailingEPS/BPS/revenueGrowthYoY/opMarginPct/fundamentals* 등) 가 누락되어
// 타입 드리프트가 발생했다. 패키지(`./schemas/consensus.ts`) 가 source of truth.
//
// `@gons/stock-analysis/client` 서브패스 사용 — top-level entrypoint 는 yahoo-finance2
// (Node-only) 를 끌어와서 client component graph 가 빌드 실패한다 (Gotcha #7 패턴).
export type { Consensus, MarketSnapshot } from "@gons/stock-analysis/client";
