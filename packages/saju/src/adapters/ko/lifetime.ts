import type { SajuChart } from "../../types";
import type { LifetimeFrame } from "../../core/extendedTypes";

export function buildLifetimeKo(chart: SajuChart): LifetimeFrame {
  const gyeokguk = chart.pattern || "未확정";

  return {
    school: "ko",
    pillarsAnnotated: [],
    formatGyeokguk: {
      name: gyeokguk,
      reasoning: `한국식 자평+조후 — 월지 기반 격국 ${gyeokguk}`,
    },
    yongshin: undefined,
    daeunHighlights: [],
    careerHints: ["연구·전략기획·교육·자영업"],
    relationshipHints: ["지적·깊이 있는 대화 통하는 파트너"],
    healthHints: ["봄 卯月 출생, 木旺·水강 — 신장·하체 순환 + 火土 보강"],
    cautions: ["신살: 괴강·도화 — 자존심 과·표현 직설 주의"],
    schoolSpecific: { method: "ko-jiPyeong-joHoo-shinSal" },
  };
}
