"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ActionConversion } from "../model/types";

interface Props {
  conversion: ActionConversion;
}

const STATUS_LABEL: Record<string, string> = {
  proposed: "제안됨",
  accepted: "수락됨",
  done: "완료",
  dismissed: "무시됨",
};
const STATUS_COLOR: Record<string, string> = {
  proposed: "#94a3b8",
  accepted: "#3b82f6",
  done: "#22c55e",
  dismissed: "#e2e8f0",
};

function FunnelStat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-slate-50 p-4">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs font-medium">{label}</div>
      {note && <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{note}</div>}
    </div>
  );
}

export function ConversionBlock({ conversion }: Props) {
  const {
    totalMemos,
    processedMemos,
    memosWithActions,
    currentStatusCounts,
    transformCount,
    transformByPreset,
  } = conversion;

  const statusData = (["proposed", "accepted", "done", "dismissed"] as const)
    .map((s) => ({ status: s, label: STATUS_LABEL[s], count: currentStatusCounts[s] }))
    .filter((d) => d.count > 0);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">메모 → 액션 전환</h2>

      {/* 메모 퍼널 (단조 감소, 메모 수 단위) */}
      <div className="mb-6 flex gap-3">
        <FunnelStat label="전체 메모" value={totalMemos} />
        <FunnelStat label="추출 처리됨" value={processedMemos} note="액션 추출 시도 완료" />
        <FunnelStat label="액션 생김" value={memosWithActions} note="액션 1개 이상" />
      </div>

      {/* 액션 상태 분포 (퍼널과 별개 — 현재 상태 스냅샷, 액션-행 단위) */}
      <h3 className="mb-2 text-sm font-medium">액션 상태 (현재 스냅샷)</h3>
      {statusData.length === 0 ? (
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">아직 추출된 액션이 없어요.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={45} outerRadius={75}>
              {statusData.map((d) => (
                <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* 변환본 통계 (slug 그룹) */}
      <h3 className="mb-2 mt-4 text-sm font-medium">변환본 ({transformCount}건)</h3>
      {transformByPreset.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">아직 생성된 변환본이 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {transformByPreset.map((p) => (
            <li key={p.slug} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate">{p.label}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-emerald-400"
                  style={{ width: `${(p.count / transformCount) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-[var(--color-text-muted)]">
                {p.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
