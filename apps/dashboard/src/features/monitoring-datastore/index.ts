// DB/Redis liveness 판정 (이슈 #323 §G, Phase 3).
// 순수 함수 + 설정만 — server-only 의존이 없어 barrel seam 분리 불필요(Gotcha #7).
export { judgeDatastores } from "./lib/judgeDatastores";
export {
  DATASTORE_INSTANCES,
  type DatastoreInstance,
} from "./config/instances";
