# Phase 5: Widget Card + Detail Modal

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** RSC `StockAnalysisCard` (헤드라인 + 리스트, 옵션 3) + `StockDetailModal` (A 레이아웃, 합의 hero + 페르소나 5 탭) + `PriceChart` (Recharts) + `page.tsx` 통합. spec §5.1/§5.2.

**완료 조건:**
- Recharts 라이트 차트 (1M/3M/6M/1Y 토글 + MA20/MA60 오버레이 + RSI14 표시)
- `StockAnalysisCard` (RSC) — 옵션 3 (헤드라인 종목 hero + 리스트). 캐시 hit 만 처리, miss 는 Phase 6 책임
- `StockAnalysisSkeleton` — Suspense fallback
- `StockDetailModal` — A 레이아웃 (합의 hero + 페르소나 5 탭 + 차트 + 펀더멘털 + 면책 footer)
- `entities/stock-analysis/client.ts` 의 `ConsensusBadge`, `PersonaTab` UI 부품
- `app/page.tsx` 좌 7-grid 에 `<StockAnalysisCard />` 추가
- `pnpm typecheck && pnpm lint && pnpm test` PASS
- 로컬 dev 띄워서 종목 등록 후 카드 + 모달 렌더링 시각 확인

**전제:**
- Phase 4 PR (#109) 머지 완료 → `feat/stock-analysis-phase-5` cut
- `getCachedAnalysis`, `PortfolioHolding`, `PersonaAnalysis`, `Consensus`, `MarketSnapshot` 등 모두 동작
- `getHoldings(userId)` (Phase 1 T1.5)
- `SettingsButton` (Phase 4 T4.6) import 가능

⚠️ **MA/RSI 계산**: Phase 3 보류 항목. Phase 5 에서 일봉 데이터로 계산해 차트에 표시. snapshot 의 ma20/ma60/rsi14 는 Phase 6 lazy trigger 가 채움.

---

## Task 5.1: Recharts 도입 + PriceChart 컴포넌트

**Files:**
- Modify: `apps/dashboard/package.json` (`recharts` dependency)
- Create: `apps/dashboard/src/shared/lib/ta/indicators.ts`
- Create: `apps/dashboard/src/shared/ui/PriceChart.tsx`

⚠️ Recharts 채택 — ~50KB gzipped, React-friendly API. spec §10 의 "Recharts vs lightweight-charts" 결정.

- [ ] **Step 1: 의존성 추가**

Run: `pnpm --filter @gons/dashboard add recharts`
Expected: dependencies 에 `"recharts": "^2.x.x"` 추가.

- [ ] **Step 2: shared/lib/ta/indicators.ts (TA 계산 helper)**

```ts
// 기술적 지표 (TA) 계산 — 일봉 close 배열에서 MA / RSI 계산.
// PriceChart 오버레이 + Phase 6 snapshot 채움 양쪽 재사용.

export function simpleMovingAverage(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

/**
 * Wilder's RSI (period=14 기본).
 * 입력 부족 시 null 배열.
 */
export function relativeStrengthIndex(
  closes: number[],
  period = 14,
): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);
  const result: (number | null)[] = closes.map(() => null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function lastFinite(arr: (number | null)[]): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}
```

- [ ] **Step 3: shared/ui/PriceChart.tsx**

```tsx
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
              formatter={(value: number) =>
                `${value?.toFixed?.(2) ?? value} ${currency}`
              }
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
```

⚠️ Recharts 는 client-only — `"use client"` 필수.

⚠️ Range 단위는 "거래일" 수 (1년 ≈ 252일). spec §5.2 의 1D/1W 는 일봉 기준이라 1M/3M/6M/1Y 로 변경.

- [ ] **Step 4: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/package.json apps/dashboard/src/shared/ui/PriceChart.tsx apps/dashboard/src/shared/lib/ta/ pnpm-lock.yaml
git commit -m "feat(stock-analysis): PriceChart (Recharts + MA20/MA60 + RSI14) + TA indicators helper"
```

---

## Task 5.2: ConsensusBadge + PersonaTab UI 부품

**Files:**
- Create: `apps/dashboard/src/entities/stock-analysis/ui/ConsensusBadge.tsx`
- Create: `apps/dashboard/src/entities/stock-analysis/ui/PersonaTab.tsx`
- Modify: `apps/dashboard/src/entities/stock-analysis/client.ts` (UI 부품 export 추가)

- [ ] **Step 1: ui/ConsensusBadge.tsx**

```tsx
"use client";

import type { Verdict } from "../client";

interface Props {
  verdict: Verdict;
  score?: string;
  size?: "sm" | "md";
}

const VERDICT_STYLE: Record<Verdict, { bg: string; text: string; label: string }> = {
  BUY: { bg: "bg-emerald-50", text: "text-emerald-700", label: "매수" },
  HOLD: { bg: "bg-amber-50", text: "text-amber-700", label: "보유" },
  SELL: { bg: "bg-rose-50", text: "text-rose-700", label: "매도" },
};

export function ConsensusBadge({ verdict, score, size = "md" }: Props) {
  const s = VERDICT_STYLE[verdict];
  const px = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${s.bg} ${s.text} ${px} font-semibold`}
      aria-label={`합의: ${s.label}${score ? ` (${score})` : ""}`}
    >
      {s.label}
      {score && <span className="opacity-70 tabular-nums">· {score}</span>}
    </span>
  );
}
```

⚠️ `import type { Verdict } from "../client"` — entities 내부 상대 경로. 다른 곳에서는 `@/entities/stock-analysis/client` 사용.

- [ ] **Step 2: ui/PersonaTab.tsx**

```tsx
"use client";

import type {
  PersonaAnalysis,
  PersonaKey,
} from "../client";
import { PERSONA_DISPLAY } from "../client";
import { ConsensusBadge } from "./ConsensusBadge";

interface Props {
  persona: PersonaKey;
  analysis: PersonaAnalysis | null;
}

const MODEL_LABEL: Record<"claude" | "codex" | "gemini", string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export function PersonaTab({ persona, analysis }: Props) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        {PERSONA_DISPLAY[persona]} 분석이 실패했습니다. 다른 페르소나의 결과를 참조하세요.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ConsensusBadge verdict={analysis.verdict} size="sm" />
        <span className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
          {MODEL_LABEL[analysis.modelUsed]}
        </span>
      </div>
      <p className="text-sm font-semibold leading-snug">
        {analysis.oneLineThesis}
      </p>
      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-text)]">
        {analysis.narrative}
      </p>
      {Object.keys(analysis.keyMetrics).length > 0 && (
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--color-surface-2)] p-3 text-xs md:grid-cols-3">
          {Object.entries(analysis.keyMetrics).map(([key, value]) => (
            <div key={key}>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {key}
              </dt>
              <dd className="font-semibold tabular-nums">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {analysis.risks.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            주요 리스크
          </div>
          <ul className="list-inside list-disc text-xs text-[var(--color-text)]">
            {analysis.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: client.ts 에 UI 부품 export 추가**

기존 type/상수 export 뒤에:

```ts
export { ConsensusBadge } from "./ui/ConsensusBadge";
export { PersonaTab } from "./ui/PersonaTab";
```

- [ ] **Step 4: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/entities/stock-analysis/ui/ apps/dashboard/src/entities/stock-analysis/client.ts
git commit -m "feat(stock-analysis): entities/stock-analysis 의 ConsensusBadge + PersonaTab UI 부품"
```

---

## Task 5.3: StockDetailModal — A 레이아웃

**Files:**
- Create: `apps/dashboard/src/widgets/stock-analysis/StockDetailModal.tsx`

A 레이아웃: 합의 hero (상단 항상) → 공통 데이터 (차트 + 펀더멘털) → 페르소나 5 탭 → 면책 footer.

- [ ] **Step 1: StockDetailModal.tsx**

```tsx
"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import {
  PERSONA_DISPLAY,
  type PersonaKey,
  type PersonaAnalysis,
  type Consensus,
  type MarketSnapshot,
} from "@/entities/stock-analysis/client";
import {
  ConsensusBadge,
  PersonaTab,
} from "@/entities/stock-analysis/client";
import { Modal } from "@/shared/ui/Modal";
import { PriceChart } from "@/shared/ui/PriceChart";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: PortfolioHolding;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
}

const PERSONA_ORDER: PersonaKey[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
];

function FundamentalCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">
        {typeof value === "number" ? `${value.toLocaleString()}${suffix ?? ""}` : "—"}
      </div>
    </div>
  );
}

export function StockDetailModal({
  open,
  onOpenChange,
  holding,
  personas,
  consensus,
  snapshot,
  dailyOHLC,
}: Props) {
  const [activeTab, setActiveTab] = useState<PersonaKey>(
    PERSONA_ORDER.find((p) => personas[p]) ?? "wallStreet",
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${holding.displayName} · ${holding.symbol}`}
      description={`${holding.market} · ${snapshot.currency} ${snapshot.price.toLocaleString()} (${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(2)}%)`}
      size="xl"
    >
      <div className="flex flex-col gap-6">
        {/* 합의 hero */}
        <section
          aria-labelledby="consensus-heading"
          className="rounded-xl bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-surface)] p-4"
        >
          <div className="flex items-center justify-between">
            <h3 id="consensus-heading" className="text-base font-bold">
              ▶ 합의 분석
            </h3>
            <ConsensusBadge verdict={consensus.verdict} score={consensus.score} />
          </div>
          <p className="mt-2 text-sm leading-relaxed">
            {consensus.oneLineConsensus}
          </p>
          {consensus.agreements.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                공통 결론
              </div>
              <ul className="mt-1 list-inside list-disc text-xs">
                {consensus.agreements.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {consensus.disagreements.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                의견 갈림
              </div>
              <ul className="mt-1 list-inside list-disc text-xs">
                {consensus.disagreements.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              핵심 리스크
            </div>
            <ol className="mt-1 list-inside list-decimal text-xs">
              {consensus.riskRanking.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          </div>
          {consensus.failedPersonas.length > 0 && (
            <p className="mt-3 text-[10px] text-[var(--color-text-muted)]">
              ⚠️ 분석 실패:{" "}
              {consensus.failedPersonas.map((p) => PERSONA_DISPLAY[p]).join(", ")}
            </p>
          )}
        </section>

        {/* 차트 + 펀더멘털 */}
        <section aria-labelledby="data-heading" className="flex flex-col gap-3">
          <h3
            id="data-heading"
            className="text-sm font-semibold text-[var(--color-text-muted)]"
          >
            시장 데이터
          </h3>
          <PriceChart data={dailyOHLC} currency={snapshot.currency} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <FundamentalCard label="시가총액" value={snapshot.marketCap} />
            <FundamentalCard label="PER" value={snapshot.per} />
            <FundamentalCard label="PBR" value={snapshot.pbr} />
            <FundamentalCard
              label="배당수익률"
              value={
                snapshot.dividendYield ? snapshot.dividendYield * 100 : undefined
              }
              suffix="%"
            />
          </div>
        </section>

        {/* 페르소나 탭 */}
        <section aria-labelledby="personas-heading">
          <h3
            id="personas-heading"
            className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]"
          >
            페르소나별 분석
          </h3>
          <div
            role="tablist"
            className="mb-3 flex flex-wrap gap-2 border-b border-[var(--color-hairline)]"
          >
            {PERSONA_ORDER.map((p) => {
              const available = !!personas[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === p}
                  onClick={() => setActiveTab(p)}
                  disabled={!available}
                  className={`px-3 py-2 text-xs font-semibold ${
                    activeTab === p
                      ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  } ${!available ? "opacity-40" : ""}`}
                >
                  {PERSONA_DISPLAY[p]}
                  {!available && <span className="ml-1 text-[8px]">✕</span>}
                </button>
              );
            })}
          </div>
          <PersonaTab persona={activeTab} analysis={personas[activeTab] ?? null} />
        </section>

        {/* 면책 */}
        <footer className="border-t border-[var(--color-hairline)] pt-4 text-[10px] text-[var(--color-text-muted)]">
          본 분석은 LLM 페르소나의 가상 의견이며 투자 자문이 아닙니다. 실제 투자 결정은 본인 책임입니다.
        </footer>
      </div>
    </Modal>
  );
}
```

⚠️ activeTab default 는 첫 성공 페르소나. 실패 페르소나 탭은 disabled.

- [ ] **Step 2: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/stock-analysis/StockDetailModal.tsx
git commit -m "feat(stock-analysis): StockDetailModal — A 레이아웃 (합의 hero + 페르소나 탭 + 차트)"
```

---

## Task 5.4: StockAnalysisSkeleton

**Files:**
- Create: `apps/dashboard/src/widgets/stock-analysis/StockAnalysisSkeleton.tsx`

- [ ] **Step 1: 작성**

```tsx
export function StockAnalysisSkeleton() {
  return (
    <section
      aria-labelledby="stock-analysis-heading"
      aria-busy="true"
      className="col-span-1 max-w-[760px]"
    >
      <h2
        id="stock-analysis-heading"
        className="mb-4 flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
      >
        <span>포트폴리오 분석</span>
        <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
          로딩 중…
        </span>
      </h2>
      <div className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-12 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: typecheck + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/stock-analysis/StockAnalysisSkeleton.tsx
git commit -m "feat(stock-analysis): StockAnalysisSkeleton (Suspense fallback)"
```

---

## Task 5.5: StockAnalysisCard — RSC, 옵션 3

**Files:**
- Create: `apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx`
- Create: `apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx`
- Create: `apps/dashboard/src/widgets/stock-analysis/index.ts`

- [ ] **Step 1: HoldingDetailButton.tsx (client wrapper)**

```tsx
"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  PersonaKey,
  PersonaAnalysis,
  Consensus,
  MarketSnapshot,
} from "@/entities/stock-analysis/client";
import { ConsensusBadge } from "@/entities/stock-analysis/client";
import { StockDetailModal } from "./StockDetailModal";

interface Props {
  holding: PortfolioHolding;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  snapshot: MarketSnapshot;
  dailyOHLC: Array<{ date: string; close: number; volume: number }>;
  variant: "hero" | "row";
}

function formatChange(curr: number, avgCost: number) {
  const pct = ((curr - avgCost) / avgCost) * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "text-emerald-700" : "text-rose-700";
  return { pct, label: `${sign}${pct.toFixed(1)}%`, color };
}

const VERDICT_LABEL = { BUY: "매수", HOLD: "보유", SELL: "매도" } as const;

export function HoldingDetailButton({
  holding,
  personas,
  consensus,
  snapshot,
  dailyOHLC,
  variant,
}: Props) {
  const [open, setOpen] = useState(false);
  const change = formatChange(snapshot.price, Number(holding.avgCost));

  if (variant === "hero") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 text-left transition hover:from-emerald-100 hover:to-emerald-200"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            ▶ 오늘의 시선 · {consensus.score.split("/")[0]}명{" "}
            {VERDICT_LABEL[consensus.verdict]}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <strong className="text-lg">{holding.displayName}</strong>
            <span
              className={`text-sm font-semibold tabular-nums ${change.color}`}
            >
              {change.label}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--color-text)]">
            {consensus.oneLineConsensus}
          </p>
        </button>
        <StockDetailModal
          open={open}
          onOpenChange={setOpen}
          holding={holding}
          personas={personas}
          consensus={consensus}
          snapshot={snapshot}
          dailyOHLC={dailyOHLC}
        />
      </>
    );
  }

  // variant === "row"
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg bg-[var(--color-surface)] px-3 py-2 text-xs transition hover:bg-[var(--color-surface-2)]"
      >
        <span className="font-semibold">{holding.symbol}</span>
        <ConsensusBadge
          verdict={consensus.verdict}
          score={consensus.score}
          size="sm"
        />
        <span className={`tabular-nums ${change.color}`}>{change.label}</span>
      </button>
      <StockDetailModal
        open={open}
        onOpenChange={setOpen}
        holding={holding}
        personas={personas}
        consensus={consensus}
        snapshot={snapshot}
        dailyOHLC={dailyOHLC}
      />
    </>
  );
}
```

⚠️ `Number(holding.avgCost)` — quantity/avgCost 가 numeric 컬럼이라 string. JavaScript number 로 변환해 % 계산.

- [ ] **Step 2: StockAnalysisCard.tsx (RSC)**

```tsx
import "server-only";
import { format } from "date-fns";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import { getHoldings } from "@/entities/portfolio-holding/server";
import { getCachedAnalysis } from "@/entities/stock-analysis/server";
import { fetchYahooQuotes, fetchYahooDailyOHLC } from "@gons/stock-analysis";
import { SettingsButton } from "./SettingsButton";
import { HoldingDetailButton } from "./HoldingDetailButton";

export async function StockAnalysisCard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const holdings = await getHoldings(session.user.id);
  if (holdings.length === 0) {
    return <EmptyCard />;
  }

  // 사용자 모델 override (SettingsButton 으로 전달)
  const overridesRow = await db
    .select()
    .from(stockPersonaPreferences)
    .where(eq(stockPersonaPreferences.userId, session.user.id))
    .limit(1);
  const initialOverrides = overridesRow[0]?.overrides ?? {};

  // 시세 (배치) + 캐시 분석 + 일봉
  const symbols = holdings.map((h) => h.symbol);
  const today = format(new Date(), "yyyy-MM-dd");
  const [quotes, analyses, dailySets] = await Promise.all([
    fetchYahooQuotes(symbols).catch(() => []),
    Promise.all(symbols.map((s) => getCachedAnalysis(s, today, null))),
    Promise.all(symbols.map((s) => fetchYahooDailyOHLC(s, "1y").catch(() => []))),
  ]);
  const quoteBySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  const enriched = holdings.map((h, i) => ({
    holding: h,
    quote: quoteBySymbol[h.symbol],
    analysis: analyses[i],
    dailyOHLC: dailySets[i],
  }));

  // 헤드라인: 합의 score 가장 강한 종목
  const cached = enriched.filter((e) => e.analysis !== null);
  const headline = cached.sort((a, b) => {
    const aScore = Number(a.analysis?.consensus.score.split("/")[0] ?? 0);
    const bScore = Number(b.analysis?.consensus.score.split("/")[0] ?? 0);
    return bScore - aScore;
  })[0];

  return (
    <section
      aria-labelledby="stock-analysis-heading"
      className="col-span-1 max-w-[760px]"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2
          id="stock-analysis-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>포트폴리오 분석</span>
          <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">
            {holdings.length}종목
          </span>
        </h2>
        <SettingsButton
          initialHoldings={holdings}
          initialOverrides={initialOverrides}
        />
      </header>

      <div className="flex flex-col gap-3">
        {headline && headline.analysis && (
          <HoldingDetailButton
            holding={headline.holding}
            personas={headline.analysis.personas}
            consensus={headline.analysis.consensus}
            snapshot={headline.analysis.marketSnapshot}
            dailyOHLC={headline.dailyOHLC}
            variant="hero"
          />
        )}

        {cached.length > 1 && (
          <div className="flex flex-col gap-1">
            {cached
              .filter((e) => e.holding.id !== headline?.holding.id)
              .map((e) =>
                e.analysis ? (
                  <HoldingDetailButton
                    key={e.holding.id}
                    holding={e.holding}
                    personas={e.analysis.personas}
                    consensus={e.analysis.consensus}
                    snapshot={e.analysis.marketSnapshot}
                    dailyOHLC={e.dailyOHLC}
                    variant="row"
                  />
                ) : null,
              )}
          </div>
        )}

        {/* 캐시 miss 종목 — Phase 6 lazy trigger 가 placeholder 자리 교체 */}
        {enriched.filter((e) => !e.analysis).length > 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-3 text-xs text-[var(--color-text-muted)]">
            {enriched.filter((e) => !e.analysis).length}개 종목 분석 대기 중 (Phase 6: 자동 생성)
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyCard() {
  return (
    <section
      aria-labelledby="stock-analysis-heading"
      className="col-span-1 max-w-[760px]"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2
          id="stock-analysis-heading"
          className="text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          포트폴리오 분석
        </h2>
        <SettingsButton initialHoldings={[]} initialOverrides={{}} />
      </header>
      <div className="rounded-xl border border-dashed border-[var(--color-hairline)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        <p>아직 등록된 종목이 없습니다.</p>
        <p className="mt-1 text-xs">우상단 ⚙ 클릭 → 포트폴리오에서 추가하세요.</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: index.ts**

```ts
export { StockAnalysisCard } from "./StockAnalysisCard";
export { StockAnalysisSkeleton } from "./StockAnalysisSkeleton";
```

- [ ] **Step 4: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/widgets/stock-analysis/StockAnalysisCard.tsx apps/dashboard/src/widgets/stock-analysis/HoldingDetailButton.tsx apps/dashboard/src/widgets/stock-analysis/index.ts
git commit -m "feat(stock-analysis): StockAnalysisCard (RSC, 옵션 3 헤드라인+리스트) + HoldingDetailButton"
```

---

## Task 5.6: page.tsx 통합

**Files:**
- Modify: `apps/dashboard/src/app/page.tsx`

좌 7-grid 의 EmailDigest / ImportantEmails / ServerOverview 다음에 StockAnalysisCard 추가.

- [ ] **Step 1: import 추가**

기존 `import { ... } from "@/widgets/server-overview"` 다음에:

```ts
import {
  StockAnalysisCard,
  StockAnalysisSkeleton,
} from "@/widgets/stock-analysis";
```

- [ ] **Step 2: 좌 7-grid JSX 에 추가**

기존 좌 컬럼의 `<Suspense fallback={<ServerOverviewSkeleton />}><ServerOverviewCard /></Suspense>` 다음에:

```tsx
<Suspense fallback={<StockAnalysisSkeleton />}>
  <StockAnalysisCard />
</Suspense>
```

- [ ] **Step 3: typecheck + lint + commit**

```bash
pnpm --filter @gons/dashboard typecheck
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/app/page.tsx
git commit -m "feat(stock-analysis): page.tsx 좌 7-grid 에 StockAnalysisCard 통합 (Suspense + skeleton)"
```

---

## Task 5.7: 로컬 dev dogfooding (수동 검증)

이 task 는 사용자 직접 수행. subagent 가 아님.

- [ ] **Step 1: 로컬 dev 서버**: `pnpm dev` → http://localhost:3020 접속
- [ ] **Step 2: 첫 인상 확인**: 좌 7-grid 에 "포트폴리오 분석" 위젯 카드 + ⚙ 버튼
- [ ] **Step 3: 종목 추가**: ⚙ → Portfolio 탭 → AAPL/NVDA/005930.KS/BTC-USD 1-2개 추가
- [ ] **Step 4: placeholder 확인**: "X개 종목 분석 대기 중" 표시 (캐시 miss — Phase 6 가 채움)
- [ ] **Step 5: LLM 탭 검증**: 6 페르소나 × 3 모델 라디오 + 기본값 확인
- [ ] **Step 6: 결과 보고**: PR body 의 수동 검증 체크박스 마킹

⚠️ Phase 5 단계의 검증은 UI 구조 + 모달 흐름까지. 실제 합의/페르소나 렌더링은 Phase 6 lazy trigger 후 검증.

---

## Task 5.8: 통합 검증 + PR

- [ ] **Step 1: typecheck**: `pnpm typecheck`
- [ ] **Step 2: lint**: `cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint`
- [ ] **Step 3: test**: `pnpm test` (stock-analysis 35 PASS, saju 152 PASS, dashboard pre-existing 외 신규 fail 없음)
- [ ] **Step 4: commit 검증**: `git log --oneline origin/main..HEAD` → 6 commit (T5.1~T5.6)
- [ ] **Step 5: branch push + PR**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin feat/stock-analysis-phase-5

gh pr create --title "feat(stock-analysis): Phase 5 — Widget Card + Detail Modal" --body "$(cat <<'EOF'
## Summary
- Recharts 신규 도입 — PriceChart (MA20/MA60 + RSI14 + 1M/3M/6M/1Y 토글)
- TA helper (simpleMovingAverage, relativeStrengthIndex) — Phase 6 가 snapshot 채울 때 재사용
- ConsensusBadge + PersonaTab UI 부품 (entities/stock-analysis)
- StockDetailModal — A 레이아웃 (합의 hero + 차트 + 펀더멘털 + 페르소나 5 탭 + 면책 footer)
- StockAnalysisCard (RSC, 옵션 3) — 헤드라인 종목 hero + 나머지 row, 우상단 ⚙ → SettingsModal
- HoldingDetailButton — client wrapper (variant: hero / row), 클릭 → StockDetailModal open
- StockAnalysisSkeleton (Suspense fallback)
- page.tsx 좌 7-grid 통합

## Notes
- 캐시 hit 만 표시 — miss 는 Phase 6 lazy trigger 책임
- 합의 score 가장 강한 종목 자동 헤드라인 선택
- MA/RSI: PriceChart 자체 계산 + Phase 6 snapshot 채움 (helper 공유)
- 면책 footer: 모달 하단 고정 (spec §5.2)

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §5.1, §5.2
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-5-widget-detail.md

## Test plan
- [x] pnpm typecheck PASS
- [x] cd apps/dashboard && pnpm lint PASS
- [x] pnpm test (변동 없음)
- [ ] (수동) 로컬 dev → 종목 등록 → 위젯 + 모달 UI 시각 확인 (T5.7)
- [ ] Phase 6 lazy trigger 후 실제 합의/페르소나 텍스트 렌더링 검증

🤖 Generated with Claude Code
EOF
)"
```

PR URL 반환.

---

## Phase 5 self-check

- [ ] `pnpm typecheck && (cd apps/dashboard && pnpm lint) && pnpm test` PASS
- [ ] Recharts 정상 install (pnpm-lock.yaml 갱신)
- [ ] PriceChart 가 ResponsiveContainer 안에서 정상 렌더
- [ ] StockDetailModal 의 페르소나 탭 default = 첫 성공 페르소나
- [ ] StockAnalysisCard 의 헤드라인 = 합의 score 가장 강한 종목
- [ ] 면책 footer 모달 하단 고정
- [ ] PR 머지 후 main Docker 빌드 success

Phase 5 PR 머지 후 Phase 6 (Lazy Trigger + Polling) 진입.

---

## 횡단 관심사 (Phase 5 갱신)

- **Recharts vs lightweight-charts (spec §10):** Recharts 채택. line/area 만 지원하지만 v1.0 범위에는 충분. candlestick 필요 시 v1.1+ 에서 lightweight-charts 추가.
- **TA helper 단일 위치:** `shared/lib/ta/indicators.ts`. PriceChart + Phase 6 orchestrator 가 같은 함수 호출.
- **Yahoo OHLC fetch:** Phase 5 RSC 가 N 종목 병렬. 운영 부담 시 Phase 6 에서 `unstable_cache` 또는 entities 안에서 24h 캐싱 도입.
- **`HoldingDetailButton` variant 분리:** hero vs row 같은 모달 컴포넌트 재사용.
- **EmptyCard 의 SettingsButton**: holdings 빈 배열이어도 ⚙ 진입 가능 → 첫 종목 추가 자연스러움.
- **Phase 4 T4.4 우려 #2/#3 (모바일 onBlur, Enter+blur):** T5.7 dogfooding 에서 모바일 실측 — 운영 배포 (Phase 8) 전 보완.
- **Yahoo OHLC fail 시 `[]` 폴백:** PriceChart 가 "차트 데이터가 없습니다" empty state 처리. 합의/페르소나는 캐시에 있으면 그대로 렌더 (차트만 빠짐).
