import Link from "next/link";
import { formatWeekLabel } from "@/features/memo-digest/lib/week";

export interface ResurfacedMemoView {
  id: string;
  title: string;
  createdAt: Date;
}

interface MemoDigestViewProps {
  weekEnd: string; // 'YYYY-MM-DD'
  summary: string;
  memoCount: number;
  resurfaced: ResurfacedMemoView[];
}

// locale-free 날짜 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 인터랙션 없는 순수 표시 — 서버 컴포넌트로 렌더 (RecentMemos 전례).
export function MemoDigestView({ weekEnd, summary, memoCount, resurfaced }: MemoDigestViewProps) {
  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">주간 메모 다이제스트</h2>
        <span className="text-sm text-neutral-400">{formatWeekLabel(weekEnd)}</span>
      </header>
      {memoCount === 0 ? (
        <p className="text-sm text-neutral-400">지난주에 작성한 메모가 없습니다.</p>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-neutral-700">{summary}</p>
      )}
      {resurfaced.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs font-medium text-neutral-500">다시 보기 — 잊고 있던 메모</p>
          <ul className="space-y-1">
            {resurfaced.map((m) => (
              <li key={m.id} className="truncate text-sm text-neutral-700">
                {m.title}{" "}
                <span className="text-xs text-neutral-400">{formatDate(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link
        href="/memos"
        className="mt-3 inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        메모 전체 보기 →
      </Link>
    </section>
  );
}
