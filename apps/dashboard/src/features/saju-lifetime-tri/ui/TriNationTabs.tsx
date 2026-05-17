"use client";

// 5탭 (한국·中자평·中맹파·日추명·통합 비교) — 학파별 LifetimeFrameCard 또는 ComposeView 렌더.
//
// frames key 매핑: ko / cnZiping / cnMangpai / jp (camelCase).
// schoolKey (LifetimeFrameCard prop): kebab-case ko / cn-ziping / cn-mangpai / jp — narrative
// fetch 쿼리 파라미터와 직결.
//
// a11y: WAI-ARIA Tabs Pattern (manual activation).
// - role tablist/tab/tabpanel + aria-selected/aria-controls/aria-labelledby
// - 방향키(←/→/Home/End) + roving tabindex (활성 탭만 tabIndex=0)

import { useRef, useState, type KeyboardEvent } from "react";
import type { TriNationLifetime } from "@gons/saju";
import { LifetimeFrameCard } from "./LifetimeFrameCard";

const TABS = [
  { key: "ko", label: "한국" },
  { key: "cn-ziping", label: "中자평" },
  { key: "cn-mangpai", label: "中맹파" },
  { key: "jp", label: "日추명" },
  { key: "compose", label: "통합 비교" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
type SchoolKey = Exclude<TabKey, "compose">;

const FRAME_KEY: Record<SchoolKey, keyof TriNationLifetime["frames"]> = {
  ko: "ko",
  "cn-ziping": "cnZiping",
  "cn-mangpai": "cnMangpai",
  jp: "jp",
};

const tabId = (key: TabKey) => `tri-tab-${key}`;
const panelId = (key: TabKey) => `tri-panel-${key}`;

interface Props {
  profileId: string;
  triNation: TriNationLifetime;
}

export function TriNationTabs({ profileId, triNation }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("ko");
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    ko: null,
    "cn-ziping": null,
    "cn-mangpai": null,
    jp: null,
    compose: null,
  });

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
      <div role="tablist" aria-label="삼국 학파 탭" className="flex gap-2 border-b">
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
              <ComposeView triNation={triNation} />
            ) : (
              <LifetimeFrameCard
                profileId={profileId}
                schoolKey={tab.key}
                frame={triNation.frames[FRAME_KEY[tab.key]]}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ComposeRow {
  label: string;
  ko: string;
  cnZiping: string;
  cnMangpai: string;
  jp: string;
}

function ComposeView({ triNation }: { triNation: TriNationLifetime }) {
  const rows: ComposeRow[] = [
    {
      label: "격국",
      ko: triNation.frames.ko.formatGyeokguk.name,
      cnZiping: triNation.frames.cnZiping.formatGyeokguk.name,
      cnMangpai: triNation.frames.cnMangpai.formatGyeokguk.name,
      jp: triNation.frames.jp.formatGyeokguk.name,
    },
    {
      label: "용신",
      ko: triNation.frames.ko.yongshin?.element ?? "-",
      cnZiping: triNation.frames.cnZiping.yongshin?.element ?? "-",
      cnMangpai: triNation.frames.cnMangpai.yongshin?.element ?? "-",
      jp: triNation.frames.jp.yongshin?.element ?? "-",
    },
  ];
  return (
    <table className="w-full text-sm border">
      <caption className="sr-only">
        삼국 학파별 격국·용신 비교 표 (한국/中자평/中맹파/日추명)
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
