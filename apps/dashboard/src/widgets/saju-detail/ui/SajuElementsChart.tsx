import type { ElementCount, Element } from "@krdn/saju";
import { ELEMENT_KO } from "@krdn/saju";

const ELEMENTS: Element[] = ["wood", "fire", "earth", "metal", "water"];
const MAX_COUNT = 8;

export interface SajuElementsChartProps {
  elements: ElementCount;
}

export function SajuElementsChart({ elements }: SajuElementsChartProps) {
  return (
    <ul className="flex flex-col gap-2">
      {ELEMENTS.map((el) => {
        const count = elements[el];
        const pct = Math.round((count / MAX_COUNT) * 100);
        return (
          <li key={el} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs font-medium text-[var(--color-text-muted)]">
              {ELEMENT_KO[el]}
            </span>
            <div className="flex-1 rounded-sm bg-[var(--color-surface-2)] h-2">
              <div
                className="h-2 rounded-sm"
                style={{
                  width: count === 0 ? 0 : `${pct}%`,
                  backgroundColor: `var(--color-${el})`,
                }}
                aria-label={`${ELEMENT_KO[el]} ${count}개`}
              />
            </div>
            <span
              className={`w-6 shrink-0 text-right text-xs tabular-nums ${
                count === 0
                  ? "text-[var(--color-severity-high)] font-medium"
                  : "text-[var(--color-text-subtle)]"
              }`}
            >
              {count === 0 ? "─" : count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
