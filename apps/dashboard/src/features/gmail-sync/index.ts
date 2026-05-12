// Public API for features/gmail-sync
export { syncInbox } from "./api/syncInbox";
export type { SyncResult } from "./api/syncInbox";
export { fullRescan } from "./lib/full-rescan";
export type { FullRescanResult } from "./lib/full-rescan";
export { reclassifyRecent } from "./api/reclassifyRecent";
export type {
  ReclassifyRecentParams,
  ReclassifyRecentResult,
} from "./api/reclassifyRecent";
