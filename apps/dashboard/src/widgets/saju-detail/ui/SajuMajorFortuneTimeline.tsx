import type { MajorFortune, Stem } from "@krdn/saju";
import { SajuMajorFortuneTimelineClient } from "./SajuMajorFortuneTimelineClient";

export interface SajuMajorFortuneTimelineProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
  dayStem: Stem;
  majorFortuneBody: string | null;
}

export function SajuMajorFortuneTimeline(props: SajuMajorFortuneTimelineProps) {
  return <SajuMajorFortuneTimelineClient {...props} />;
}
