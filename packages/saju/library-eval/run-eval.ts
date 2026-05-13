/**
 * 만세력 라이브러리 평가 — spec §11.
 * 3개 라이브러리에 골든 케이스 5종을 돌려 결과를 콘솔에 표로 출력.
 * 결과는 README.md에 수기로 옮긴다 (라이브러리 정확도 회귀 추적).
 *
 * ⚠️ 평가 완료(2026-05-13) 후 manseryeok, korean-lunar-calendar 는
 * package.json 에서 제거됨. 이 스크립트를 재실행하려면 임시로:
 *   pnpm --filter @gons/saju add -D manseryeok@1.0.1 korean-lunar-calendar@0.3.6
 * 평가 결과 자체는 README.md 에 기록되어 있으므로 일반적인 재실행은 불필요.
 */
interface GoldenCase {
  id: string;
  desc: string;
  birthDate: string; // YYYY-MM-DD
  birthTime: string | null; // HH:MM (24h) or null
  calendar: "solar" | "lunar";
  // 기대값 (어제 PlayMCP 분석 기준 — 사람이 검수해서 박은 값)
  expected: {
    year: { stem: string; branch: string };
    month: { stem: string; branch: string };
    day: { stem: string; branch: string };
    hour: { stem: string; branch: string } | null;
  };
}

