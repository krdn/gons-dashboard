import {
  STEM_KO, BRANCH_KO, TEN_GOD_KO,
  STEM_ELEMENT, BRANCH_ELEMENT,
  type Stem, type Branch, type Element, type TenGod, type TenGodAssignment,
} from "@gons/saju";
import type { SajuChartRow } from "@/entities/saju-chart";

interface CellProps {
  hanja: string;
  ko: string;
  tenGod?: TenGod | null;
  element: Element;
  highlight?: boolean;
}

function Cell({ hanja, ko, tenGod, element, highlight }: CellProps) {
  return (
    <td
      className={`p-3 align-top text-center border ${
        highlight
          ? "border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)]"
          : "border-[var(--color-hairline)]"
      }`}
    >
      <div
        className="text-4xl leading-none"
        style={{ fontFamily: "var(--font-hanja)", color: `var(--color-${element})` }}
        lang="ko-Hani"
      >
        {hanja}
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-subtle)]">({ko})</div>
      <div className="mt-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {tenGod ? TEN_GOD_KO[tenGod] : "─"}
      </div>
    </td>
  );
}

export interface SajuPillarsBoardProps {
  chart: Pick<
    SajuChartRow,
    | "yearStem" | "yearBranch"
    | "monthStem" | "monthBranch"
    | "dayStem" | "dayBranch"
    | "hourStem" | "hourBranch"
    | "tenGods"
  >;
}

export function SajuPillarsBoard({ chart }: SajuPillarsBoardProps) {
  const tg = chart.tenGods as TenGodAssignment;

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr className="text-xs text-[var(--color-text-muted)]">
          <th scope="col" className="p-2 font-medium">시주 (時柱)</th>
          <th scope="col" className="p-2 font-medium">일주 (日柱)</th>
          <th scope="col" className="p-2 font-medium">월주 (月柱)</th>
          <th scope="col" className="p-2 font-medium">연주 (年柱)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          {chart.hourStem && chart.hourBranch ? (
            <Cell
              hanja={chart.hourStem}
              ko={STEM_KO[chart.hourStem as Stem]}
              tenGod={tg.hourStem}
              element={STEM_ELEMENT[chart.hourStem as Stem]}
            />
          ) : (
            <td className="p-3 text-center text-xs text-[var(--color-text-subtle)] border border-dashed border-[var(--color-hairline)]">
              시각 미상
            </td>
          )}
          <Cell
            hanja={chart.dayStem}
            ko={STEM_KO[chart.dayStem as Stem]}
            tenGod={null}
            element={STEM_ELEMENT[chart.dayStem as Stem]}
            highlight
          />
          <Cell
            hanja={chart.monthStem}
            ko={STEM_KO[chart.monthStem as Stem]}
            tenGod={tg.monthStem}
            element={STEM_ELEMENT[chart.monthStem as Stem]}
          />
          <Cell
            hanja={chart.yearStem}
            ko={STEM_KO[chart.yearStem as Stem]}
            tenGod={tg.yearStem}
            element={STEM_ELEMENT[chart.yearStem as Stem]}
          />
        </tr>
        <tr>
          {chart.hourStem && chart.hourBranch ? (
            <Cell
              hanja={chart.hourBranch}
              ko={BRANCH_KO[chart.hourBranch as Branch]}
              tenGod={tg.hourBranch}
              element={BRANCH_ELEMENT[chart.hourBranch as Branch]}
            />
          ) : (
            <td className="p-3 text-center text-xs text-[var(--color-text-subtle)] border border-dashed border-[var(--color-hairline)]">
              —
            </td>
          )}
          <Cell
            hanja={chart.dayBranch}
            ko={BRANCH_KO[chart.dayBranch as Branch]}
            tenGod={tg.dayBranch}
            element={BRANCH_ELEMENT[chart.dayBranch as Branch]}
          />
          <Cell
            hanja={chart.monthBranch}
            ko={BRANCH_KO[chart.monthBranch as Branch]}
            tenGod={tg.monthBranch}
            element={BRANCH_ELEMENT[chart.monthBranch as Branch]}
          />
          <Cell
            hanja={chart.yearBranch}
            ko={BRANCH_KO[chart.yearBranch as Branch]}
            tenGod={tg.yearBranch}
            element={BRANCH_ELEMENT[chart.yearBranch as Branch]}
          />
        </tr>
      </tbody>
    </table>
  );
}
