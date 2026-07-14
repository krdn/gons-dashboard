"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { DigestTimelinePoint } from "../model/types";

interface Props {
  digestTimeline: DigestTimelinePoint[];
}

export function DigestTimelineBlock({ digestTimeline }: Props) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">주간 회고 타임라인</h2>
      {digestTimeline.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          아직 주간 다이제스트가 없어요. 매주 일요일 자동 생성돼요.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={digestTimeline}>
            <XAxis dataKey="weekEnd" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} />
            <Tooltip />
            <Legend />
            <Bar dataKey="memoCount" name="메모 수" fill="#22c55e" radius={[2, 2, 0, 0]} />
            <Line dataKey="resurfacedCount" name="재부상" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
