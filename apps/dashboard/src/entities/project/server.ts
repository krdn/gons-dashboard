// project entity — server-only entrypoint.
// RSC, Server Action, scripts 에서 사용. DB 쿼리 의존 — client tree 에 누출 금지.
import "server-only";

export { getProjects } from "./api/getProjects";
export { getProjectComposeKeys } from "./api/getProjectComposeKeys";
export { upsertProjectFromContainer } from "./api/upsertProjectFromContainer";
export { syncMissingProjects } from "./api/syncMissingProjects";

// scripts (cleanup-projects, seed-projects) 가 server 측에서 함께 사용.
export {
  KNOWN_COMPOSE_PROJECTS_BY_HOST,
  KNOWN_HOSTS,
} from "./config/knownComposeProjects";

export type { Project } from "./model/types";
