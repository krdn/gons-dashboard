"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  simpleMovingAverage,
  relativeStrengthIndex,
} from "@/shared/lib/ta/indicators";

interface OHLC {
  date: string;
  close: number;
  volume: number;
}

interface Props {
  data: OHLC[];
  currency: string;
}

type Range = "1M" | "3M" | "6M" | "1Y";

const RANGE_DAYS: Record<Range, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
};

const RANGES: Range[] = ["1M", "3M", "6M", "1Y"];

interface ChartPoint {
  date: string;
  close: number;
  ma20: number | null;
  ma60: number | null;
}

export function PriceChart({ data, currency }: Props) {
  const [range, setRange] = useState<Range>("3M");

  const points: ChartPoint[] = useMemo(() => {
    const closes = data.map((d) => d.close);
    const ma20 = simpleMovingAverage(closes, 20);
    const ma60 = simpleMovingAverage(closes, 60);
    const merged = data.map((d, i) => ({
      date: d.date,
      close: d.close,
      ma20: ma20[i],
      ma60: ma60[i],
    }));
    return merged.slice(-RANGE_DAYS[range]);
  }, [data, range]);

  const rsi = useMemo(() => {
    const closes = data.map((d) => d.close);
    const series = relativeStrengthIndex(closes, 14);
    return series.slice(-RANGE_DAYS[range]).at(-1) ?? null;
  }, [data, range]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] text-sm text-[var(--color-text-muted)]">
        차트 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded px-2 py-1 text-xs ${
              range === r
                ? "bg-[var(--color-accent)] text-white"
                : "border border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {r}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          RSI(14):{" "}
          <strong className="tabular-nums">
            {typeof rsi === "number" ? rsi.toFixed(1) : "—"}
          </strong>
        </span>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
              minTickGap={32}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
              tickFormatter={(v) => `${(v as number).toFixed(0)}`}
            />
            <Tooltip
              formatter={(value) => {
                if (typeof value === "number") {
                  return `${value.toFixed(2)} ${currency}`;
                }
                return `${String(value)} ${currency}`;
              }}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-hairline)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              name="가격"
            />
            <Line
              type="monotone"
              dataKey="ma20"
              stroke="#f59e0b"
              strokeWidth={1}
              dot={false}
              name="MA20"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="ma60"
              stroke="#10b981"
              strokeWidth={1}
              dot={false}
              name="MA60"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
