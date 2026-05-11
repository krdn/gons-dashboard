"use client";

// 호스트 상세 페이지의 클라이언트 셸.
// 책임: 검색/필터/정렬 + 자동 새로고침 + 키보드 단축키 + 도움말 패널.
// 데이터(그룹) 자체는 RSC에서 가공해 prop으로 받는다 — 이 컴포넌트는 표시만.
//
// 정렬 정책 (기본 "issues-first"):
//   1) 이슈가 있는 그룹(warningCount > 0)을 최상단으로 — 한눈에 문제 파악.
//   2) pinned 프로젝트 우선.
//   3) standalone 그룹은 최하단.
//   4) 이름순.
// 사용자가 검색어를 입력하면 컨테이너/프로젝트 이름·설명 모두에 부분 매칭.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// 클라이언트 번들 보호 — entities/* 와 features/* 의 barrel(index.ts) 는
// server-only 모듈(예: listContainers → node:child_process)을 함께 export 한다.
// import type 만 해도 Turbopack 이 barrel 전체를 끌어오며 빌드가 깨지므로
// 클라이언트 컴포넌트에서는 반드시 깊은 경로로 직접 import 한다.
import { ProjectGroupSection } from "@/features/container-list/ui/ProjectGroupSection";
import { StandaloneSection } from "@/features/container-list/ui/StandaloneSection";
import type { ProjectGroup } from "@/features/container-list/lib/groupByProject";
import { ActionButtons } from "@/features/container-actions/ui/ActionButtons";
import { HelpHint } from "@/shared/ui/HelpHint";

type StateFilter = "all" | "running" | "issues";

type Props = {
  hostId: string;
  adminFlag: boolean;
  groups: ProjectGroup[];
  refreshedAtIso: string;
};

const AUTO_REFRESH_MS = 30_000;

export function HostDashboard({ hostId, adminFlag, groups, refreshedAtIso }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [showHelp, setShowHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // refreshedAtIso는 RSC가 매 렌더마다 새 ISO 문자열을 내려주므로
  // 별도 state 없이 렌더 시점에 포맷팅한다.
  const lastRefreshLabel = formatTime(refreshedAtIso);

  // 자동 새로고침 — router.refresh()는 RSC를 다시 fetch하므로 페이지가 깜빡이지 않음.
  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const handleManualRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // 키보드 단축키.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 입력 중인 텍스트 필드에서는 단축키 무시 (Esc로 검색 비우기만 예외).
      const target = e.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (e.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          e.preventDefault();
          return;
        }
        if (isTyping && target instanceof HTMLInputElement) {
          target.blur();
          if (target === searchInputRef.current) setQuery("");
        }
        return;
      }

      if (isTyping) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleManualRefresh();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleManualRefresh, showHelp]);

  const filteredGroups = useMemo(
    () => sortAndFilter(groups, query, stateFilter),
    [groups, query, stateFilter],
  );

  const totalRunning = useMemo(
    () => groups.reduce((acc, g) => acc + g.runningCount, 0),
    [groups],
  );
  const totalContainers = useMemo(
    () => groups.reduce((acc, g) => acc + g.totalCount, 0),
    [groups],
  );
  const totalIssues = useMemo(
    () => groups.reduce((acc, g) => acc + g.warningCount, 0),
    [groups],
  );

  const renderActions = useCallback(
    (containerId: string, containerName: string) => {
      // 그룹에서 컨테이너 state를 찾아낸다.
      for (const g of filteredGroups) {
        const c = g.containers.find((x) => x.id === containerId);
        if (!c) continue;
        return (
          <ActionButtons
            hostId={hostId}
            containerId={containerId}
            containerName={containerName}
            state={c.state}
            isAdmin={adminFlag}
          />
        );
      }
      return null;
    },
    [filteredGroups, hostId, adminFlag],
  );

  const named = filteredGroups.filter((g) => !g.isStandalone);
  const standalone = filteredGroups.find((g) => g.isStandalone);
  const hasResults = filteredGroups.some((g) => g.containers.length > 0);

  return (
    <>
      <ControlBar
        query={query}
        onQueryChange={setQuery}
        stateFilter={stateFilter}
        onStateFilterChange={setStateFilter}
        onRefresh={handleManualRefresh}
        onToggleHelp={() => setShowHelp((p) => !p)}
        lastRefreshLabel={lastRefreshLabel}
        totalRunning={totalRunning}
        totalContainers={totalContainers}
        totalIssues={totalIssues}
        searchInputRef={searchInputRef}
      />

      {showHelp ? <HelpPanel onClose={() => setShowHelp(false)} /> : null}

      {!hasResults ? (
        <section className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          조건에 맞는 컨테이너가 없습니다.
          {(query !== "" || stateFilter !== "all") && (
            <>
              {" "}
              <button
                className="text-blue-600 underline hover:no-underline"
                onClick={() => {
                  setQuery("");
                  setStateFilter("all");
                }}
              >
                필터 초기화
              </button>
            </>
          )}
        </section>
      ) : null}

      {named.map((g) => (
        <ProjectGroupSection
          key={g.composeProject}
          group={g}
          renderActions={renderActions}
        />
      ))}

      {standalone ? (
        <StandaloneSection group={standalone} renderActions={renderActions} />
      ) : null}
    </>
  );
}

