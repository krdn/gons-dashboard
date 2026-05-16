import type { SajuPillars, Stem, Branch } from "../types";

/**
 * 신살(神煞) — 사주의 길흉 보조 지표.
 * v0.1 은 핵심 3개만 구현: 괴강(魁罡), 천을귀인(天乙貴人), 도화(桃花).
 *
 * 출처 — 한국 정통 명리학 기준 (한국 비중 35% 가중치):
 * - 괴강: 일주 기준 (壬辰, 庚辰, 庚戌, 戊戌)
 * - 천을귀인: 일간 → 지지 매칭 (전체 사주 스캔)
 * - 도화: 년지 삼합국 패지 (子午卯酉 중 하나)
 */
export interface ShenshaEntry {
  name: "괴강" | "천을귀인" | "도화";            // 한글 명칭 (e.g. "괴강")
  hanja: string;           // 한자 명칭 (e.g. "魁罡")
  pillar: "year" | "month" | "day" | "hour";
  meaning: string;         // 짧은 의미 설명 (UI 노출용)
}

const GAEGANG_PAIRS: ReadonlyArray<{ stem: Stem; branch: Branch }> = [
  { stem: "壬", branch: "辰" },
  { stem: "庚", branch: "辰" },
  { stem: "庚", branch: "戌" },
  { stem: "戊", branch: "戌" },
];

const CHEONEUL_TABLE: Record<Stem, Branch[]> = {
  甲: ["丑", "未"], 乙: ["子", "申"], 丙: ["亥", "酉"], 丁: ["亥", "酉"],
  戊: ["丑", "未"], 己: ["子", "申"], 庚: ["丑", "未"], 辛: ["寅", "午"],
  壬: ["卯", "巳"], 癸: ["卯", "巳"],
};

// 도화살: 년지 삼합국의 패지 (목욕) 기준 — Korean 정통 명리학 표준 규칙.
// 申子辰→酉, 寅午戌→卯, 巳酉丑→午, 亥卯未→子.
const DOHWA_BY_YEAR_BRANCH: Record<Branch, Branch> = {
  申: "酉", 子: "酉", 辰: "酉",
  寅: "卯", 午: "卯", 戌: "卯",
  巳: "午", 酉: "午", 丑: "午",
  亥: "子", 卯: "子", 未: "子",
};

export function computeShensha(pillars: SajuPillars): ShenshaEntry[] {
  const result: ShenshaEntry[] = [];
  const dayStem = pillars.day.stem;
  const yearBranch = pillars.year.branch;

  // 1. 괴강 — 일주 검사
  if (GAEGANG_PAIRS.some((p) => p.stem === pillars.day.stem && p.branch === pillars.day.branch)) {
    result.push({
      name: "괴강", hanja: "魁罡", pillar: "day",
      meaning: "총명하고 의지 강함. 극단성 주의.",
    });
  }

  // 2. 천을귀인 — 일간 기준, 전체 사주 스캔
  const cheonEulBranches = CHEONEUL_TABLE[dayStem];
  (["year", "month", "day", "hour"] as const).forEach((p) => {
    const pillar = pillars[p];
    if (pillar && cheonEulBranches.includes(pillar.branch)) {
      result.push({
        name: "천을귀인", hanja: "天乙貴人", pillar: p,
        meaning: "귀인의 도움을 받음. 위기 시 조력자 출현.",
      });
    }
  });

  // 3. 도화 — 년지 기준, 일지/시지 매칭
  const dohwaBranch = DOHWA_BY_YEAR_BRANCH[yearBranch];
  if (pillars.day.branch === dohwaBranch) {
    result.push({
      name: "도화", hanja: "桃花", pillar: "day",
      meaning: "인기·매력 강함. 이성 관계 주의.",
    });
  }
  if (pillars.hour && pillars.hour.branch === dohwaBranch) {
    result.push({
      name: "도화", hanja: "桃花", pillar: "hour",
      meaning: "인기·매력 강함. 이성 관계 주의.",
    });
  }

  return result;
}
