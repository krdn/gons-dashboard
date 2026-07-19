"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { CategoryDistribution } from "../model/types";

interface Props {
  category: CategoryDistribution;
}

// dataviz 검증 팔레트 — 카테고리 색 순환 (라이트 모드 고정).
const PALETTE = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#64748b"];

export function CategoryBlock({ category }: Props) {
  const { byCategory, voiceCount, textCount, agentCount, unclassifiedCount } = category;
  const total = voiceCount + textCount + agentCount;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">카테고리 분포</h2>

      {byCategory.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">아직 분류된 메모가 없어요.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={byCategory}
              dataKey="count"
              nameKey="labelKo"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
            >
              {byCategory.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}

      {/* voice vs text vs agent 가로 바 + 미분류 수. */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>음성 {voiceCount}</span>
          <span>텍스트 {textCount}</span>
          <span>에이전트 {agentCount}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
          {total > 0 && (
            <>
              <div className="bg-violet-400" style={{ width: `${(voiceCount / total) * 100}%` }} />
              <div className="bg-sky-400" style={{ width: `${(textCount / total) * 100}%` }} />
              <div className="bg-amber-400" style={{ width: `${(agentCount / total) * 100}%` }} />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">미분류 {unclassifiedCount}건</p>
      </div>
    </section>
  );
}