type ControlBarProps = {
  query: string;
  onQueryChange: (v: string) => void;
  stateFilter: StateFilter;
  onStateFilterChange: (v: StateFilter) => void;
  onRefresh: () => void;
  onToggleHelp: () => void;
  lastRefreshLabel: string;
  totalRunning: number;
  totalContainers: number;
  totalIssues: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
};

function ControlBar({
  query,
  onQueryChange,
  stateFilter,
  onStateFilterChange,
  onRefresh,
  onToggleHelp,
  lastRefreshLabel,
  totalRunning,
  totalContainers,
  totalIssues,
  searchInputRef,
}: ControlBarProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:gap-2">
      <div className="flex flex-1 items-center gap-2">
        <label className="relative flex flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-zinc-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="컨테이너·프로젝트 검색 (단축키: /)"
            aria-label="컨테이너 또는 프로젝트 검색"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <HelpHint hint="컨테이너 이름, 포트, 프로젝트 이름·설명 모두에서 부분 매칭. 단축키 '/' 로 빠르게 포커스." />
      </div>

      <div
        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-xs"
        role="group"
        aria-label="상태 필터"
      >
        <FilterChip
          label={`전체 ${totalContainers}`}
          active={stateFilter === "all"}
          onClick={() => onStateFilterChange("all")}
          title="모든 컨테이너 표시"
        />
        <FilterChip
          label={`실행중 ${totalRunning}`}
          active={stateFilter === "running"}
          onClick={() => onStateFilterChange("running")}
          title="state=running 인 컨테이너만 표시"
          tone="ok"
        />
        <FilterChip
          label={`이슈 ${totalIssues}`}
          active={stateFilter === "issues"}
          onClick={() => onStateFilterChange("issues")}
          title="exited / restarting / paused / dead 상태의 컨테이너만 표시"
          tone="warn"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          title="지금 새로고침 (단축키: r). 30초마다 자동으로도 갱신됩니다."
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          새로고침
        </button>
        <span className="hidden text-[11px] text-zinc-500 sm:inline">
          마지막 갱신 {lastRefreshLabel}
        </span>
        <button
          type="button"
          onClick={onToggleHelp}
          title="키보드 단축키 도움말 (단축키: ?)"
          aria-label="도움말 열기"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          ?
        </button>
      </div>
    </section>
  );
}

type FilterChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
  tone?: "ok" | "warn";
};

