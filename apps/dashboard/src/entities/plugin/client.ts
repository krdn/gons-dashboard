// plugin entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 (Gotcha #1/#7).
// UI 컴포넌트는 widgets/plugin-catalog 에 있으므로 여기는 타입·상수만 노출.

export { STATUS_LABEL } from "./model/types";
export type {
  PluginMeta,
  PluginStatus,
  PluginComponentCounts,
  PluginComponents,
  PluginMarketplaceMeta,
} from "./model/types";
