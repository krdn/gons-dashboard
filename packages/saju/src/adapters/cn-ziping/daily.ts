import type { SajuChart } from "../../types";
import type { Element } from "../../hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "../../hanja";
import type { CnZipingYongshin } from "../../types/yongshin";
import type { DailyLiteFrame } from "../../types/daily-tri";
import { computeDayPillar } from "../../dayPillar";

/**
 * 중국 자평 일진 어댑터 — secondary 없음, primary + 종격 cascade 만 평가.
 */
export function buildDailyLiteCnZiping(args: {
  chart: SajuChart;
  forDate: string;
  yongShin: CnZipingYongshin;
}): DailyLiteFrame {
  const { forDate, yongShin } = args;
  const dayPillar = computeDayPillar(forDate);
  const dayStemEl = STEM_ELEMENT[dayPillar.stem];
  const dayBranchEl = BRANCH_ELEMENT[dayPillar.branch];

  const PRODUCES: Record<Element, Element> = {
    wood: "fire", fire: "earth", earth: "metal", metal: "water", water: "wood",
  };
  const isJonggyeok =
    yongShin.basisShenStrength === "종아" ||
    yongShin.basisShenStrength === "종재" ||
    yongShin.basisShenStrength === "종살";
  const xishen: Element | null = isJonggyeok ? PRODUCES[yongShin.primary] : null;

  const goodSet = new Set<Element>([
    yongShin.primary,
    ...(xishen ? [xishen] : []),
  ]);
  const gisinSet = new Set<Element>(yongShin.gisin);

  const dayEls: Element[] = [dayStemEl, dayBranchEl];
  const goodHits = dayEls.filter((e) => goodSet.has(e)).length;
  const badHits = dayEls.filter((e) => gisinSet.has(e)).length;

  let dayVibe: DailyLiteFrame["dayVibe"];
  if (goodHits >= 2 && badHits === 0) dayVibe = "auspicious";
  else if (badHits >= 2 && goodHits === 0) dayVibe = "inauspicious";
  else dayVibe = "neutral";

  const hints: string[] = [];
  hints.push(
    `일진 ${dayPillar.stem}${dayPillar.branch} — 천간 오행 ${dayStemEl}, 지지 오행 ${dayBranchEl}`,
  );
  if (yongShin.structureHint) {
    hints.push(`격국: ${yongShin.structureHint}`);
  }
  if (goodHits > 0) hints.push(`용신 ${yongShin.primary} 보강 ${goodHits}건`);
  if (badHits > 0) hints.push(`기신 ${yongShin.gisin.join("·")} 자극 ${badHits}건`);

  return {
    school: "cn-ziping",
    forDate,
    dayGanji: { stem: dayPillar.stem, branch: dayPillar.branch },
    dayVibe,
    hints,
  };
}
