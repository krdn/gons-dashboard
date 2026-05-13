import type { Element, Strength } from "@gons/saju";
import { ELEMENT_KO } from "@gons/saju";

const STRENGTH_KO: Record<Strength, string> = {
  "very-strong": "극왕",
  "strong": "신왕",
  "balanced": "중화",
  "weak": "신약",
  "very-weak": "극약",
};

export interface SajuPatternCardProps {
  pattern: string;
  strength: Strength;
  yongSin: Element[];
  giSin: Element[];
}

export function SajuPatternCard({ pattern, strength, yongSin, giSin }: SajuPatternCardProps) {
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">격국</dt>
      <dd>
        <span style={{ fontFamily: "var(--font-hanja)" }} className="text-base" lang="ko-Hani">
          {pattern}
        </span>
      </dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">신강도</dt>
      <dd className="text-sm">
        {STRENGTH_KO[strength]} <span className="text-xs text-[var(--color-text-subtle)]">({strength})</span>
      </dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">용신</dt>
      <dd className="flex flex-wrap gap-2">
        {yongSin.map((el) => (
          <span
            key={el}
            className="rounded px-2 py-0.5 text-xs"
            style={{ backgroundColor: `var(--color-${el})`, color: "white" }}
          >
            {ELEMENT_KO[el]}
          </span>
        ))}
      </dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">기신</dt>
      <dd className="flex flex-wrap gap-2">
        {giSin.map((el) => (
          <span
            key={el}
            className="rounded border border-[var(--color-hairline-strong)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
          >
            {ELEMENT_KO[el]}
          </span>
        ))}
      </dd>
    </dl>
  );
}
