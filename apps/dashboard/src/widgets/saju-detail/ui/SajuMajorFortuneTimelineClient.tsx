"use client";
import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  STEM_KO,
  BRANCH_KO,
  TEN_GOD_KO,
  STEM_ELEMENT,
  BRANCH_ELEMENT,
  tenGodsForPillar,
  type MajorFortune,
  type Stem,
  type Branch,
} from "@gons/saju";
import { splitMajorFortuneBody } from "./splitMajorFortuneBody";

export interface SajuMajorFortuneTimelineClientProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
  dayStem: Stem;
  majorFortuneBody: string | null;
}

function findCurrentIndex(fortunes: MajorFortune[], age: number): number {
  for (let i = 0; i < fortunes.length; i++) {
    const next = fortunes[i + 1];
    if (age >= fortunes[i].startAge && (!next || age < next.startAge)) return i;
  }
  return 0;
}

export function SajuMajorFortuneTimelineClient({
  majorFortunes,
  currentAge,
  dayStem,
  majorFortuneBody,
}: SajuMajorFortuneTimelineClientProps) {
  const currentIndex = findCurrentIndex(majorFortunes, currentAge);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);

  const segments = useMemo(
    () => (majorFortuneBody ? splitMajorFortuneBody(majorFortuneBody) : []),
    [majorFortuneBody],
  );
  const hasSegments = segments.length >= 8;

  const tenGodsList = useMemo(
    () =>
      majorFortunes.map((mf) =>
        tenGodsForPillar(dayStem, {
          stem: mf.stem as Stem,
          branch: mf.branch as Branch,
        }),
      ),
    [majorFortunes, dayStem],
  );

  return (
    <div>
      <ol className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {majorFortunes.map((mf, i) => {
          const isCurrent = i === currentIndex;
          const isSelected = i === selectedIndex;
          const stemEl = STEM_ELEMENT[mf.stem as Stem];
          const branchEl = BRANCH_ELEMENT[mf.branch as Branch];
          const tg = tenGodsList[i];
          return (
            <li key={`${mf.startYear}-${mf.stem}${mf.branch}`}>
              <button
                type="button"
                onClick={() => hasSegments && setSelectedIndex(i)}
                aria-pressed={isSelected}
                disabled={!hasSegments}
                className={`w-full overflow-hidden rounded text-center ${
                  isCurrent
                    ? "border-2 border-[var(--color-accent)]"
                    : isSelected
                      ? "border-2 border-[var(--color-text-muted)]"
                      : "border border-[var(--color-hairline)]"
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] disabled:cursor-default`}
              >
                <div className="px-1 py-1 text-[10px] tabular-nums text-[var(--color-text-subtle)]">
                  {mf.startAge}세~
                </div>
                <div
                  className="flex h-9 items-center justify-center"
                  style={{
                    backgroundColor: `var(--color-${stemEl})`,
                    color: "var(--color-surface)",
                  }}
                >
                  <span
                    style={{ fontFamily: "var(--font-hanja)" }}
                    className="text-lg"
                    lang="ko-Hani"
                  >
                    {mf.stem}
                  </span>
                </div>
                <div
                  className="flex h-9 items-center justify-center"
                  style={{
                    backgroundColor: `var(--color-${branchEl})`,
                    color: "var(--color-surface)",
                  }}
                >
                  <span
                    style={{ fontFamily: "var(--font-hanja)" }}
                    className="text-lg"
                    lang="ko-Hani"
                  >
                    {mf.branch}
                  </span>
                </div>
                <div className="px-1 py-1 text-[10px] text-[var(--color-text-muted)]">
                  {STEM_KO[mf.stem as Stem]}
                  {BRANCH_KO[mf.branch as Branch]}
                </div>
                <div className="px-1 pb-1 text-[10px] text-[var(--color-text-muted)]">
                  {TEN_GOD_KO[tg.branchTenGod]}
                </div>
                {isCurrent && (
                  <div
                    className="px-1 pb-1 text-[10px] font-medium text-[var(--color-accent)]"
                    style={{
                      backgroundColor:
                        "color-mix(in oklch, var(--color-accent) 8%, transparent)",
                    }}
                  >
                    진행 중
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {hasSegments && (
        <article className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold">
            {segments[selectedIndex]?.age}세{" "}
            <span style={{ fontFamily: "var(--font-hanja)" }} lang="ko-Hani">
              {segments[selectedIndex]?.ganZhi}
            </span>
            {selectedIndex === currentIndex && (
              <span className="ml-2 text-xs font-medium text-[var(--color-accent)]">
                현재 진행 중
              </span>
            )}
          </h3>
          <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-2">
            <ReactMarkdown>{segments[selectedIndex]?.body ?? "(해설 없음)"}</ReactMarkdown>
          </div>
        </article>
      )}
      {!hasSegments && majorFortuneBody && (
        <article className="mt-6 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4">
          <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-2">
            <ReactMarkdown>{majorFortuneBody}</ReactMarkdown>
          </div>
        </article>
      )}
    </div>
  );
}
