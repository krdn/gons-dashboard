// stock-analysis-server feature — server-only entrypoint.
// RSC, API route, server-side orchestrator 에서 사용.
// `analyzeStock` 은 packages/stock-analysis (Yahoo adapter + LLM) + entities/stock-analysis/server (Drizzle) 의존 —
// client tree 에 누출되면 `postgres`/`net`/`tls`/`perf_hooks` module-not-found 로 next build 실패.
import "server-only";

export { analyzeStock } from "./api/orchestrator";
export type {
  AnalyzeStockArgs,
  AnalyzeStockResult,
} from "./api/orchestrator";

// triggerAnalysis 는 "use server" Server Action — RPC 경계가 있어 client 도 호출 가능하지만,
// 모듈 그래프 상 같은 barrel 에서 export 하면 Turbopack 이 server-only 친구들까지 끌어옴.
// client 호출자는 ./client entrypoint 사용.
export { triggerAnalysis } from "./api/trigger";
export type { TriggerResult } from "./api/trigger";
