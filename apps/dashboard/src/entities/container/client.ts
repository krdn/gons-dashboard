// container entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지 —
// Turbopack 이 client bundle 에 끌어오면 빌드 실패 (옛 Gotcha #1 통증).

export { ContainerStatusBadge } from "./ui/ContainerStatusBadge";
export { ContainerRow } from "./ui/ContainerRow";

// 타입은 양쪽 barrel 에서 노출 (type-only, 비용 0).
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "./model/types";