const GOLDEN_CASES: GoldenCase[] = [
  {
    id: "G1",
    desc: "1967-03-29 05:30 양력 (사용자 본인)",
    birthDate: "1967-03-29",
    birthTime: "05:30",
    calendar: "solar",
    expected: {
      year: { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day: { stem: "丁", branch: "卯" },
      hour: { stem: "癸", branch: "卯" },
    },
  },
  {
    id: "G2",
    desc: "출생시 모름 — 1990-01-15 양력 (hour pillar null 허용 확인)",
    birthDate: "1990-01-15",
    birthTime: null,
    calendar: "solar",
    expected: {
      year: { stem: "己", branch: "巳" }, // 1989 절기 기준 (입춘 전이라 1989 사주 년)
      month: { stem: "丁", branch: "丑" },
      day: { stem: "癸", branch: "未" },
      hour: null,
    },
  },
  {
    id: "G3",
    desc: "절기 경계일 — 2024-02-04 입춘 당일 (라이브러리간 결과가 갈리는 지점)",
    birthDate: "2024-02-04",
    birthTime: "17:00",
    calendar: "solar",
    expected: {
      // 입춘 시각(16:27 KST) 이후라 갑진년·병인월
      year: { stem: "甲", branch: "辰" },
      month: { stem: "丙", branch: "寅" },
      day: { stem: "庚", branch: "戌" },
      hour: { stem: "乙", branch: "酉" },
    },
  },
  {
    id: "G4",
    desc: "윤달 — 2023-03-22 양력 (음력 윤2월 1일)",
    birthDate: "2023-03-22",
    birthTime: "12:00",
    calendar: "solar",
    expected: {
      year: { stem: "癸", branch: "卯" },
      month: { stem: "乙", branch: "卯" },
      day: { stem: "癸", branch: "丑" },
      hour: { stem: "戊", branch: "午" },
    },
  },
  {
    id: "G5",
    desc: "자정 직전 — 2000-01-01 23:59 양력 (일주/시주 경계)",
    birthDate: "2000-01-01",
    birthTime: "23:59",
    calendar: "solar",
    expected: {
      // 1999 입춘 후이므로 기묘년·병자월. 일주는 자정 전이라 23:30 부터 다음날 자시 적용 관습 따라 라이브러리별 결과 갈림
      year: { stem: "己", branch: "卯" },
      month: { stem: "丙", branch: "子" },
      day: { stem: "戊", branch: "申" },
      hour: { stem: "壬", branch: "子" },
    },
  },
];

type LibResult = {
  case: string;
  yearMatch: boolean;
  monthMatch: boolean;
  dayMatch: boolean;
  hourMatch: boolean;
  notes: string;
};

let shapeLogged = { manseryeok: false, kor: false, lunar: false };

async function runManseryeok(cs: GoldenCase): Promise<LibResult> {
  try {
    const mod: any = await import("manseryeok");
    if (!shapeLogged.manseryeok) {
      console.error("[shape] manseryeok keys:", Object.keys(mod));
      console.error("[shape] manseryeok.calculateFourPillars type:", typeof mod.calculateFourPillars);
      console.error(
        "[shape] manseryeok.calculateFourPillars length:",
        mod.calculateFourPillars?.length
      );
      try {
        const probe = mod.calculateFourPillars(1967, 3, 29, 5, 30);
        console.error("[shape] manseryeok sample result for 1967-03-29 05:30:", JSON.stringify(probe).slice(0, 400));
      } catch (e) {
        console.error("[shape] manseryeok probe call failed:", (e as Error).message);
      }
      shapeLogged.manseryeok = true;
    }
    const calc = mod.calculateFourPillars;
    if (typeof calc !== "function") {
      return {
        case: cs.id,
        yearMatch: false,
        monthMatch: false,
        dayMatch: false,
        hourMatch: false,
        notes: "manseryeok: calculateFourPillars not a function",
      };
    }
    const [y, m, d] = cs.birthDate.split("-").map(Number);
    const [hh, mm] = (cs.birthTime ?? "12:00").split(":").map(Number);
    const r: any = calc(y, m, d, hh, mm);
    // r 형태 추정 — { year, month, day, hour } 각각 { heavenlyStem, earthlyBranch } 등
    const extract = (p: any): { stem: string; branch: string } | null => {
      if (!p) return null;
      // 후보 키 — heavenlyStem/stem/gan, earthlyBranch/branch/zhi
      const stem =
        p.heavenlyStem ?? p.heavenly ?? p.stem ?? p.gan ?? p.Stem ?? p.heaven;
      const branch =
        p.earthlyBranch ?? p.earthly ?? p.branch ?? p.zhi ?? p.Branch ?? p.earth;
      if (typeof stem === "string" && typeof branch === "string") {
        // hangul → hanja 변환은 compareResult에서
        return { stem, branch };
      }
      // 혹은 string 직접
      if (typeof p === "string" && p.length >= 2) {
        return { stem: p[0], branch: p[1] };
      }
      return null;
    };
    const result = {
      year: extract(r.year ?? r.yearPillar),
      month: extract(r.month ?? r.monthPillar),
      day: extract(r.day ?? r.dayPillar),
      hour: cs.birthTime ? extract(r.hour ?? r.hourPillar) : null,
    };
    return compareResult("manseryeok", cs, result);
  } catch (e) {
    return {
      case: cs.id,
      yearMatch: false,
      monthMatch: false,
      dayMatch: false,
      hourMatch: false,
      notes: `error: ${(e as Error).message}`,
    };
  }
}

async function runKoreanLunarCalendar(cs: GoldenCase): Promise<LibResult> {
  try {
    const klcMod: any = await import("korean-lunar-calendar");
    if (!shapeLogged.kor) {
      console.error("[shape] korean-lunar-calendar keys:", Object.keys(klcMod));
      const def = klcMod.default;
      if (def) {
        console.error("[shape] klc.default type:", typeof def);
        console.error("[shape] klc.default keys:", Object.keys(def).slice(0, 20));
        if (typeof def === "function") {
          try {
            const inst = new def();
            const proto = Object.getPrototypeOf(inst);
            console.error("[shape] klc instance proto keys:", Object.getOwnPropertyNames(proto));
          } catch (e) {
            console.error("[shape] klc default could not be constructed as class:", (e as Error).message);
          }
        }
      }
      shapeLogged.kor = true;
    }
    const KoreanLunarCalendar: any = klcMod.default ?? klcMod;
    const cal = new KoreanLunarCalendar();
    const [y, m, d] = cs.birthDate.split("-").map(Number);
    cal.setSolarDate(y, m, d);
    // 한자 갑자: getChineseGapja() → "丁未 癸卯 壬辰"
    const gz =
      typeof cal.getChineseGapja === "function"
        ? cal.getChineseGapja()
        : typeof cal.getKoreanGapja === "function"
          ? cal.getKoreanGapja()
          : typeof cal.getGapja === "function"
            ? cal.getGapja()
            : null;
    if (!shapeLogged.kor || cs.id === "G1") {
      console.error(`[shape] klc ${cs.id} raw gapja:`, JSON.stringify(gz));
    }
    let parsed: any = null;
    if (typeof gz === "string") {
      // 한자만 추출 (CJK Unified Ideographs)
      const hanjas = gz.match(/[一-鿿]{2}/g) ?? [];
      if (hanjas.length >= 3) {
        parsed = {
          year: { stem: hanjas[0][0], branch: hanjas[0][1] },
          month: { stem: hanjas[1][0], branch: hanjas[1][1] },
          day: { stem: hanjas[2][0], branch: hanjas[2][1] },
          hour: hanjas.length >= 4 ? { stem: hanjas[3][0], branch: hanjas[3][1] } : null,
        };
      }
    } else if (gz && typeof gz === "object") {
      const extract = (v: any) => {
        if (!v) return null;
        if (typeof v === "string" && v.length >= 2) return { stem: v[0], branch: v[1] };
        if (v.stem && v.branch) return { stem: v.stem, branch: v.branch };
        return null;
      };
      parsed = {
        year: extract(gz.year),
        month: extract(gz.month),
        day: extract(gz.day),
        hour: null,
      };
    }
    return compareResult("korean-lunar-calendar", cs, parsed);
  } catch (e) {
    return {
      case: cs.id,
      yearMatch: false,
      monthMatch: false,
      dayMatch: false,
      hourMatch: false,
      notes: `error: ${(e as Error).message}`,
    };
  }
}

async function runLunarJavascript(cs: GoldenCase): Promise<LibResult> {
  try {
    const lunarMod: any = await import("lunar-javascript");
    if (!shapeLogged.lunar) {
      console.error("[shape] lunar-javascript top keys:", Object.keys(lunarMod).slice(0, 20));
      shapeLogged.lunar = true;
    }
    const Solar = lunarMod.Solar ?? lunarMod.default?.Solar;
    const [y, m, d] = cs.birthDate.split("-").map(Number);
    const [hh, mm] = (cs.birthTime ?? "12:00").split(":").map(Number);
    const solar = Solar.fromYmdHms(y, m, d, hh, mm, 0);
    const eightChar = solar.getLunar().getEightChar();
    const result = {
      year: { stem: eightChar.getYearGan(), branch: eightChar.getYearZhi() },
      month: { stem: eightChar.getMonthGan(), branch: eightChar.getMonthZhi() },
      day: { stem: eightChar.getDayGan(), branch: eightChar.getDayZhi() },
      hour: cs.birthTime
        ? { stem: eightChar.getTimeGan(), branch: eightChar.getTimeZhi() }
        : null,
    };
    return compareResult("lunar-javascript", cs, result);
  } catch (e) {
    return {
      case: cs.id,
      yearMatch: false,
      monthMatch: false,
      dayMatch: false,
      hourMatch: false,
      notes: `error: ${(e as Error).message}`,
    };
  }
}

function compareResult(libName: string, cs: GoldenCase, actual: any): LibResult {
  if (!actual)
    return {
      case: cs.id,
      yearMatch: false,
      monthMatch: false,
      dayMatch: false,
      hourMatch: false,
      notes: `${libName}: null result`,
    };
  const ym =
    actual.year?.stem === cs.expected.year.stem &&
    actual.year?.branch === cs.expected.year.branch;
  const mm =
    actual.month?.stem === cs.expected.month.stem &&
    actual.month?.branch === cs.expected.month.branch;
  const dm =
    actual.day?.stem === cs.expected.day.stem &&
    actual.day?.branch === cs.expected.day.branch;
  const hm =
    cs.expected.hour === null
      ? actual.hour === null
      : actual.hour?.stem === cs.expected.hour.stem &&
        actual.hour?.branch === cs.expected.hour.branch;
  const notes = `${libName}: Y=${actual.year?.stem ?? "?"}${actual.year?.branch ?? "?"} M=${actual.month?.stem ?? "?"}${actual.month?.branch ?? "?"} D=${actual.day?.stem ?? "?"}${actual.day?.branch ?? "?"} H=${actual.hour ? actual.hour.stem + actual.hour.branch : "-"}`;
  return {
    case: cs.id,
    yearMatch: ym,
    monthMatch: mm,
    dayMatch: dm,
    hourMatch: hm,
    notes,
  };
}

async function main() {
  const rows: Array<{ lib: string; result: LibResult }> = [];
  for (const cs of GOLDEN_CASES) {
    rows.push({ lib: "manseryeok", result: await runManseryeok(cs) });
    rows.push({ lib: "korean-lunar-calendar", result: await runKoreanLunarCalendar(cs) });
    rows.push({ lib: "lunar-javascript", result: await runLunarJavascript(cs) });
  }
  console.log("library | case | Y | M | D | H | notes");
  console.log("---|---|---|---|---|---|---");
  for (const r of rows) {
    const score = `${r.result.yearMatch ? "Y" : "-"} | ${r.result.monthMatch ? "Y" : "-"} | ${r.result.dayMatch ? "Y" : "-"} | ${r.result.hourMatch ? "Y" : "-"}`;
    console.log(`${r.lib} | ${r.result.case} | ${score} | ${r.result.notes}`);
  }

  // 라이브러리별 합산 점수
  console.log("\n=== 합산 점수 (Y+M+D+H, 라이브러리별 / 20점 만점) ===");
  for (const libName of ["manseryeok", "korean-lunar-calendar", "lunar-javascript"]) {
    const libRows = rows.filter((r) => r.lib === libName);
    let score = 0;
    for (const r of libRows) {
      if (r.result.yearMatch) score++;
      if (r.result.monthMatch) score++;
      if (r.result.dayMatch) score++;
      if (r.result.hourMatch) score++;
    }
    console.log(`  ${libName}: ${score}/20`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
