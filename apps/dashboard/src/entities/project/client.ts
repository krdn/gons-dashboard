// project entity — client-safe entrypoint.
// "use client" 트리에서 사용. `"server-only"` import 절대 금지.

export { ProjectCard } from "./ui/ProjectCard";
export { categoryStyle } from "./lib/categoryStyle";
export type { CategoryStyle } from "./lib/categoryStyle";

// 카테고리 메타 + 호스트 리스트는 client 트리에서도 표시용으로 쓰일 수 있음.
export {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "./config/knownComposeProjects";

export type { Project } from "./model/types";
