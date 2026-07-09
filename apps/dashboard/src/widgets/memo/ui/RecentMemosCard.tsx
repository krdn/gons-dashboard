import "server-only";
import { auth } from "@/shared/lib/auth";
import { listMemos } from "@/entities/memo/server";
import { RecentMemos } from "./RecentMemos";

// WIDGET_REGISTRY entry — 인자 없는 async RSC. 세션 조회 + 데이터 fetch를 내부에서 수행.
export async function RecentMemosCard() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const memos = await listMemos(session.user.id);
  return <RecentMemos memos={memos} />;
}
