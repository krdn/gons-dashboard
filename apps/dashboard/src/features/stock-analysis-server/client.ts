// stock-analysis-server feature — client-safe entrypoint.
// "use client" 트리에서 사용. `triggerAnalysis` 는 "use server" Server Action 이라
// Next.js 가 RPC 경계로 처리해 모듈 그래프가 끊긴다. analyzeStock 같은 server-only
// 친구를 같이 export 하면 모듈 그래프가 다시 합쳐져 client bundle 에 끌려오므로,
// 이 entrypoint 는 RPC 경계가 있는 export 만 노출.

export { triggerAnalysis } from "./api/trigger";
export type { TriggerResult } from "./api/trigger";
