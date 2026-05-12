// cleanup-projects의 pure 로직만 분리 (단위 테스트 가능).

export type ProjectIdRow = {
  id: string;
  composeProject: string;
};

export function computeZombieIds(
  dbRows: readonly ProjectIdRow[],
  liveComposeSet: ReadonlySet<string>,
  whitelistSet: ReadonlySet<string>,
): string[] {
  const known = new Set([...liveComposeSet, ...whitelistSet]);
  return dbRows
    .filter((r) => !known.has(r.composeProject))
    .map((r) => r.id);
}