function FilterChip({ label, active, onClick, title, tone }: FilterChipProps) {
  const activeColor =
    tone === "ok"
      ? "bg-emerald-600 text-white"
      : tone === "warn"
        ? "bg-amber-500 text-white"
        : "bg-zinc-900 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "rounded-md px-2.5 py-1 font-medium transition-colors " +
        (active ? activeColor : "text-zinc-600 hover:bg-white")
      }
    >
      {label}
    </button>
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <section
      role="dialog"
      aria-label="키보드 단축키 도움말"
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            키보드 단축키 & 도움말
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            이 페이지는 30초마다 자동 새로고침됩니다. 즉시 갱신하려면 새로고침
            버튼이나 <Kbd>r</Kbd>.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="도움말 닫기"
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50"
        >
          닫기 (Esc)
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-700 sm:grid-cols-2">
        <ShortcutRow keys={["/"]} desc="검색창에 포커스" />
        <ShortcutRow keys={["r"]} desc="지금 새로고침" />
        <ShortcutRow keys={["?"]} desc="이 도움말 토글" />
        <ShortcutRow keys={["Esc"]} desc="도움말 닫기 · 검색어 지우기" />
      </dl>
      <div className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
        <p className="font-medium text-zinc-800">정렬 규칙</p>
        <p className="mt-1 leading-relaxed">
          이슈가 있는 프로젝트를 최상단에 노출하고, 그다음 pinned · 이름순으로
          정렬합니다. <span className="font-mono">standalone</span> (compose
          라벨 없음) 그룹은 항상 최하단에 표시됩니다.
        </p>
        <p className="mt-2 font-medium text-zinc-800">컨테이너 상태</p>
        <p className="mt-1 leading-relaxed">
          <Badge>running</Badge>: 정상 동작 ·{" "}
          <Badge tone="warn">restarting</Badge>: 재시작 중 ·{" "}
          <Badge tone="err">exited</Badge>: 종료 ·{" "}
          <Badge tone="err">dead</Badge>: 비정상 종료 ·{" "}
          <Badge tone="neutral">paused</Badge>: 일시정지
        </p>
      </div>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5">
      <span className="flex items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
      <span>{desc}</span>
    </div>
  );
}

function Badge({
  children,
  tone = "ok",
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "err" | "neutral";
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : tone === "err"
          ? "bg-rose-50 text-rose-700"
          : "bg-zinc-100 text-zinc-700";
  return (
    <span
      className={
        "inline-flex rounded px-1.5 py-0.5 font-mono text-[11px] font-medium " +
        cls
      }
    >
      {children}
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// helpers

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const ISSUE_STATES = new Set(["exited", "restarting", "dead", "paused"]);

function sortAndFilter(
  groups: ProjectGroup[],
  query: string,
  stateFilter: StateFilter,
): ProjectGroup[] {
  const q = query.trim().toLowerCase();
  const containerMatchesQuery = (c: ProjectGroup["containers"][number]): boolean => {
    if (q === "") return true;
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.statusText.toLowerCase().includes(q)) return true;
    for (const port of c.ports) {
      if (port.hostPort != null && String(port.hostPort).includes(q)) return true;
    }
    return false;
  };

  const containerMatchesState = (c: ProjectGroup["containers"][number]): boolean => {
    if (stateFilter === "all") return true;
    if (stateFilter === "running") return c.state === "running";
    if (stateFilter === "issues") return ISSUE_STATES.has(c.state);
    return true;
  };

  const groupMetaMatches = (g: ProjectGroup): boolean => {
    if (q === "") return true;
    if (g.displayName.toLowerCase().includes(q)) return true;
    if (g.composeProject.toLowerCase().includes(q)) return true;
    if (g.description?.toLowerCase().includes(q)) return true;
    return false;
  };

  const filtered: ProjectGroup[] = [];
  for (const g of groups) {
    const containers = g.containers.filter(
      (c) => containerMatchesQuery(c) && containerMatchesState(c),
    );

    // 검색어가 그룹 메타에 매칭되고 상태 필터가 'all' 이면 전체 컨테이너 표시.
    // 그 외엔 위에서 걸러진 결과만 사용.
    const useAllForGroupMatch =
      q !== "" && stateFilter === "all" && groupMetaMatches(g);

    const finalContainers = useAllForGroupMatch ? g.containers : containers;

    // 비어있는 그룹은 검색 시점에는 숨김. 단, isStale 그룹이고 검색어 없이 필터가 all이면 표시.
    if (
      finalContainers.length === 0 &&
      !(q === "" && stateFilter === "all" && g.isStale && !g.isStandalone)
    ) {
      continue;
    }

    let running = 0;
    let warning = 0;
    for (const c of finalContainers) {
      if (c.state === "running") running++;
      if (ISSUE_STATES.has(c.state)) warning++;
    }

    filtered.push({
      ...g,
      containers: finalContainers,
      runningCount: running,
      totalCount: finalContainers.length,
      warningCount: warning,
    });
  }

  return filtered.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    const aIssue = a.warningCount > 0 ? 1 : 0;
    const bIssue = b.warningCount > 0 ? 1 : 0;
    if (aIssue !== bIssue) return bIssue - aIssue;
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, "ko");
  });
}
