import type { SajuChart, MajorFortune } from "../../types";
import type { LifetimeFrame, DaeunHighlight } from "../../core/extendedTypes";

/**
 * 맹파(盲派) 단건업(斷件業) 단순화 — v0.1 시드.
 *
 * 단건업 핵심은 일지(본인)·년지(가족/환경) 와 대운 지지의 충·합 시점을
 * "응기(應期, 사건 발생 시점)" 로 보는 것. 본격 단건업은 物象·宮位·체계가
 * 훨씬 복잡하지만 v0.1 은 "일지·년지 == 대운 지지" 단순 일치만 본다.
 *
 * TODO(v0.2): 맹파는 본래 용신 학파의 핵심이지만 v0.1 시드에서는 chart.yongSin
 * 매핑(Element → 학파별 reasoning)이 미정이라 undefined. compose 단계에서
 * yongshin 누락 시 silent gap 발생할 수 있으므로 우선 cautions 에 명시.
 */
export function buildLifetimeCnMangpai(chart: SajuChart, daeun: MajorFortune[]): LifetimeFrame {
  const dayBranch = chart.pillars.day.branch;
  const yearBranch = chart.pillars.year.branch;

  const eunggi = daeun
    .filter((d) => d.branch === dayBranch || d.branch === yearBranch)
    .map((d) => ({
      startAge: d.startAge,
      pillar: `${d.stem}${d.branch}`,
      target: d.branch === dayBranch ? "day" : "year",
      eventType: d.branch === dayBranch ? "본인 변화" : "가족·환경 변화",
      note: "맹파 단건업 단순화 — 일지·년지 일치 대운",
    }));

  const daeunHighlights: DaeunHighlight[] = eunggi.map((e) => ({
    startAge: e.startAge,
    pillar: e.target === "day" ? "day" : "year",
    significance: "변화",
    reason: `${e.pillar} — ${e.eventType}`,
  }));

  const gyeokguk = chart.pattern || "未확정";

  return {
    school: "cn-mangpai",
    pillarsAnnotated: [],
    formatGyeokguk: {
      name: "맹파는 격국 약화",
      reasoning: `物象 중심 — 사건성 매핑 우선 (참고 격국: ${gyeokguk})`,
    },
    yongshin: undefined,
    daeunHighlights,
    careerHints: ["직업 변화는 일지 충합 대운에 집중"],
    relationshipHints: ["배우자 = 일지. 일지 충 대운에 큰 변동"],
    healthHints: ["응기 시점에 건강 사건 가능"],
    cautions: [
      "응기는 확률적, 절대값 아님",
      "v0.1: 용신(yongshin) 미적용 — 맹파 본격 분석은 v0.2 이후",
    ],
    schoolSpecific: { eunggi, system: "단건업 단순화" },
  };
}
