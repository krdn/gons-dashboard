import "server-only";
import { auth } from "@/shared/lib/auth";
import { getLatestDigest, getMemosByIds } from "@/entities/memo/server";
import { MemoDigestView } from "./MemoDigestView";

// WIDGET_REGISTRY entry — 인자 없는 async RSC (RecentMemosCard 전례).
// digest 행이 아직 없으면(첫 일요일 전) 위젯 자체를 렌더하지 않는다 — 노이즈 방지.
export async function MemoDigestCard() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const digest = await getLatestDigest(userId);
  if (!digest) return null;

  // 재부상 id 스냅샷 → 소유자 스코프 조회. 삭제된 메모는 자연 누락 (스펙 §5).
  const resurfacedRows = await getMemosByIds(userId, digest.resurfacedMemoIds);
  const byId = new Map(resurfacedRows.map((m) => [m.id, m]));
  const resurfaced = digest.resurfacedMemoIds
    .map((id) => byId.get(id))
    .filter((m) => m !== undefined)
    .map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt }));

  return (
    <MemoDigestView
      weekEnd={digest.weekEnd}
      summary={digest.summary}
      memoCount={digest.memoCount}
      resurfaced={resurfaced}
    />
  );
}
