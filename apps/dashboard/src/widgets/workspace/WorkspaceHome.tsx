import Link from "next/link";
import { getHostsWithSummary } from "@/features/host-catalog";
import {
  listMemoSummaries,
  listCategories,
  LIST_MEMOS_LIMIT,
} from "@/entities/memo/server";
import { ProjectDirectory } from "./ProjectDirectory";
import { workspaceProjects } from "./model";

export async function WorkspaceHome({ userId }: { userId: string }) {
  const [hostResult, memoResult, categoryResult, briefResult] =
    await Promise.allSettled([
      getHostsWithSummary(),
      listMemoSummaries(userId),
      listCategories(),
      listMemoSummaries(userId, "workspace-project"),
    ]);
  const labels = Object.fromEntries(
    categoryResult.status === "fulfilled"
      ? categoryResult.value.map((item) => [item.id, item.labelKo])
      : [],
  );
  const briefs = briefResult.status === "fulfilled" ? briefResult.value : [];
  const summaries = hostResult.status === "fulfilled" ? hostResult.value : [];
  const projects = workspaceProjects(summaries);
  const failedHosts = summaries.filter((host) => !host.daemonOk);
  const partial = hostResult.status === "rejected" || failedHosts.length > 0;
  const memos = memoResult.status === "fulfilled" ? memoResult.value : [];
  const attention = projects.filter(
    (project) => project.status === "attention",
  ).length;
  const unknown = projects.filter(
    (project) => project.status === "unknown",
  ).length;
  return (
    <>
      <div className="hub-stats">
        {[
          {
            label: "연결된 프로젝트",
            value: hostResult.status === "rejected" ? "—" : projects.length,
            note: partial
              ? "일부 호스트 조회 실패"
              : "호스트에서 발견한 운영 프로젝트",
            href: "/projects",
          },
          {
            label: "확인할 프로젝트",
            value: hostResult.status === "rejected" ? "—" : attention,
            note: partial
              ? "조회 성공한 호스트 기준"
              : "컨테이너 상태 확인 필요",
            href: "/projects?status=attention",
          },
          {
            label: "컨테이너 미관측",
            value: hostResult.status === "rejected" ? "—" : unknown,
            note: "운영 상세에서 연결 상태 확인",
            href: "/projects?status=unknown",
          },
          {
            label: "최근 지식 기록",
            value: memoResult.status === "rejected" ? "—" : memos.length,
            note: `최근 최대 ${LIST_MEMOS_LIMIT}개 · 메모와 문서`,
            href: "/knowledge",
          },
        ].map((stat) => (
          <Link className="hub-stat" key={stat.label} href={stat.href}>
            <span>
              {stat.label}
              <span aria-hidden="true">↗</span>
            </span>
            <strong>{stat.value}</strong>
            <small>{stat.note}</small>
          </Link>
        ))}
      </div>
      {partial && (
        <div className="hub-notice" role="status">
          {hostResult.status === "rejected"
            ? "프로젝트 현황을 불러오지 못했습니다."
            : "일부 호스트의 현황을 확인하지 못했습니다."}{" "}
          {failedHosts.map((item) => item.host.name).join(", ")}{" "}
          <Link href="/projects">다시 조회 →</Link>
        </div>
      )}
      <div className="hub-home-grid">
        <section className="hub-panel">
          <div className="hub-section-heading px-6 pt-6">
            <div>
              <span className="hub-eyebrow">PROJECTS</span>
              <h2>프로젝트 작업 공간</h2>
            </div>
            <Link className="hub-text-link" href="/projects">
              전체 보기 →
            </Link>
          </div>
          <ProjectDirectory projects={projects} compact unavailable={partial} />
          {briefs.length > 0 && (
            <div className="border-hairline border-t px-6 py-4">
              <div className="hub-section-heading mb-3">
                <h3 className="text-sm font-semibold">
                  기록한 프로젝트 브리프
                </h3>
                <Link className="hub-text-link" href="/projects?view=briefs">
                  전체 보기 →
                </Link>
              </div>
              {briefs.slice(0, 2).map((brief) => (
                <Link
                  key={brief.id}
                  className="text-accent block truncate py-2 text-xs"
                  href={`/knowledge/${brief.id}`}
                >
                  {brief.title} →
                </Link>
              ))}
            </div>
          )}
          <div className="hub-panel-footer">
            <span>프로젝트의 상태를 확인하고 다음 작업을 이어가세요.</span>
            <Link href="/handoff?template=project">새 브리프 +</Link>
          </div>
        </section>
        <aside className="hub-next-panel">
          <span className="hub-eyebrow">CONTINUE WITH AI</span>
          <h2>
            작업은 이어지고,
            <br />
            맥락은 남도록.
          </h2>
          <p>
            오늘의 결정과 검증 결과를 기록해
            <br />
            다음 AI 세션의 출발점으로 만드세요.
          </p>
          <Link className="hub-button" href="/handoff">
            인계 문서 작성 <span aria-hidden="true">↗</span>
          </Link>
          <ol>
            <li>
              <span>01</span>목표와 현재 상태 정리
            </li>
            <li>
              <span>02</span>결정·검증·다음 단계 기록
            </li>
            <li>
              <span>03</span>저장 후 Markdown으로 전달
            </li>
          </ol>
        </aside>
      </div>
      <section className="hub-panel mt-6">
        <div className="hub-section-heading px-6 pt-6">
          <div>
            <span className="hub-eyebrow">KNOWLEDGE</span>
            <h2>최근 쌓인 지식</h2>
          </div>
          <Link className="hub-text-link" href="/knowledge">
            보관함 열기 →
          </Link>
        </div>
        {memoResult.status === "rejected" ? (
          <div className="hub-empty">
            지식 기록을 불러오지 못했습니다.{" "}
            <Link href="/knowledge">다시 조회 →</Link>
          </div>
        ) : memos.length === 0 ? (
          <div className="hub-empty">
            <h3>첫 기록이 다음 작업을 더 쉽게 만듭니다</h3>
            <p>매뉴얼, 학습 기록 또는 프로젝트 브리프부터 시작하세요.</p>
            <Link href="/handoff?template=manual" className="hub-text-link">
              첫 매뉴얼 작성 →
            </Link>
          </div>
        ) : (
          <div className="hub-document-list">
            {memos.slice(0, 4).map((memo, index) => (
              <Link key={memo.id} href={`/knowledge/${memo.id}`}>
                <span className="hub-document-number">0{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate">{memo.title}</h3>
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
                    month: "2-digit",
                    day: "2-digit",
                  }).format(memo.createdAt)}
                </time>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
