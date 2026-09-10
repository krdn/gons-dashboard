import Link from "next/link";
import { RetryButton } from "@/shared/ui/RetryButton";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getHostsWithSummary } from "@/features/host-catalog";
import {
  listMemoSummaries,
  searchMemos,
  LIST_MEMOS_LIMIT,
} from "@/entities/memo/server";
import { ProjectDirectory, workspaceProjects } from "@/widgets/workspace";
export const dynamic = "force-dynamic";
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const view = params.view === "briefs" ? "briefs" : "runtime";
  const q = (params.q ?? "").trim().slice(0, 200);
  let summaries: Awaited<ReturnType<typeof getHostsWithSummary>> = [];
  let briefs: Awaited<ReturnType<typeof listMemoSummaries>> = [];
  let failed = false;
  let truncated = false;
  try {
    if (view === "runtime") summaries = await getHostsWithSummary();
    else if (q) {
      const result = await searchMemos(session.user.id, q, "workspace-project");
      briefs = result.memos;
      truncated = result.truncated;
    } else {
      briefs = await listMemoSummaries(session.user.id, "workspace-project");
      truncated = briefs.length === LIST_MEMOS_LIMIT;
    }
  } catch {
    failed = true;
  }
  const unavailable = summaries.filter((item) => !item.daemonOk);
  return (
    <main className="hub-page">
      <header className="hub-page-heading">
        <div>
          <span className="hub-eyebrow">PROJECT DIRECTORY</span>
          <h1>프로젝트</h1>
          <p>아이디어와 개발 기록부터 운영 중인 서비스까지.</p>
        </div>
        <Link className="hub-button primary" href="/handoff?template=project">
          + 프로젝트 브리프
        </Link>
      </header>
      <nav className="hub-source-tabs" aria-label="프로젝트 보기">
        <Link
          href="/projects"
          aria-current={view === "runtime" ? "page" : undefined}
        >
          운영 프로젝트
        </Link>
        <Link
          href="/projects?view=briefs"
          aria-current={view === "briefs" ? "page" : undefined}
        >
          프로젝트 브리프
        </Link>
        <Link href="/monitoring/github">저장소 · 개발 현황 ↗</Link>
      </nav>
      <div className="hub-inline-guide">
        <strong>
          {view === "runtime"
            ? "호스트에서 자동 발견"
            : "배포 전 프로젝트도 이곳에서"}
        </strong>
        <span>
          {view === "runtime"
            ? "연결된 호스트에서 발견한 서비스입니다. 브리프에서 목적·문서·다음 단계를 별도로 관리하세요."
            : "프로젝트 브리프를 작성하면 여기에 등록됩니다. 문서 유형은 제목을 바꾸어도 유지됩니다."}
        </span>
      </div>
      {(failed || unavailable.length > 0) && (
        <div role="status" className="hub-notice">
          {failed
            ? "프로젝트 목록을 불러오지 못했습니다."
            : `호스트 조회 실패: ${unavailable.map((item) => item.host.name).join(", ")}. 해당 호스트의 프로젝트는 목록에 포함되지 않았습니다.`}{" "}
          <RetryButton />
        </div>
      )}
      {view === "runtime" ? (
        <ProjectDirectory
          projects={workspaceProjects(summaries)}
          unavailable={failed || unavailable.length > 0}
        />
      ) : (
        <>
          <form action="/projects" className="hub-search mb-6">
            <input type="hidden" name="view" value="briefs" />
            <input
              aria-label="프로젝트 브리프 검색"
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="프로젝트 이름, 저장소, 본문 검색…"
            />
            <button type="submit">검색</button>
            {q && (
              <Link
                className="hub-text-link shrink-0"
                href="/projects?view=briefs"
              >
                초기화
              </Link>
            )}
          </form>
          {!failed && briefs.length === 0 ? (
            <div className="hub-panel hub-empty">
              <h2>
                {q ? "검색 결과가 없습니다" : "첫 프로젝트를 기록해 보세요"}
              </h2>
              <p>
                {q
                  ? "다른 단어로 검색해 보세요."
                  : "저장소와 목적, 현재 단계와 다음 마일스톤을 브리프에 남기세요."}
              </p>
              <Link
                className="hub-button primary"
                href="/handoff?template=project"
              >
                프로젝트 브리프 작성
              </Link>
            </div>
          ) : (
            <div className="hub-project-grid">
              {briefs.map((brief) => (
                <article className="hub-project" key={brief.id}>
                  <div className="hub-section-heading">
                    <span className="hub-eyebrow">PROJECT BRIEF</span>
                    <span className="hub-badge">직접 기록</span>
                  </div>
                  <h2 className="break-words text-base font-semibold">
                    <Link href={`/knowledge/${brief.id}`}>
                      {brief.title.replace(/^\[프로젝트 브리프\]\s*/, "")}
                    </Link>
                  </h2>
                  <p className="text-text-muted my-4 text-xs">
                    최근 수정{" "}
                    {new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      dateStyle: "medium",
                    }).format(brief.updatedAt)}
                  </p>
                  <div className="hub-project-actions">
                    <Link href={`/knowledge/${brief.id}`}>
                      브리프 열기 · 수정 →
                    </Link>
                    <Link
                      href={`/handoff?project=${encodeURIComponent(brief.title.replace(/^\[프로젝트 브리프\]\s*/, ""))}`}
                    >
                      AI 인계 작성 →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="text-text-muted mt-4 text-xs">
            {failed
              ? "조회 실패"
              : `${briefs.length}개 표시${truncated ? " · 최근 결과입니다. 검색으로 범위를 좁혀보세요." : ""}`}{" "}
            · 브리프는 개인 지식 보관함에도 보관됩니다.
          </p>
        </>
      )}
    </main>
  );
}
