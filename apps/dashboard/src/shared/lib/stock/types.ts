// Stock 도메인 cross-cutting 타입 태그.
// entities/stock 과 entities/portfolio-holding 양쪽에서 참조되므로
// FSD 의 "entities 간 직접 참조 금지" 룰을 지키려면 shared 에 두는 것이 맞다.

export type AssetClass = "stock" | "crypto" | "commodity";
export type Market = "NASDAQ" | "NYSE" | "KRX" | "CRYPTO" | "COMMODITY";
