// 호스트의 관찰된 compose key 중 DB 에 없는 것만 골라 자동 등록.
//
// 정책 (Drizzle hidden-thrash 방지 — CONCERNS.md §1 G5):
//   - knownComposeKeys 는 hidden 을 *포함한* 전체 compose key set.
//     (visibleProjects 만 dedup 기준으로 쓰면 hidden 이 매번 unknown 으로 분류돼
//      onConflictDoUpdate thrash 가 발생한다.)
//   - 신규 키만 upsertProjectFromContainer 로 등록.
//   - 화이트리스트 외 compose 는 upsert 가 null 반환 → 결과에서 자동 제거.
//
// 호출자 책임: visibleProjects 와 결과를 합쳐서 사용. 예:
//   const visibleProjects = await getProjects(hostId);
//   const allKeys = await getProjectComposeKeys(hostId);
//   const observed = containers.map(c => c.composeProject).filter(...);
//   const created = await syncMissingProjects({ hostId, hostName, observed, knownComposeKeys: allKeys });
//   const allProjects = [...visibleProjects, ...created];

import "server-only";
import { upsertProjectFromContainer } from "./upsertProjectFromContainer";
import type { Project } from "../model/types";

export interface SyncMissingProjectsParams {
  hostId: string;
  hostName: string;
  /** 컨테이너 라벨에서 채집한 compose project 키 (중복 가능). */
  observed: string[];
  /** DB 에 이미 있는 compose project 키 (hidden 포함). dedup 기준. */
  knownComposeKeys: Iterable<string>;
}

/**
 * observed - knownComposeKeys = unknown 을 자동 등록.
 * 성공한 신규 Project 만 반환 (null 자동 필터링).
 */
export async function syncMissingProjects({
  hostId,
  hostName,
  observed,
  knownComposeKeys,
}: SyncMissingProjectsParams): Promise<Project[]> {
  const known = new Set(knownComposeKeys);
  const unknown = Array.from(
    new Set(observed.filter((k) => k != null && !known.has(k))),
  );

  if (unknown.length === 0) return [];

  const created = await Promise.all(
    unknown.map((composeProject) =>
      upsertProjectFromContainer({ hostId, hostName, composeProject }),
    ),
  );

  return created.filter((p): p is Project => p !== null);
}
