// yearly 의 4학파 합의(agreement) 표시 — server-safe, no client hooks.
//
// TriNationYearly.crossCheck shape:
//   - agreement: "high" | "medium" | "low"
//   - notes: string[]
//
// 정책:
//   - agreement=high  → ✓ 정상 (notes 숨김, lifetime 의 "정상은 침묵" 패러다임 일관)
//   - agreement=medium → ⓘ 주의 (회색 톤, notes 노출)
//   - agreement=low    → ⚠ 경고 (amber-700, notes 노출)
//   - targetYear 는 헤더에 함께 표시 (어느 해의 합의인지 명시)
//
// 디자인 토큰: --color-hairline / --color-surface-2 (lifetime 위젯 sub-block 토큰과 일치).
import type { TriNationYearly } from "@krdn/saju";

interface Props {
  triNation: TriNationYearly;
}

const STATUS_OK = "text-[var(--color-text-muted)]";
const STATUS_INFO = "text-[var(--color-text-muted)]";
const STATUS_WARN = "text-amber-700";

export function YearlyCrossCheckBadge({ triNation }: Props) {
  const { targetYear, crossCheck } = triNation;
  const { agreement, notes } = crossCheck;

  const label =
    agreement === "high"
      ? { icon: "✓", text: "4학파 합의 통과", className: STATUS_OK }
      : agreement === "medium"
        ? { icon: "ⓘ", text: "4학파 합의 부분 불일치", className: STATUS_INFO }
        : { icon: "⚠", text: "4학파 합의 낮음 — 학파별 해석 차이 큼", className: STATUS_WARN };

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-3 text-sm space-y-1">
      <div className={label.className}>
        {label.icon} {targetYear}년 — {label.text}
      </div>
      {agreement !== "high" && notes.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5 text-[var(--color-text-muted)]">
          {notes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
