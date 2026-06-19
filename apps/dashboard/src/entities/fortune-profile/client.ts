// fortune-profile entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 —
// Turbopack 이 client bundle 에 끌어오면 빌드 실패 (Gotcha #1/#7 통증).
// 이 entity 에는 UI 컴포넌트가 없어 타입·상수만 노출한다.

export { RELATIONS, RELATION_LABEL } from "./model/types";
export type {
  FortuneProfile,
  Relation,
  Gender,
  Calendar,
} from "./model/types";
