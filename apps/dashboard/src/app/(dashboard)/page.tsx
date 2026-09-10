import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { WorkspaceHome } from "@/widgets/workspace";
import { WIDGET_REGISTRY } from "@/app/_widgets/registry";
import { renderEntry } from "@/app/_widgets/renderEntry";
export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const date = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <main className="hub-page">
      <header className="hub-page-heading">
        <div>
          <span className="hub-eyebrow">YOUR PROJECT WORKSPACE</span>
          <h1>만든 것들을, 그다음으로.</h1>
          <p>프로젝트를 살피고, 지식을 쌓고, AI와 다음 작업을 이어가세요.</p>
        </div>
        <div className="hub-heading-actions">
          <time>{date} · KST</time>
          <Link className="hub-button primary" href="/handoff?template=project">
            + 프로젝트 브리프
          </Link>
        </div>
      </header>
      <nav className="hub-shortcuts" aria-label="빠른 작업">
        <Link href="/projects">
          <span aria-hidden="true">↗</span> 프로젝트 살펴보기
        </Link>
        <Link href="/handoff?template=manual">
          <span aria-hidden="true">≡</span> 매뉴얼 작성
        </Link>
        <Link href="/handoff?template=learning">
          <span aria-hidden="true">＋</span> 학습 기록
        </Link>
        <Link href="/memos">
          <span aria-hidden="true">✎</span> 빠른 메모
        </Link>
      </nav>
      <Suspense
        fallback={
          <div
            className="hub-loading"
            role="status"
            aria-label="워크스페이스 불러오는 중"
          >
            <div />
            <div />
            <div />
          </div>
        }
      >
        <WorkspaceHome userId={session.user.id} />
      </Suspense>
      <section className="mt-9">
        <div className="hub-section-heading">
          <div>
            <span className="hub-eyebrow">OPERATIONS</span>
            <h2>운영 체크포인트</h2>
          </div>
          <Link className="hub-text-link" href="/monitoring">
            관제 보드 →
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {WIDGET_REGISTRY.filter((w) =>
            ["monitoring-summary", "autopilot"].includes(w.id),
          ).map(renderEntry)}
        </div>
      </section>
    </main>
  );
}
