"use client";
import Link from "next/link";
import { RetryButton } from "@/shared/ui/RetryButton";
import { type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  STATUS_LABELS,
  type WorkspaceProject,
  type ProjectStatus,
} from "./model";

export function ProjectDirectory({
  projects,
  compact = false,
  unavailable = false,
}: {
  projects: WorkspaceProject[];
  compact?: boolean;
  unavailable?: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const query = compact ? "" : (params.get("q") ?? "");
  const requestedStatus = params.get("status") ?? "all";
  const requestedHost = params.get("host") ?? "all";
  const status =
    !compact && Object.hasOwn(STATUS_LABELS, requestedStatus)
      ? requestedStatus
      : "all";
  const host =
    !compact && projects.some((project) => project.host === requestedHost)
      ? requestedHost
      : "all";
  const filtered = projects.filter(
    (project) =>
      `${project.name} ${project.key} ${project.description ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "all" || project.status === status) &&
      (host === "all" || project.host === host),
  );
  const visible = compact ? filtered.slice(0, 6) : filtered;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ["q", "status", "host"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value && value !== "all") next.set(key, value);
    }
    window.history.replaceState(null, "", `${pathname}?${next.toString()}`);
  }
  return (
    <div>
      {!compact && (
        <form className="hub-filters" action="/projects" onSubmit={submit}>
          <label className="hub-search">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              aria-label="프로젝트 검색"
              defaultValue={query}
              key={query}
              placeholder="프로젝트 이름, 설명 검색…"
            />
            <button type="submit">검색</button>
          </label>
          <label className="sr-only" htmlFor="project-status">
            프로젝트 상태
          </label>
          <select
            id="project-status"
            name="status"
            value={status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="all">모든 상태</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="project-host">
            호스트
          </label>
          <select
            id="project-host"
            name="host"
            value={host}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            <option value="all">모든 호스트</option>
            {Array.from(new Set(projects.map((project) => project.host))).map(
              (name) => (
                <option key={name}>{name}</option>
              ),
            )}
          </select>
        </form>
      )}
      {visible.length === 0 ? (
        <div className="hub-empty">
          <h3>
            {projects.length === 0
              ? unavailable
                ? "프로젝트 현황을 확인할 수 없습니다"
                : "아직 연결된 프로젝트가 없습니다"
              : "조건에 맞는 프로젝트가 없습니다"}
          </h3>
          <p>
            {projects.length === 0
              ? unavailable
                ? "조회에 실패한 호스트가 있습니다. 연결 상태를 확인한 뒤 다시 조회하세요."
                : "운영 프로젝트는 연결된 호스트에서 발견합니다. 배포 전이라면 프로젝트 브리프부터 작성하세요."
              : "검색어나 상태 필터를 바꿔 다시 찾아보세요."}
          </p>
          {unavailable && projects.length === 0 ? (
            <RetryButton />
          ) : (
            <Link
              className="hub-text-link"
              href={
                projects.length === 0 && !unavailable
                  ? "/handoff?template=project"
                  : "/projects"
              }
            >
              {unavailable && projects.length === 0
                ? "다시 조회 →"
                : projects.length === 0
                  ? "프로젝트 브리프 작성 →"
                  : "필터 초기화 →"}
            </Link>
          )}
        </div>
      ) : (
        <div className={compact ? "hub-project-list" : "hub-project-grid"}>
          {visible.map((project) => (
            <article
              key={project.id}
              className={`hub-project ${compact ? "compact" : ""}`}
            >
              <div className="hub-project-top">
                <span className="hub-project-monogram" aria-hidden="true">
                  {project.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate" title={project.name}>
                    <Link href={`/servers/${encodeURIComponent(project.host)}`}>
                      {project.name}
                    </Link>
                  </h3>
                  <span className="text-text-muted text-xs">
                    {project.host}
                    {project.category ? ` / ${project.category}` : ""}
                  </span>
                </div>
                {project.pinned && <span className="hub-eyebrow">고정</span>}
              </div>
              {!compact && (
                <p className="hub-project-description">
                  {project.description ||
                    "프로젝트 브리프에 목적과 운영 방법을 기록해 보세요."}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge status={project.status} />
                <span className="text-text-muted text-xs tabular-nums">
                  {project.running} / {project.total} 실행
                </span>
              </div>
              {!compact && (
                <>
                  <div className="hub-project-actions">
                    <Link href={`/servers/${encodeURIComponent(project.host)}`}>
                      운영 상세 ↗
                    </Link>
                    <Link
                      href={`/handoff?project=${encodeURIComponent(`${project.name} (${project.host}/${project.key})`)}`}
                    >
                      AI 인계 →
                    </Link>
                    <Link
                      href={`/knowledge?q=${encodeURIComponent(project.name)}`}
                    >
                      지식 검색 →
                    </Link>
                    {project.url && (
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        서비스 열기 ↗
                      </a>
                    )}
                  </div>
                  <p className="text-text-muted mt-3 text-[11px]">
                    조회{" "}
                    {new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(project.fetchedAt))}{" "}
                    KST · 애플리케이션 건강 상태는 운영 상세에서 확인
                  </p>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      {!compact && (
        <p className="text-text-muted mt-4 text-xs">
          조회된 {projects.length}개 중 {filtered.length}개 표시 · 컨테이너
          미관측은 중단 또는 장애 판정이 아닙니다.
        </p>
      )}
    </div>
  );
}
export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`hub-badge status-${status}`}>
      <span aria-hidden="true">
        {status === "attention" ? "!" : status === "running" ? "●" : "○"}
      </span>{" "}
      {STATUS_LABELS[status]}
    </span>
  );
}
