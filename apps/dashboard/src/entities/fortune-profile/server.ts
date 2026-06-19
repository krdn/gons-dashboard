// fortune-profile entity — server-only entrypoint.
// RSC, API route, Server Action, scripts 에서 사용.
// `listFortuneProfiles`/`getFortuneProfile` 는 db (postgres) 의존 — client tree 에 누출 금지.
import "server-only";

export { listFortuneProfiles } from "./api/listFortuneProfiles";
export { getFortuneProfile } from "./api/getFortuneProfile";

// 타입·상수는 양쪽 barrel 에서 노출 (type 은 비용 0, 상수는 client-safe).
export { RELATIONS, RELATION_LABEL } from "./model/types";
export type {
  FortuneProfile,
  Relation,
  Gender,
  Calendar,
} from "./model/types";
