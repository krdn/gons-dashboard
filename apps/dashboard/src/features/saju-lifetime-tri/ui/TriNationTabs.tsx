"use client";

// 5탭 (한국·中자평·中맹파·日추명·통합 비교) — 학파별 LifetimeFrameCard 또는 ComposeView 렌더.
//
// frames key 매핑: ko / cnZiping / cnMangpai / jp (camelCase).
// schoolKey (LifetimeFrameCard prop): kebab-case ko / cn-ziping / cn-mangpai / jp — narrative
// fetch 쿼리 파라미터와 직결.

import { useState } from "react";
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

interface Props {
  profileId: string;
  triNation: TriNationLifetime;
}

export function TriNationTabs({ profileId, triNation }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("ko");

  return (
    <div className="space-y-3">
      <div className="flex gap-2 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 ${
              activeTab === tab.key ? "border-b-2 border-blue-600 font-bold" : ""
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "compose" ? (
        <ComposeView triNation={triNation} />
      ) : (
        <LifetimeFrameCard
          profileId={profileId}
          schoolKey={activeTab}
          frame={triNation.frames[FRAME_KEY[activeTab]]}
        />
      )}
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
      <thead>
        <tr>
          <th className="border p-2">항목</th>
          <th className="border p-2">한국</th>
          <th className="border p-2">中자평</th>
          <th className="border p-2">中맹파</th>
          <th className="border p-2">日추명</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="border p-2">{r.label}</td>
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
