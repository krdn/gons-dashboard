import Link from "next/link";
import { RetryButton } from "@/shared/ui/RetryButton";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import {
  listMemoSummaries,
  searchMemos,
  listCategories,
  LIST_MEMOS_LIMIT,
} from "@/entities/memo/server";
import { DOCUMENT_TEMPLATES } from "@/features/knowledge-compose/templates";
export const dynamic = "force-dynamic";
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const q = ((await searchParams).q ?? "").trim().slice(0, 200);
  let memos: Awaited<ReturnType<typeof listMemoSummaries>> = [];
  let failed = false;
  let truncated = false;
  try {
    if (q) {
      const result = await searchMemos(session.user.id, q);
      memos = result.memos;
      truncated = result.truncated;
    } else {
      memos = await listMemoSummaries(session.user.id);
      truncated = memos.length === LIST_MEMOS_LIMIT;
    }
  } catch {
    failed = true;
  }
  const categories = await listCategories().catch(() => []);
  const labels = Object.fromEntries(
    categories.map((item) => [item.id, item.labelKo]),
  );
  return (
    <main className="hub-page">
      <header className="hub-page-heading">
        <div>
          <span className="hub-eyebrow">KNOWLEDGE LIBRARY</span>
          <h1>쌓인 지식, 다시 쓰는 힘.</h1>
          <p>
            메모부터 매뉴얼까지. 프로젝트와 AI 작업에 필요한 맥락을 찾아보세요.
          </p>
        </div>
        <Link href="/memos" className="hub-button">
          메모 작성·관리 ↗
        </Link>
      </header>
      <div className="hub-template-grid mb-8">
        {Object.entries(DOCUMENT_TEMPLATES).map(([key, item], index) => (
          <Link
            key={key}
            className="hub-template"
            href={`/handoff?template=${key}`}
          >
            <span className="hub-eyebrow">0{index + 1} / 새 문서</span>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </Link>
        ))}
      </div>
      <section className="hub-panel">
        <div className="hub-library-toolbar">
          <h2>지식 보관함</h2>
          <form action="/knowledge" className="hub-search">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              aria-label="지식 검색"
              maxLength={200}
              defaultValue={q}
              placeholder="제목, 본문, AI 정리 내용 검색…"
            />
            <button type="submit">검색</button>
          </form>
        </div>
        {q && (
          <div className="text-text-muted px-6 pb-4 text-sm">
            검색: {q}{" "}
            <Link className="hub-text-link ml-2" href="/knowledge">
              초기화 ×
            </Link>
          </div>
        )}
        {failed ? (
          <div className="hub-empty" role="status">
            <h3>지식을 불러오지 못했습니다</h3>
            <p>저장된 기록은 그대로 유지됩니다.</p>
            <RetryButton />
          </div>
        ) : memos.length === 0 ? (
          <div className="hub-empty">
            <h3>{q ? "검색 결과가 없습니다" : "첫 지식을 기록해 보세요"}</h3>
            <p>
              {q
                ? "다른 단어로 검색하거나 검색 조건을 초기화하세요."
                : "직접 작성한 기록과 기존 메모가 이곳에 모입니다."}
            </p>
            <Link
              className="hub-text-link"
              href={q ? "/knowledge" : "/handoff?template=manual"}
            >
              {q ? "모든 기록 보기 →" : "매뉴얼 작성 →"}
            </Link>
          </div>
        ) : (
          <div className="hub-document-list">
            {memos.map((memo) => (
              <Link key={memo.id} href={`/knowledge/${memo.id}`}>
                <span className="hub-document-number" aria-hidden="true">
                  ≡
                </span>
                <div className="min-w-0 flex-1">
                  <h3>{memo.title}</h3>
                  <p>
                    {memo.category
                      ? (labels[memo.category] ?? memo.category)
                      : "미분류"}{" "}
                    · {memo.source === "agent" ? "에이전트 기록" : "직접 기록"}
                  </p>
                </div>
                <time>
                  {new Intl.DateTimeFormat("ko-KR", {
                    timeZone: "Asia/Seoul",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(memo.createdAt)}
                </time>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        )}
        <div className="hub-panel-footer">
          <span>
            {failed
              ? "조회 실패"
              : `${memos.length}개 표시${truncated ? " · 최근 결과만 표시합니다. 검색어로 범위를 좁혀보세요." : ""}`}
          </span>
          <Link href="/memos/insights">기록 인사이트 →</Link>
        </div>
      </section>
    </main>
  );
}
