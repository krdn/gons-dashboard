import type { MajorFortune, Stem, Branch } from "@gons/saju";
import { STEM_KO, BRANCH_KO } from "@gons/saju";

export interface SajuMajorFortuneStripProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
}

function isCurrent(fortunes: MajorFortune[], i: number, age: number): boolean {
  const f = fortunes[i];
  if (!f) return false;
  const next = fortunes[i + 1];
  return age >= f.startAge && (next ? age < next.startAge : true);
}

export function SajuMajorFortuneStrip({ majorFortunes, currentAge }: SajuMajorFortuneStripProps) {
  return (
    <ol className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {majorFortunes.map((mf, i) => {
        const current = isCurrent(majorFortunes, i, currentAge);
        return (
          <li
            key={`${mf.startYear}-${mf.stem}${mf.branch}`}
            className={`rounded p-2 text-center ${
              current
                ? "border-2 border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)]"
                : "border border-[var(--color-hairline)]"
            }`}
          >
            <div
              className="text-base leading-none"
              style={{ fontFamily: "var(--font-hanja)" }}
              lang="ko-Hani"
            >
              {mf.stem}
              {mf.branch}
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
              {STEM_KO[mf.stem as Stem]}
              {BRANCH_KO[mf.branch as Branch]}
            </div>
            <div className="mt-1 text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {mf.startAge}세~
            </div>
            {current && (
              <div className="mt-1 text-[10px] font-medium text-[var(--color-accent)]">
                진행 중
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
