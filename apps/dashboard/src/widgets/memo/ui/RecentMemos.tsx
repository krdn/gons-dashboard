import Link from "next/link";
import type { Memo } from "@/entities/memo/client";

interface RecentMemosProps {
  memos: Memo[];
}

// 메인 대시보드용 읽기 전용 요약 — 최근 3개. 인터랙션 없어 서버 컴포넌트로 렌더.
export function RecentMemos({ memos }: RecentMemosProps) {
  const recent = memos.slice(0, 3);
  return (
    <section className="rounded-xl border border-neutral-200 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">최근 메모</h2>
        <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
          전체 보기 →
        </Link>
      </header>
      {recent.length === 0 ? (
        <p className="text-sm text-neutral-400">아직 메모가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((m) => (
            <li key={m.id} className="truncate text-sm text-neutral-700">
              <span className="text-neutral-400">{m.source === "voice" ? "🎙" : m.source === "agent" ? "🤖" : "✍"}</span> {m.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
