import type { SajuChart } from "../../types";
import type { JpYongshin } from "../../types/yongshin";
import type { DailyLiteFrame } from "../../types/daily-tri";
import { computeDayPillar } from "../../dayPillar";

/**
 * 일본 추명학 일진 어댑터 — 오행 단위 평가 불가 (yongShin 이 통변성 단위).
 *
 * yearly jp 와 동일한 한계: dayVibe 는 항상 "neutral" 로 고정. hints 에 favorable /
 * unfavorable 통변성 목록을 노출해 LLM narrative 가 이를 활용할 수 있게 한다.
 * (메모리 `saju-tri-yearly-design` JP daily verdict 한계 관찰 — v0.4 개선 후보)
 */
export function buildDailyLiteJp(args: {
  chart: SajuChart;
  forDate: string;
  yongShin: JpYongshin;
}): DailyLiteFrame {
  const { forDate, yongShin } = args;
  const dayPillar = computeDayPillar(forDate);

  const hints: string[] = [
    `일진 ${dayPillar.stem}${dayPillar.branch}`,
    `유리 통변성: ${yongShin.favorable.join("·") || "없음"}`,
    `불리 통변성: ${yongShin.unfavorable.join("·") || "없음"}`,
  ];

  return {
    school: "jp",
    forDate,
    dayGanji: { stem: dayPillar.stem, branch: dayPillar.branch },
    dayVibe: "neutral",
    hints,
  };
}
