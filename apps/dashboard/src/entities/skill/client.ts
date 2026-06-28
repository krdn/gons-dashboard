// skill entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 (Gotcha #1/#7).
// UI 컴포넌트는 widgets/skill-catalog 에 있으므로 여기는 타입·상수만 노출.

export { SOURCE_LABEL } from "./model/types";
export type { SkillMeta, SkillBody, SkillSource } from "./model/types";
