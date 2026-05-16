// container entity — server-only entrypoint.
// RSC, API route, Server Action, scripts 에서 사용.
// `listContainers`/`inspectContainer` 는 node:child_process 의존 — client tree 에 누출 금지.
import "server-only";

export { listContainers } from "./api/listContainers";
export { inspectContainer } from "./api/inspectContainer";

// 타입은 양쪽 barrel 에서 노출 (type-only, 비용 0).
export type {
  ContainerSummary,
  ContainerInspect,
  ContainerState,
  PortMapping,
} from "./model/types";
