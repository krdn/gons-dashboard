export const STEMS = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"] as const;
export type Stem = (typeof STEMS)[number];

export const BRANCHES = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"] as const;
export type Branch = (typeof BRANCHES)[number];

export const STEM_KO: Record<Stem, string> = {
  甲:"갑", 乙:"을", 丙:"병", 丁:"정", 戊:"무", 己:"기", 庚:"경", 辛:"신", 壬:"임", 癸:"계",
};
export const BRANCH_KO: Record<Branch, string> = {
  子:"자", 丑:"축", 寅:"인", 卯:"묘", 辰:"진", 巳:"사", 午:"오",
  未:"미", 申:"신", 酉:"유", 戌:"술", 亥:"해",
};

export type Element = "wood" | "fire" | "earth" | "metal" | "water";
export const ELEMENT_KO: Record<Element, string> = {
  wood:"목(木)", fire:"화(火)", earth:"토(土)", metal:"금(金)", water:"수(水)",
};
export const ELEMENT_HANJA: Record<Element, string> = {
  wood:"木", fire:"火", earth:"土", metal:"金", water:"水",
};

// 천간 → 오행 + 음양
export const STEM_ELEMENT: Record<Stem, Element> = {
  甲:"wood", 乙:"wood", 丙:"fire", 丁:"fire", 戊:"earth",
  己:"earth", 庚:"metal", 辛:"metal", 壬:"water", 癸:"water",
};
export const STEM_YIN_YANG: Record<Stem, "yang" | "yin"> = {
  甲:"yang", 乙:"yin", 丙:"yang", 丁:"yin", 戊:"yang",
  己:"yin", 庚:"yang", 辛:"yin", 壬:"yang", 癸:"yin",
};

// 지지 → 오행 + 본기 천간(지장간 주성분)
export const BRANCH_ELEMENT: Record<Branch, Element> = {
  子:"water", 丑:"earth", 寅:"wood", 卯:"wood", 辰:"earth", 巳:"fire",
  午:"fire", 未:"earth", 申:"metal", 酉:"metal", 戌:"earth", 亥:"water",
};
export const BRANCH_MAIN_STEM: Record<Branch, Stem> = {
  子:"癸", 丑:"己", 寅:"甲", 卯:"乙", 辰:"戊", 巳:"丙",
  午:"丁", 未:"己", 申:"庚", 酉:"辛", 戌:"戊", 亥:"壬",
};

// 십신 라벨 (일간 vs 타글자)
export type TenGod =
  | "比肩" | "劫財" | "食神" | "傷官"
  | "偏財" | "正財" | "偏官" | "正官"
  | "偏印" | "正印";
export const TEN_GOD_KO: Record<TenGod, string> = {
  比肩:"비견", 劫財:"겁재", 食神:"식신", 傷官:"상관",
  偏財:"편재", 正財:"정재", 偏官:"편관", 正官:"정관",
  偏印:"편인", 正印:"정인",
};
