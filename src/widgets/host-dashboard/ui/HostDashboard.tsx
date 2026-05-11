"use client";

// 호스트 상세 페이지의 클라이언트 셸.
// 책임: 검색/필터/정렬 + 자동 새로고침 + 키보드 단축키 + 도움말 패널 오케스트레이션.
// 데이터(그룹) 자체는 RSC에서 가공해 prop으로 받는다 — 이 컴포넌트는 표시만.
//
// 정렬 정책: src/widgets/host-dashboard/lib/sortAndFilter.ts 참조.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// 클라이언트 번들 보호 — entities/* 와 features/* 의 barrel(index.ts) 는
// server-only 모듈(예: listContainers → node:child_process)을 함께 export 한다.
// import type 만 해도 Turbopack 이 barrel 전체를 끌어오며 빌드가 깨지므로
// 클라이언트 컴포넌트에서는 반드시 깊은 경로로 직접 import 한다.
import { ProjectGroupSection } from "@/features/container-list/ui/ProjectGroupSection";
import { StandaloneSection } from "@/features/container-list/ui/StandaloneSection";
import type { ProjectGroup } from "@/features/container-list/lib/groupByProject";
import { ActionButtons } from "@/features/container-actions/ui/ActionButtons";
import { ControlBar } from "./ControlBar";
import { HelpPanel } from "./HelpPanel";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { formatTime } from "../lib/formatTime";
import { sortAndFilter, type StateFilter } from "../lib/sortAndFilter";

interface Props {
  hostId: string;
  adminFlag: boolean;
  groups: ProjectGroup[];
  refreshedAtIso: string;
}

const AUTO_REFRESH_MS = 30_000;

export function HostDashboard({ hostId, adminFlag, groups, refreshedAtIso }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [showHelp, setShowHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // refreshedAtIso 는 RSC가 매 렌더마다 새 ISO 문자열을 내려주므로 별도 state 없이 포맷.
  const lastRefreshLabel = formatTime(refreshedAtIso);

  const handleManualRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useAutoRefresh(handleManualRefresh, AUTO_REFRESH_MS);

  useKeyboardShortcuts({
    searchInputRef,
    onRefresh: handleManualRefresh,
    onClearSearch: () => setQuery(""),
    showHelp,
    setShowHelp,
  });

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
        <section className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-[var(--color-text-subtle)]">
          조건에 맞는 컨테이너가 없습니다.
          {(query !== "" || stateFilter !== "all") && (
            <>
              {" "}
              <button
                className="rounded text-[var(--color-accent)] underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
