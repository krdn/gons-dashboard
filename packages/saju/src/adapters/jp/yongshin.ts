import type { SajuChart } from "../../types";
import type { JpYongshin } from "../../types/yongshin";

/**
 * 일본 추명학 — 阿部泰山 12궁 통변성 우선순위.
 *
 * 룰: 통변성 5종 (비겁/식상/재성/관성/인성) 중 처세에 유리/불리한 통변성을
 * 분리. v0.2 는 일간 무관 기본 우선순위 사용 (재성·관성·인성 favorable /
 * 식상·비겁 unfavorable).
 *
 * v0.3 에서 일간별 12궁 위치 (생/욕/대/관/왕/쇠/병/사/묘/절/태/양) 별 미세
 * 조정 도입 예정.
 */
export function buildYongshinJp(_chart: SajuChart): JpYongshin {
  return {
    school: "jp",
    favorable: ["재성", "관성", "인성"],
    unfavorable: ["식상", "비겁"],
  };
}
