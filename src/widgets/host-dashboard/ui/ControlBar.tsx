"use client";

// HostDashboard 상단 컨트롤 바 — 검색·상태필터·새로고침·도움말 토글.
//
// 책임:
//   - 검색 인풋 (ref forward 로 단축키 "/" 가 포커스 가능)
//   - 상태 필터 3종 (all/running/issues)
//   - 새로고침 버튼 + 마지막 갱신 시각 라벨
//   - 도움말 토글 버튼

import type { RefObject } from "react";
import { HelpHint } from "@/shared/ui/HelpHint";
import { FilterChip } from "./FilterChip";
import type { StateFilter } from "../lib/sortAndFilter";

interface ControlBarProps {
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
  searchInputRef: RefObject<HTMLInputElement | null>;
}

export function ControlBar({
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
