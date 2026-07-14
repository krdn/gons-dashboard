"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ActivityHeatmap, DailyTrendPoint } from "../model/types";

interface Props {
  heatmap: ActivityHeatmap;
  trend: DailyTrendPoint[];
}

// 단색 명도 스케일 — count 구간별 배경. 라이트 모드 고정.
function cellColor(count: number): string {
  if (count === 0) return "#f1f5f9"; // slate-100 (기록 없음)
  if (count === 1) return "#bbf7d0"; // green-200
  if (count <= 3) return "#4ade80"; // green-400
  if (count <= 6) return "#22c55e"; // green-500
  return "#15803d"; // green-700
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}

export function ActivityBlock({ heatmap, trend }: Props) {
  const { weeks, totalCount, currentStreak, longestStreak, dailyAvg } = heatmap;
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">기록 활동 패턴</h2>

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label="전체 메모" value={String(totalCount)} />
        <Stat
          label="현재 연속 기록"
          value={currentStreak > 0 ? `${currentStreak}일` : "—"}
        />
        <Stat label="최장 연속" value={longestStreak > 0 ? `${longestStreak}일` : "—"} />
        <Stat label="최근 26주 일평균" value={dailyAvg.toFixed(2)} />
      </div>
      {currentStreak === 0 && (
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          아직 연속 기록이 없어요.
        </p>
      )}

      {/* 히트맵 — 26주 × 7일 고정 그리드. 열=주, 행=요일. */}
      <div className="mb-8 overflow-x-auto">
        <div className="flex gap-1" style={{ minWidth: "fit-content" }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date}: ${cell.count}건`}
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: cellColor(cell.count) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 일별 추이 — 최근 N일 바 차트. */}
      <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">최근 30일 추이</h3>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={trend}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickFormatter={(d: string) => d.slice(5)} // MM-DD
            interval={4}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} />
          <Tooltip />
          <Bar dataKey="count" fill="#22c55e" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
