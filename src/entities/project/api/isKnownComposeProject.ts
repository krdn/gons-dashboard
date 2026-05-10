import { KNOWN_COMPOSE_PROJECTS_BY_HOST } from "../config/knownComposeProjects";

/**
 * 주어진 (hostName, composeProject) 쌍이 화이트리스트에 등록되어 있는지 확인한다.
 *
 * - 등록되지 않은 host는 보수적으로 false를 반환한다.
 *   새로운 host를 추가하려면 knownComposeProjects.ts를 수동으로 갱신해야 한다.
 * - Task 3의 upsertProjectFromContainer에서 unknown compose를 silent skip하는 데 사용된다.
 */
export function isKnownComposeProject(
  hostName: string,
  composeProject: string,
): boolean {
  const set = KNOWN_COMPOSE_PROJECTS_BY_HOST[hostName];
  if (!set) return false;
  return set.has(composeProject);
}
