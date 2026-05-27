// daily 의 4학파 합의(overallVibe) 표시 — server-safe, no client hooks.
//
// monthly 의 MonthlyCrossCheckBadge 와 달리 TriNationDailyLite 는
// crossCheck 객체가 없고 overallVibe ("auspicious"/"inauspicious"/"neutral") 만 있음.
// 디자인 토큰: --color-hairline / --color-surface-2.
import type { TriNationDailyLite } from "@krdn/saju";

interface Props {
  triNation: TriNationDailyLite;
}

const STATUS_AUSPICIOUS = "text-green-700";
const STATUS_NEUTRAL = "text-[var(--color-text-muted)]";
const STATUS_INAUSPICIOUS = "text-amber-700";

function ganjiKey(g: { stem: string; branch: string }): string {
  return `${g.stem}${g.branch}`;
}

export function DailyCrossCheckBadge({ triNation }: Props) {
  const { forDate, frames, overallVibe } = triNation;

  const label =
    overallVibe === "auspicious"
      ? { icon: "✓", text: "4학파 합의 — 길운", className: STATUS_AUSPICIOUS }
      : overallVibe === "inauspicious"
        ? { icon: "⚠", text: "4학파 합의 — 흉운", className: STATUS_INAUSPICIOUS }
        : { icon: "ⓘ", text: "4학파 합의 — 중립 또는 불일치", className: STATUS_NEUTRAL };

  const ganjiKeys = [
    ganjiKey(frames.ko.dayGanji),
    ganjiKey(frames.cnZiping.dayGanji),
    ganjiKey(frames.cnMangpai.dayGanji),
    ganjiKey(frames.jp.dayGanji),
  ];
  const uniqueGanji = Array.from(new Set(ganjiKeys));
  const ganjiDisplay = uniqueGanji.length === 1
    ? `일진: ${uniqueGanji[0]}`
    : `일진 학파별 차이: 한국 ${ganjiKeys[0]} / 中자평 ${ganjiKeys[1]} / 中맹파 ${ganjiKeys[2]} / 日추명 ${ganjiKeys[3]}`;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-3 text-sm space-y-1">
      <div className={label.className}>
        {label.icon} {forDate} — {label.text}
      </div>
      <div className="text-[var(--color-text-muted)]">{ganjiDisplay}</div>
    </div>
  );
}
