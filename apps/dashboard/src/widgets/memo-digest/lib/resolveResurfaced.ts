// 재부상 id 스냅샷 → 표시 목록 재구성 — 순수 함수 (MemoDigestCard에서 추출, 리뷰 반영).
// 삭제된 메모(조회 안 된 id)는 조용히 생략하고 스냅샷 순서를 보존한다 (스펙 §5).
export interface ResurfacedMemoView {
  id: string;
  title: string;
  createdAt: Date;
}

export function resolveResurfaced(
  ids: readonly string[],
  rows: readonly { id: string; title: string; createdAt: Date }[],
): ResurfacedMemoView[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: row.title, createdAt: row.createdAt }] : [];
  });
}
