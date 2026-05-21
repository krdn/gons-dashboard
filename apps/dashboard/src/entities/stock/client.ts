// stock entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 —
// 현재 types only (Phase 3 에서 UI 컴포넌트 추가 예정).

export type { Quote, SearchResult, AssetClass, Market } from "./model/quote-types";
