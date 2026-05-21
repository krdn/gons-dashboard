// stock-push-flip feature — server-only entrypoint.
// UI 없음 (RSC/route/cron 만 호출) — client.ts 불필요.
import "server-only";

export { detectConsensusFlip } from "./api/detect";
export type { FlipDetection, Verdict } from "./api/detect";

export { notifyFlip } from "./api/notify";
export type { NotifyResult } from "./api/notify";
