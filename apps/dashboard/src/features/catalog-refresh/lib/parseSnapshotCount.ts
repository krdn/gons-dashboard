// 스냅샷 스크립트의 완료 로그에서 생성 개수를 뽑는 순수 함수.
// 세 스크립트 모두 "✅ 생성 N개" 형식을 공유한다:
//   [snapshot-skills]  ✅ 생성 38개 / skip 2개 / 한글 overlay 36개
//   [snapshot-plugins] ✅ 생성 12개 / 활성 8 / ...
//   [snapshot-agents]  ✅ 생성 27개 / skip 0개

/** stdout 전체에서 "생성 N개" 의 N 을 파싱. 없으면 undefined. */
export function parseSnapshotCount(stdout: string): number | undefined {
  const match = stdout.match(/생성 (\d+)개/);
  return match ? Number(match[1]) : undefined;
}
