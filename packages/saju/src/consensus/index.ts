import { Solar } from "lunar-javascript";
import KoreanLunarCalendar from "korean-lunar-calendar";

/**
 * 만세력 합의 검증 — lunar-javascript 와 korean-lunar-calendar 두 라이브러리가
 * 동일한 일주를 반환하는지 비교한다. 라이브러리 업데이트로 인한 silent regression
 * 을 막기 위한 안전장치.
 */
export interface ConsensusInput {
  /** "YYYY-MM-DD" (local date) */
  birthDateLocal: string;
  /** 현재는 solar 만 지원. lunar 은 추후 확장. */
  calendar: "solar" | "lunar";
}

export type ConsensusResult =
  | { ok: true; dayPillar: { stem: string; branch: string } }
  | {
      ok: false;
      libA: { stem: string; branch: string };
      libB: { stem: string; branch: string };
    };

/**
 * 두 만세력 라이브러리가 동일 일자에 대해 같은 일주를 반환하는지 검증.
 * - libA: lunar-javascript (`Solar → Lunar → EightChar.getDayGan/Zhi`)
 * - libB: korean-lunar-calendar (`getChineseGapja().day`, e.g. "壬辰日")
 */
export function verifyConsensus(input: ConsensusInput): ConsensusResult {
  if (input.calendar !== "solar") {
    throw new Error("lunar input not yet supported");
  }

  const [y, m, d] = input.birthDateLocal.split("-").map(Number);

  // libA — lunar-javascript
  const ec = Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getEightChar();
  const libA = {
    stem: ec.getDayGan() as string,
    branch: ec.getDayZhi() as string,
  };

  // libB — korean-lunar-calendar
  const klc = new KoreanLunarCalendar();
  const valid = klc.setSolarDate(y, m, d);
  if (!valid) {
    throw new Error(`korean-lunar-calendar: invalid date ${input.birthDateLocal}`);
  }
  const dayStr = klc.getChineseGapja().day; // 예: "壬辰日"
  const libB = {
    stem: dayStr.charAt(0),
    branch: dayStr.charAt(1),
  };

  if (libA.stem === libB.stem && libA.branch === libB.branch) {
    return { ok: true, dayPillar: libA };
  }
  return { ok: false, libA, libB };
}
