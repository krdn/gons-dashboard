import type { SajuChart, MajorFortune } from "../../types";
import type {
  LifetimeFrame,
  DaeunHighlight,
  TrueSolarMeta,
} from "../../core/extendedTypes";

/**
 * 맹파(盲派) 단건업(斷件業) 단순화 — v0.1 시드.
 *
 * 단건업 핵심은 일지(본인)·년지(가족/환경) 와 대운 지지의 충·합 시점을
 * "응기(應期, 사건 발생 시점)" 로 보는 것. 본격 단건업은 物象·宮位·체계가
 * 훨씬 복잡하지만 v0.1 은 "일지·년지 == 대운 지지" 단순 일치만 본다.
 *
 * NOTE(일지=년지 충돌): 일지와 년지가 같은 차트(예: 일지·년지 모두 卯)에서
 * 매칭 대운은 "본인 + 가족 변화" 동시 응기로 본다. v0.1 은 day/year 두 entry
 * 를 별도로 발행하여 두 trajectory 를 모두 노출. compose 단계에서 중복으로
 * 카운팅되지 않도록 주의.
 *
 * TODO(v0.2): 맹파는 본래 용신 학파의 핵심이지만 v0.1 시드에서는 chart.yongSin
 * 매핑(Element → 학파별 reasoning)이 미정이라 undefined. compose 단계에서
 * yongshin 누락 시 silent gap 발생할 수 있으므로 우선 cautions 에 명시.
 *
 * @param chart 본명 사주 차트.
 * @param ctx Phase 4 공통 시그니처 — `ctx.daeun` 으로 응기 계산. 누락 시 빈 배열로 폴백.
 */
export function buildLifetimeCnMangpai(
  chart: SajuChart,
  ctx?: { daeun?: MajorFortune[]; trueSolar?: TrueSolarMeta },
): LifetimeFrame {
  const dayBranch = chart.pillars.day.branch;
  const yearBranch = chart.pillars.year.branch;
  const daeun = ctx?.daeun ?? [];

  // 일지·년지 일치 대운을 응기로 매핑.
  // 일지 == 년지 인 경우 한 대운에서 day/year 두 entry 를 모두 발행 (본인+가족 동시 응기).
  const eunggi = daeun.flatMap((d) => {
    const matches: Array<{
      startAge: number;
      pillar: string;
      target: "day" | "year";
      eventType: string;
      note: string;
    }> = [];
    if (d.branch === dayBranch) {
      matches.push({
        startAge: d.startAge,
        pillar: `${d.stem}${d.branch}`,
        target: "day",
        eventType: "본인 변화",
        note: "맹파 단건업 단순화 — 일지 일치 대운",
      });
    }
    if (d.branch === yearBranch && yearBranch !== dayBranch) {
      // 일지 != 년지 인 정상 케이스: year 만 발행.
      matches.push({
        startAge: d.startAge,
        pillar: `${d.stem}${d.branch}`,
        target: "year",
        eventType: "가족·환경 변화",
        note: "맹파 단건업 단순화 — 년지 일치 대운",
      });
    } else if (d.branch === yearBranch && yearBranch === dayBranch) {
      // 일지 == 년지 충돌 케이스: day 는 이미 위에서 발행했으므로, year 도 발행 (총 2건).
      matches.push({
        startAge: d.startAge,
        pillar: `${d.stem}${d.branch}`,
        target: "year",
        eventType: "가족·환경 변화 (일지=년지 동시 응기)",
        note: "맹파 단건업 단순화 — 일지·년지 동일 대운 (본인+가족 동시 응기)",
      });
    }
    return matches;
  });

  const daeunHighlights: DaeunHighlight[] = eunggi.map((e) => ({
    startAge: e.startAge,
    pillar: e.target,
    significance: "변화",
    reason: `${e.pillar} — ${e.eventType}`,
  }));

  const gyeokguk = chart.pattern || "미확정";

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
