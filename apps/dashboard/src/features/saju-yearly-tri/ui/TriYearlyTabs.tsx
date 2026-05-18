"use client";

// 5탭 (한국·中자평·中맹파·日추명·통합 비교) — 학파별 YearlyFrameView 또는 ComposeView 렌더.
//
// lifetime 의 TriNationTabs 패턴 미러:
//  - WAI-ARIA Tabs Pattern (manual activation, 방향키/Home/End/roving tabindex)
//  - state lift-up: 학파별 narrative 캐시, AbortController, 429 retryAt 카운트다운
//  - render 중 Date.now() 금지 + useEffect body 동기 setState 금지
//    (memory `react-19-purity-set-state-in-effect`)
//
// yearly 만의 차이:
//  - fetch URL 에 year 쿼리 추가 (Phase 4 narrative route 검증 요구)
//  - frame shape 가 YearlyFrame (lifetime 의 LifetimeFrame 과 다름)
//  - ComposeView 는 netVerdict / yongShinDelta / currentDaeun 3행 (D6 권장)

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TriNationYearly, YearlyFrame } from "@gons/saju";
import { YearlyFrameView } from "./YearlyFrameView";
import { toUserMessage } from "../lib/errorMessage";

const TABS = [
  { key: "ko", label: "한국" },
  { key: "cn-ziping", label: "中자평" },
  { key: "cn-mangpai", label: "中맹파" },
  { key: "jp", label: "日추명" },
  { key: "compose", label: "통합 비교" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
type SchoolKey = Exclude<TabKey, "compose">;

const FRAME_KEY: Record<SchoolKey, keyof TriNationYearly["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};

const tabId = (key: TabKey) => `tri-yearly-tab-${key}`;
const panelId = (key: TabKey) => `tri-yearly-panel-${key}`;

interface NarrativeState {
  text: string | null;
  loading: boolean;
  error: string | null;
  retryAt: number | null;
}

type NarrativeCache = Record<SchoolKey, NarrativeState>;

const INITIAL_NARRATIVE_STATE: NarrativeState = {
  text: null,
  loading: false,
  error: null,
  retryAt: null,
};

const INITIAL_CACHE: NarrativeCache = {
  ko: INITIAL_NARRATIVE_STATE,
  "cn-ziping": INITIAL_NARRATIVE_STATE,
  "cn-mangpai": INITIAL_NARRATIVE_STATE,
  jp: INITIAL_NARRATIVE_STATE,
};

interface Props {
  profileId: string;
  targetYear: number;
  triNation: TriNationYearly;
}

export function TriYearlyTabs({ profileId, targetYear, triNation }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("ko");
  const [narratives, setNarratives] = useState<NarrativeCache>(INITIAL_CACHE);
  // 카운트다운 표시용 현재 시각. render 중 Date.now() 금지 — fetchNarrative 핸들러에서
  // 초기화하고 useEffect 안의 setInterval 콜백에서만 갱신.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    ko: null,
    "cn-ziping": null,
    "cn-mangpai": null,
    jp: null,
    compose: null,
  });

  // 학파 중 하나라도 retryAt 가 살아 있으면 카운트다운 setInterval 운영.
  const anyRetryAt = (Object.values(narratives) as NarrativeState[]).reduce<
    number | null
  >((earliest, s) => {
    if (s.retryAt === null) return earliest;
    if (earliest === null) return s.retryAt;
    return Math.min(earliest, s.retryAt);
  }, null);

  useEffect(() => {
    if (anyRetryAt === null) return;
    tickRef.current = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      // 만료된 학파의 retryAt 정리.
      setNarratives((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(prev) as SchoolKey[]) {
          if (prev[k].retryAt !== null && now >= prev[k].retryAt!) {
            next[k] = { ...prev[k], retryAt: null };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [anyRetryAt]);

  // unmount 시 진행 중 fetch abort.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchNarrative = (school: SchoolKey) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setNarratives((prev) => ({
      ...prev,
      [school]: { ...prev[school], loading: true, error: null, retryAt: null },
    }));

    void (async () => {
      const startNow = Date.now();
      setNowMs(startNow);
      try {
        const res = await fetch(
          `/api/saju/yearly/${profileId}/narrative?school=${school}&year=${targetYear}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const data = (await res.json()) as {
            error?: string;
            retryAfterMs?: number;
          };
          if (res.status === 429 && typeof data.retryAfterMs === "number") {
            const tNow = Date.now();
            setNowMs(tNow);
            setNarratives((prev) => ({
              ...prev,
              [school]: {
                ...prev[school],
                loading: false,
                error: null,
                retryAt: tNow + data.retryAfterMs!,
              },
            }));
            return;
          }
          throw new Error(data.error ?? "INTERNAL_ERROR");
        }
        const data = (await res.json()) as { narrativeText: string };
        setNarratives((prev) => ({
          ...prev,
          [school]: {
            text: data.narrativeText,
            loading: false,
            error: null,
            retryAt: null,
          },
        }));
      } catch (err) {
        // AbortError 는 의도된 취소 — 에러 표시하지 않음.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const rawCode = err instanceof Error ? err.message : null;
        setNarratives((prev) => ({
          ...prev,
          [school]: {
            ...prev[school],
            loading: false,
            error: toUserMessage(rawCode),
          },
        }));
      }
    })();
  };

  const remainingMs = (state: NarrativeState): number =>
    state.retryAt !== null && nowMs !== null
      ? Math.max(0, state.retryAt - nowMs)
      : 0;

  const focusTab = (key: TabKey) => {
    setActiveTab(key);
    tabRefs.current[key]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TABS.findIndex((t) => t.key === activeTab);
    if (currentIndex < 0) return;
    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        focusTab(TABS[(currentIndex + 1) % TABS.length].key);
        break;
      }
      case "ArrowLeft": {
        event.preventDefault();
        focusTab(TABS[(currentIndex - 1 + TABS.length) % TABS.length].key);
        break;
      }
      case "Home": {
        event.preventDefault();
        focusTab(TABS[0].key);
        break;
      }
      case "End": {
        event.preventDefault();
        focusTab(TABS[TABS.length - 1].key);
        break;
      }
    }
  };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="삼국 학파 탭 (년운)" className="flex gap-2 border-b">
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={tabId(tab.key)}
              aria-selected={selected}
              aria-controls={panelId(tab.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={handleKeyDown}
              className={`px-3 py-2 ${
                selected ? "border-b-2 border-blue-600 font-bold" : ""
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => {
        const selected = activeTab === tab.key;
        if (!selected) {
          return (
            <div
              key={tab.key}
              role="tabpanel"
              id={panelId(tab.key)}
              aria-labelledby={tabId(tab.key)}
              hidden
            />
          );
        }
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={panelId(tab.key)}
            aria-labelledby={tabId(tab.key)}
            tabIndex={0}
          >
            {tab.key === "compose" ? (
              <YearlyComposeView triNation={triNation} />
            ) : (
              <YearlyFrameView
                frame={triNation.frames[FRAME_KEY[tab.key]]}
                narrative={narratives[tab.key].text}
                loading={narratives[tab.key].loading}
                error={narratives[tab.key].error}
                retryRemainingMs={remainingMs(narratives[tab.key])}
                onFetch={() => fetchNarrative(tab.key)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 통합 비교 — D6 권장: netVerdict / yongShinDelta(강/약) / currentDaeun 3행.
// yearGanji 는 4학파 모두 동일하므로 비교에서 제외.
interface ComposeRow {
  label: string;
  ko: string;
  cnZiping: string;
  cnMangpai: string;
  jp: string;
}

function verdictLabel(v: YearlyFrame["yongShinDelta"]["netVerdict"]): string {
  return v === "favorable" ? "길" : v === "unfavorable" ? "흉" : "혼";
}

function deltaLabel(delta: YearlyFrame["yongShinDelta"]): string {
  const r = delta.reinforced.join("/") || "-";
  const w = delta.weakened.join("/") || "-";
  return `↑${r} / ↓${w}`;
}

function daeunLabel(d: YearlyFrame["currentDaeun"]): string {
  return `${d.startAge}-${d.endAge} ${d.ganji.stem}${d.ganji.branch}`;
}

function YearlyComposeView({ triNation }: { triNation: TriNationYearly }) {
  const { ko, cnZiping, cnMangpai, jp } = triNation.frames;
  const rows: ComposeRow[] = [
    {
      label: "netVerdict",
      ko: verdictLabel(ko.yongShinDelta.netVerdict),
      cnZiping: verdictLabel(cnZiping.yongShinDelta.netVerdict),
      cnMangpai: verdictLabel(cnMangpai.yongShinDelta.netVerdict),
      jp: verdictLabel(jp.yongShinDelta.netVerdict),
    },
    {
      label: "용신 변동",
      ko: deltaLabel(ko.yongShinDelta),
      cnZiping: deltaLabel(cnZiping.yongShinDelta),
      cnMangpai: deltaLabel(cnMangpai.yongShinDelta),
      jp: deltaLabel(jp.yongShinDelta),
    },
    {
      label: "대운",
      ko: daeunLabel(ko.currentDaeun),
      cnZiping: daeunLabel(cnZiping.currentDaeun),
      cnMangpai: daeunLabel(cnMangpai.currentDaeun),
      jp: daeunLabel(jp.currentDaeun),
    },
  ];
  return (
    <table className="w-full text-sm border">
      <caption className="sr-only">
        삼국 학파별 년운 비교 표 (한국/中자평/中맹파/日추명)
      </caption>
      <thead>
        <tr>
          <th scope="col" className="border p-2">항목</th>
          <th scope="col" className="border p-2">한국</th>
          <th scope="col" className="border p-2">中자평</th>
          <th scope="col" className="border p-2">中맹파</th>
          <th scope="col" className="border p-2">日추명</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" className="border p-2 text-left font-normal">
              {r.label}
            </th>
            <td className="border p-2">{r.ko}</td>
            <td className="border p-2">{r.cnZiping}</td>
            <td className="border p-2">{r.cnMangpai}</td>
            <td className="border p-2">{r.jp}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
