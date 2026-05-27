"use client";

// 4탭 (한국·中자평·中맹파·日추명) — 학파별 DailyFrameView 렌더.
//
// TriMonthlyTabs 패턴 미러. 차이:
//  - fetch URL 에 forDate 쿼리
//  - frame shape 가 DailyLiteFrame (단순화)
//  - "통합 비교" 탭 제외 (DailyLiteFrame 은 비교할 항목이 적음)
//
// state lift-up: narrative 캐시, AbortController, 429 retryAt 카운트다운.
// render 중 Date.now() 금지 + useEffect body 동기 setState 금지.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TriNationDailyLite } from "@krdn/saju";
import { DailyFrameView, type DailyNarrativePayload } from "./DailyFrameView";
import { toUserMessage } from "../lib/errorMessage";
import type { SajuModelKey } from "@/shared/lib/llm/saju-model-registry-meta";

const TABS = [
  { key: "ko", label: "한국" },
  { key: "cn-ziping", label: "中자평" },
  { key: "cn-mangpai", label: "中맹파" },
  { key: "jp", label: "日추명" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const FRAME_KEY: Record<TabKey, keyof TriNationDailyLite["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};

const tabId = (key: TabKey) => `tri-daily-tab-${key}`;
const panelId = (key: TabKey) => `tri-daily-panel-${key}`;

interface NarrativeState {
  payload: DailyNarrativePayload | null;
  loading: boolean;
  error: string | null;
  retryAt: number | null;
}

type NarrativeCache = Record<TabKey, NarrativeState>;

const INITIAL_NARRATIVE_STATE: NarrativeState = {
  payload: null,
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
  forDate: string;
  triNation: TriNationDailyLite;
  modelKey: SajuModelKey;
}

export function TriDailyTabs({
  profileId,
  forDate,
  triNation,
  modelKey,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("ko");
  const [narratives, setNarratives] = useState<NarrativeCache>(INITIAL_CACHE);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    ko: null,
    "cn-ziping": null,
    "cn-mangpai": null,
    jp: null,
  });

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
      setNarratives((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(prev) as TabKey[]) {
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchNarrative = (school: TabKey) => {
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
          `/api/saju/daily/${profileId}/narrative?school=${school}&forDate=${forDate}&model=${modelKey}`,
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
        const data = (await res.json()) as DailyNarrativePayload;
        setNarratives((prev) => ({
          ...prev,
          [school]: {
            payload: data,
            loading: false,
            error: null,
            retryAt: null,
          },
        }));
      } catch (err) {
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
      <div role="tablist" aria-label="삼국 학파 탭 (일운)" className="flex gap-2 border-b">
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
            <DailyFrameView
              frame={triNation.frames[FRAME_KEY[tab.key]]}
              school={tab.key}
              narrative={narratives[tab.key].payload}
              loading={narratives[tab.key].loading}
              error={narratives[tab.key].error}
              retryRemainingMs={remainingMs(narratives[tab.key])}
              onFetch={() => fetchNarrative(tab.key)}
            />
          </div>
        );
      })}
    </div>
  );
}
