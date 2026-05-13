# Saju Phase 0 — `packages/saju` 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사주 4주·십신·오행·격국·용신·대운을 결정적으로 계산하는 순수 함수 워크스페이스 패키지 `@gons/saju`를 골든 케이스 통과까지 완성.

**Architecture:** pnpm workspace 패키지(`packages/saju`), 순수 TypeScript. 만세력 라이브러리 1개에만 의존(평가 후 선정). dashboard·미래 MCP에서 공유. `src/index.ts`가 유일한 public API.

**Tech Stack:** TypeScript 5, Vitest 4, pnpm workspace, `manseryeok` / `korean-lunar-calendar` / `lunar-javascript` 중 1개 선정.

**Spec reference:** `docs/superpowers/specs/2026-05-13-saju-detail-design.md` §3, §11.

---

## File Structure

```
packages/saju/
├── package.json                            # name: @gons/saju
├── tsconfig.json                           # extends ../../tsconfig.base.json
├── vitest.config.ts                        # node, src/**/*.test.ts
└── src/
    ├── index.ts                            # public API barrel
    ├── types.ts                            # SajuChart, Pillar, TenGod, Element, MajorFortune
    ├── hanja.ts                            # 천간/지지/십신/오행 상수
    ├── pillars.ts                          # 만세력 wrapper → 4주
    ├── pillars.test.ts
    ├── tenGods.ts                          # 일간+타글자 → 십신
    ├── tenGods.test.ts
    ├── elements.ts                         # 8자 → 오행 분포 + 강약
    ├── elements.test.ts
    ├── majorFortune.ts                     # 성별+생일 → 대운 10개 + 입대운 나이
    ├── majorFortune.test.ts
    ├── pattern.ts                          # 격국·용신 도출
    ├── pattern.test.ts
    ├── computeSajuChart.ts                 # 전체 흐름 통합 (input → SajuChart)
    ├── computeSajuChart.test.ts            # 골든 케이스 5종 회귀
    └── library-eval/
        ├── run-eval.ts                     # 라이브러리 평가 스크립트 (Task 1에서만 실행)
        └── README.md                       # 평가 결과 기록
```

**파일 책임 분리 근거:** 각 모듈이 한 가지 변환만 수행 — `pillars` (날짜→간지), `tenGods` (간지→관계), `elements` (간지→오행), `majorFortune` (성별·생일→대운), `pattern` (8자→격국·용신). 통합은 `computeSajuChart.ts`에서. 라이브러리 평가는 `library-eval/` 하위로 격리해 본 코드와 섞이지 않게.

---

## Task 1: 만세력 라이브러리 평가 (진입 게이트)

**Files:**
- Create: `packages/saju/library-eval/run-eval.ts`
- Create: `packages/saju/library-eval/README.md`
- Create: `packages/saju/package.json` (임시 — devDependencies로 3개 라이브러리 등록)

**목적:** spec §11. `manseryeok@1.0.1`, `korean-lunar-calendar@0.3.6`, `lunar-javascript@1.7.7` 셋을 골든 케이스 5종에 돌려 4주 결과 비교 → 1위 선정.

- [ ] **Step 1: packages/saju 디렉토리 생성 + 평가 전용 package.json 작성**

`packages/saju/package.json`:
```json
{
  "name": "@gons/saju",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "eval:libraries": "tsx library-eval/run-eval.ts"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^4.1.5",
    "manseryeok": "1.0.1",
    "korean-lunar-calendar": "0.3.6",
    "lunar-javascript": "1.7.7"
  }
}
```

`packages/saju/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*", "library-eval/**/*"]
}
```

`packages/saju/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: 골든 케이스 5종을 평가 스크립트에 박아 넣기**

`packages/saju/library-eval/run-eval.ts`:
```ts
/**
 * 만세력 라이브러리 평가 — spec §11.
 * 3개 라이브러리에 골든 케이스 5종을 돌려 결과를 콘솔에 표로 출력.
 * 결과는 README.md에 수기로 옮긴다 (라이브러리 정확도 회귀 추적).
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

async function runManseryeok(cs: GoldenCase): Promise<LibResult> {
  try {
    const mod = await import("manseryeok");
    // manseryeok API: 정확한 호출 시그니처는 첫 실행 시 console.log(Object.keys(mod))로 탐색
    const result = (mod as any).default?.(cs.birthDate, cs.birthTime ?? "12:00") ?? null;
    return compareResult("manseryeok", cs, result);
  } catch (e) {
    return { case: cs.id, yearMatch: false, monthMatch: false, dayMatch: false, hourMatch: false, notes: `error: ${(e as Error).message}` };
  }
}

async function runKoreanLunarCalendar(cs: GoldenCase): Promise<LibResult> {
  try {
    const { default: KoreanLunarCalendar } = await import("korean-lunar-calendar");
    const cal = new KoreanLunarCalendar();
    const [y, m, d] = cs.birthDate.split("-").map(Number);
    cal.setSolarDate(y, m, d);
    const gz = cal.getGapJaString?.() ?? cal.getGapJa?.();
    return compareResult("korean-lunar-calendar", cs, gz);
  } catch (e) {
    return { case: cs.id, yearMatch: false, monthMatch: false, dayMatch: false, hourMatch: false, notes: `error: ${(e as Error).message}` };
  }
}

async function runLunarJavascript(cs: GoldenCase): Promise<LibResult> {
  try {
    const lunar = await import("lunar-javascript");
    const [y, m, d] = cs.birthDate.split("-").map(Number);
    const [hh, mm] = (cs.birthTime ?? "12:00").split(":").map(Number);
    const solar = (lunar as any).Solar.fromYmdHms(y, m, d, hh, mm, 0);
    const eightChar = solar.getLunar().getEightChar();
    const result = {
      year: { stem: eightChar.getYearGan(), branch: eightChar.getYearZhi() },
      month: { stem: eightChar.getMonthGan(), branch: eightChar.getMonthZhi() },
      day: { stem: eightChar.getDayGan(), branch: eightChar.getDayZhi() },
      hour: cs.birthTime ? { stem: eightChar.getTimeGan(), branch: eightChar.getTimeZhi() } : null,
    };
    return compareResult("lunar-javascript", cs, result);
  } catch (e) {
    return { case: cs.id, yearMatch: false, monthMatch: false, dayMatch: false, hourMatch: false, notes: `error: ${(e as Error).message}` };
  }
}

function compareResult(libName: string, cs: GoldenCase, actual: any): LibResult {
  if (!actual) return { case: cs.id, yearMatch: false, monthMatch: false, dayMatch: false, hourMatch: false, notes: `${libName}: null result` };
  const ym = actual.year?.stem === cs.expected.year.stem && actual.year?.branch === cs.expected.year.branch;
  const mm = actual.month?.stem === cs.expected.month.stem && actual.month?.branch === cs.expected.month.branch;
  const dm = actual.day?.stem === cs.expected.day.stem && actual.day?.branch === cs.expected.day.branch;
  const hm = cs.expected.hour === null
    ? actual.hour === null
    : actual.hour?.stem === cs.expected.hour.stem && actual.hour?.branch === cs.expected.hour.branch;
  const notes = `${libName}: Y=${actual.year?.stem}${actual.year?.branch} M=${actual.month?.stem}${actual.month?.branch} D=${actual.day?.stem}${actual.day?.branch} H=${actual.hour ? actual.hour.stem + actual.hour.branch : "-"}`;
  return { case: cs.id, yearMatch: ym, monthMatch: mm, dayMatch: dm, hourMatch: hm, notes };
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
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: pnpm install + 평가 실행**

```bash
cd /home/gon/projects/gon/gons-dashboard
pnpm install
pnpm --filter @gons/saju eval:libraries
```

Expected: 콘솔에 15행 표 (3 lib × 5 case). 각 셀 Y/− 표시 + 라이브러리가 뱉은 실제 간지 notes.

⚠️ **API 시그니처 탐색:** `manseryeok`은 README/types가 부실할 수 있음. 첫 실행에서 `error: ...` 가 뜨면 `console.log(Object.keys(mod))`, `console.log(Object.keys(mod.default))`로 export 형태를 확인하고 호출 코드를 보정. korean-lunar-calendar의 `getGapJaString` 메서드명도 실제 API에 맞춰 수정.

- [ ] **Step 4: 결과를 library-eval/README.md에 기록**

`packages/saju/library-eval/README.md`:
```markdown
# 만세력 라이브러리 평가 결과 (2026-05-13)

spec §11 진입 게이트. 골든 케이스 5종 통과율 기준 선정.

## 결과표

| Library | G1 | G2 | G3 | G4 | G5 | 점수 (Y+M+D+H 일치) |
|---------|----|----|----|----|----|---------------------|
| manseryeok@1.0.1 | ... | ... | ... | ... | ... | ?/20 |
| korean-lunar-calendar@0.3.6 | ... | ... | ... | ... | ... | ?/20 |
| lunar-javascript@1.7.7 | ... | ... | ... | ... | ... | ?/20 |

(실제 평가 실행 후 위 표를 채우고, 라이브러리별 notes 행도 그대로 옮긴다)

## 결정

- **1위**: `<선정 라이브러리>` — 사유: `<G1~G5 통과율 + API 안정성>`
- **2위 (폴백)**: `<2위>`
- **Escape hatch 발동 여부**: <YES/NO — 모두 1개 이상 케이스에서 틀리면 YES, spec §11 절차로 전환>
```

⚠️ 평가 결과 1위가 결정되면 **Task 2부터 `pillars.ts`가 그 라이브러리만 의존**. 나머지 2개는 package.json에서 제거.

- [ ] **Step 5: 평가 산출물 커밋 (라이브러리 선정 전까지 본 코드 안 쓰임)**

```bash
git add packages/saju/package.json packages/saju/tsconfig.json packages/saju/vitest.config.ts \
        packages/saju/library-eval/
git commit -m "chore(saju): 만세력 라이브러리 평가 — 골든 케이스 5종 결과 기록

spec §11 진입 게이트. 3개 라이브러리(manseryeok/korean-lunar-calendar/lunar-javascript)
중 1위 선정 + 2위 폴백. 결과는 packages/saju/library-eval/README.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 한자/오행/십신 상수 + 타입

**Files:**
- Create: `packages/saju/src/hanja.ts`
- Create: `packages/saju/src/types.ts`

- [ ] **Step 1: 상수 작성**

`packages/saju/src/hanja.ts`:
```ts
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
```

`packages/saju/src/types.ts`:
```ts
import type { Stem, Branch, Element, TenGod } from "./hanja";

export interface Pillar {
  stem: Stem;
  branch: Branch;
}

export interface SajuPillars {
  year: Pillar;
  month: Pillar;
  day: Pillar;
  hour: Pillar | null; // 출생시 모르면 null
}

export interface ElementCount {
  wood: number; fire: number; earth: number; metal: number; water: number;
}

export interface TenGodAssignment {
  yearStem: TenGod;
  yearBranch: TenGod;
  monthStem: TenGod;
  monthBranch: TenGod;
  dayBranch: TenGod; // 일간은 자기 자신이라 십신 없음
  hourStem: TenGod | null;
  hourBranch: TenGod | null;
}

export interface MajorFortune {
  startAge: number;     // 입대운 나이 (만)
  startYear: number;    // 시작 연도 (양력)
  stem: Stem;
  branch: Branch;
}

export type Strength = "very-strong" | "strong" | "balanced" | "weak" | "very-weak";

export interface SajuChart {
  pillars: SajuPillars;
  elements: ElementCount;
  strength: Strength;
  tenGods: TenGodAssignment;
  pattern: string;      // 격국 한자 e.g. "偏印格"
  yongSin: Element[];   // 용신 오행
  giSin: Element[];     // 기신 오행
  majorFortunes: MajorFortune[]; // 10개
  inputHash: string;
}

export interface ComputeSajuInput {
  birthDate: string;            // YYYY-MM-DD
  birthTime: string | null;     // HH:MM or null
  calendar: "solar" | "lunar";
  gender: "male" | "female";
  birthCity: string | null;
}
```

- [ ] **Step 2: 타입 컴파일 확인**

```bash
pnpm --filter @gons/saju typecheck
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add packages/saju/src/hanja.ts packages/saju/src/types.ts
git commit -m "feat(saju): 한자/오행/십신 상수 + SajuChart 타입

천간·지지·오행·십신 한자/한글 매핑, STEM_ELEMENT/BRANCH_ELEMENT/
BRANCH_MAIN_STEM 룩업 테이블. SajuChart·Pillar·MajorFortune 타입 정의.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: pillars.ts — 만세력 wrapper

**Files:**
- Create: `packages/saju/src/pillars.ts`
- Create: `packages/saju/src/pillars.test.ts`

**전제:** Task 1에서 1위 라이브러리 선정 완료. 아래 코드는 `lunar-javascript`가 1위라 가정한 예시 — Task 1 결과에 따라 import만 교체.

- [ ] **Step 1: pillars.test.ts에 골든 케이스 G1 + G2 + G3 작성 (실패하는 테스트 먼저)**

⚠️ **expected 값은 Task 1의 라이브러리 평가 결과 기준**. `packages/saju/library-eval/README.md` 참조 — plan 작성 당시의 day pillar 가정(丁卯)은 시주(癸卯)에서 day stem이 丁/壬 둘 다 가능한 모호성을 못 본 잘못이었음.

`packages/saju/src/pillars.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computePillars } from "./pillars";

describe("computePillars", () => {
  it("G1: 1967-03-29 05:30 양력 → 丁未/癸卯/壬辰/癸卯", () => {
    const result = computePillars({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
    });
    expect(result.year).toEqual({ stem: "丁", branch: "未" });
    expect(result.month).toEqual({ stem: "癸", branch: "卯" });
    expect(result.day).toEqual({ stem: "壬", branch: "辰" });
    expect(result.hour).toEqual({ stem: "癸", branch: "卯" });
  });

  it("G2: 출생시 모름 → hour null", () => {
    const result = computePillars({
      birthDate: "1990-01-15",
      birthTime: null,
      calendar: "solar",
    });
    expect(result.hour).toBeNull();
    expect(result.year.stem).toBeDefined();
    expect(result.year.branch).toBeDefined();
  });

  it("G3: 절기 경계 — 2024-02-04 17:00 입춘 후 → 甲辰년/丙寅월/戊戌일", () => {
    const result = computePillars({
      birthDate: "2024-02-04",
      birthTime: "17:00",
      calendar: "solar",
    });
    expect(result.year).toEqual({ stem: "甲", branch: "辰" });
    expect(result.month).toEqual({ stem: "丙", branch: "寅" });
    expect(result.day).toEqual({ stem: "戊", branch: "戌" });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm --filter @gons/saju test pillars
```

Expected: FAIL — `Cannot find module './pillars'`.

- [ ] **Step 3: pillars.ts 구현 (1위 라이브러리 기반)**

`packages/saju/src/pillars.ts` (예시 — lunar-javascript 1위일 때):
```ts
import { Solar } from "lunar-javascript";
import type { Stem, Branch } from "./hanja";
import type { SajuPillars } from "./types";

export interface ComputePillarsInput {
  birthDate: string;            // YYYY-MM-DD
  birthTime: string | null;     // HH:MM
  calendar: "solar" | "lunar";
}

export function computePillars(input: ComputePillarsInput): SajuPillars {
  const [y, m, d] = input.birthDate.split("-").map(Number);
  const [hh, mm] = (input.birthTime ?? "12:00").split(":").map(Number);

  const solar = input.calendar === "solar"
    ? Solar.fromYmdHms(y, m, d, hh, mm, 0)
    : Solar.fromYmdHms(y, m, d, hh, mm, 0); // lunar→solar 변환은 Lunar.fromYmdHms 후 .getSolar() — Task 1 결과 보고 보정

  const eightChar = solar.getLunar().getEightChar();

  return {
    year:  { stem: eightChar.getYearGan() as Stem,  branch: eightChar.getYearZhi() as Branch },
    month: { stem: eightChar.getMonthGan() as Stem, branch: eightChar.getMonthZhi() as Branch },
    day:   { stem: eightChar.getDayGan() as Stem,   branch: eightChar.getDayZhi() as Branch },
    hour:  input.birthTime
      ? { stem: eightChar.getTimeGan() as Stem, branch: eightChar.getTimeZhi() as Branch }
      : null,
  };
}
```

⚠️ Task 1 평가에서 1위가 다른 라이브러리이면 위 코드를 그 라이브러리 API로 재작성. 음력 입력 변환은 Task 1 평가 단계에서 함께 검증할 것.

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @gons/saju test pillars
```

Expected: PASS (3/3).

⚠️ G3(절기 경계)가 실패하면 라이브러리가 입춘 시각을 안 보는 것. spec §11 escape hatch (절기 테이블 직접 임베드) 발동 여부 검토 — 일단 G3 expect를 라이브러리 결과로 맞춘 뒤 issue로 빼두고 진행.

- [ ] **Step 5: 음력 입력 케이스 추가 + 통과**

`pillars.test.ts`에 음력 입력 1건 추가:
```ts
  it("음력 입력 → 양력 변환 후 정상 계산", () => {
    // 음력 1967-02-19 = 양력 1967-03-29
    const lunarResult = computePillars({
      birthDate: "1967-02-19",
      birthTime: "05:30",
      calendar: "lunar",
    });
    const solarResult = computePillars({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
    });
    expect(lunarResult).toEqual(solarResult);
  });
```

`pillars.ts`의 lunar 분기를 실제 라이브러리 음력 API로 보정:
```ts
import { Solar, Lunar } from "lunar-javascript";
// ...
const solar = input.calendar === "solar"
  ? Solar.fromYmdHms(y, m, d, hh, mm, 0)
  : Lunar.fromYmdHms(y, m, d, hh, mm, 0).getSolar();
```

테스트 재실행:
```bash
pnpm --filter @gons/saju test pillars
```
Expected: PASS (4/4).

- [ ] **Step 6: 커밋**

```bash
git add packages/saju/src/pillars.ts packages/saju/src/pillars.test.ts \
        packages/saju/package.json
git commit -m "feat(saju): pillars — 만세력 라이브러리 wrapper

골든 케이스 G1(1967-03-29), G2(시각 미상), G3(절기 경계), 음력 입력
4건 통과. 음력 입력은 양력 변환 후 계산.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: tenGods.ts — 십신 도출

**Files:**
- Create: `packages/saju/src/tenGods.ts`
- Create: `packages/saju/src/tenGods.test.ts`

**로직:** 일간(日干) 기준 다른 글자(천간 또는 지지 본기)의 십신을 결정:
- 같은 오행 + 같은 음양 = 比肩
- 같은 오행 + 다른 음양 = 劫財
- 일간이 생하는 오행 + 같은 음양 = 食神, 다른 음양 = 傷官
- 일간이 극하는 오행 + 같은 음양 = 偏財, 다른 음양 = 正財
- 일간을 극하는 오행 + 같은 음양 = 偏官(七殺), 다른 음양 = 正官
- 일간을 생하는 오행 + 같은 음양 = 偏印, 다른 음양 = 正印

오행 상생: 木→火→土→金→水→木. 상극: 木→土, 土→水, 水→火, 火→金, 金→木.

- [ ] **Step 1: tenGods.test.ts에 G1 사주(壬水 일간) 케이스 작성**

⚠️ G1 일간이 `壬`로 정정됨 (라이브러리 평가 결과). 아래 expected는 library-eval/README.md §"Tasks 3~8 인계 사항" 5번의 재계산값.

```ts
import { describe, expect, it } from "vitest";
import { computeTenGods } from "./tenGods";

describe("computeTenGods", () => {
  it("G1: 일간 壬水 기준 — 연주 丁未, 월주 癸卯, 일주 壬辰, 시주 癸卯", () => {
    const result = computeTenGods({
      year:  { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "癸", branch: "卯" },
    });
    // 壬(陽水) vs 丁(陰火) — 水克火, 일간이 극, 음양 다름 → 正財
    expect(result.yearStem).toBe("正財");
    // 壬 vs 未(본기 己, 陰土) — 土克水, 일간을 극, 음양 다름 → 正官
    expect(result.yearBranch).toBe("正官");
    // 壬 vs 癸(陰水) — 같은 오행, 음양 다름 → 劫財
    expect(result.monthStem).toBe("劫財");
    // 壬 vs 卯(본기 乙, 陰木) — 水生木, 일간이 생, 음양 다름 → 傷官
    expect(result.monthBranch).toBe("傷官");
    // 壬 vs 辰(본기 戊, 陽土) — 土克水, 일간을 극, 음양 같음 → 偏官
    expect(result.dayBranch).toBe("偏官");
    expect(result.hourStem).toBe("劫財");
    expect(result.hourBranch).toBe("傷官");
  });

  it("일간이 자기 자신은 십신 없음 (dayStem 필드 부재)", () => {
    const result = computeTenGods({
      year:  { stem: "甲", branch: "子" },
      month: { stem: "乙", branch: "丑" },
      day:   { stem: "丙", branch: "寅" },
      hour:  null,
    });
    expect(result.hourStem).toBeNull();
    expect(result.hourBranch).toBeNull();
    // @ts-expect-error — dayStem은 TenGodAssignment에 없어야 함
    expect(result.dayStem).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패**

```bash
pnpm --filter @gons/saju test tenGods
```
Expected: FAIL.

- [ ] **Step 3: tenGods.ts 구현**

```ts
import type { Stem, Branch, TenGod, Element } from "./hanja";
import { STEM_ELEMENT, STEM_YIN_YANG, BRANCH_MAIN_STEM } from "./hanja";
import type { TenGodAssignment, SajuPillars } from "./types";

const ELEMENT_GEN_NEXT: Record<Element, Element> = {
  wood:"fire", fire:"earth", earth:"metal", metal:"water", water:"wood",
};
const ELEMENT_CTRL_NEXT: Record<Element, Element> = {
  wood:"earth", earth:"water", water:"fire", fire:"metal", metal:"wood",
};

function tenGodOfStem(dayStem: Stem, other: Stem): TenGod {
  const dayEl = STEM_ELEMENT[dayStem];
  const dayYy = STEM_YIN_YANG[dayStem];
  const otherEl = STEM_ELEMENT[other];
  const otherYy = STEM_YIN_YANG[other];
  const sameYy = dayYy === otherYy;

  if (otherEl === dayEl) return sameYy ? "比肩" : "劫財";
  if (otherEl === ELEMENT_GEN_NEXT[dayEl]) return sameYy ? "食神" : "傷官";
  if (otherEl === ELEMENT_CTRL_NEXT[dayEl]) return sameYy ? "偏財" : "正財";
  if (ELEMENT_CTRL_NEXT[otherEl] === dayEl) return sameYy ? "偏官" : "正官";
  if (ELEMENT_GEN_NEXT[otherEl] === dayEl) return sameYy ? "偏印" : "正印";
  throw new Error(`tenGodOfStem: unreachable for ${dayStem} vs ${other}`);
}

function tenGodOfBranch(dayStem: Stem, branch: Branch): TenGod {
  return tenGodOfStem(dayStem, BRANCH_MAIN_STEM[branch]);
}

export function computeTenGods(pillars: SajuPillars): TenGodAssignment {
  const dayStem = pillars.day.stem;
  return {
    yearStem:    tenGodOfStem(dayStem, pillars.year.stem),
    yearBranch:  tenGodOfBranch(dayStem, pillars.year.branch),
    monthStem:   tenGodOfStem(dayStem, pillars.month.stem),
    monthBranch: tenGodOfBranch(dayStem, pillars.month.branch),
    dayBranch:   tenGodOfBranch(dayStem, pillars.day.branch),
    hourStem:    pillars.hour ? tenGodOfStem(dayStem, pillars.hour.stem) : null,
    hourBranch:  pillars.hour ? tenGodOfBranch(dayStem, pillars.hour.branch) : null,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @gons/saju test tenGods
```
Expected: PASS (2/2).

- [ ] **Step 5: 커밋**

```bash
git add packages/saju/src/tenGods.ts packages/saju/src/tenGods.test.ts
git commit -m "feat(saju): tenGods — 일간 기준 십신 도출

오행 상생/상극 + 음양 동이로 10개 십신 결정. 지지는 본기 천간을
대표로 사용. G1 골든 케이스(丁火 일간) 통과.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: elements.ts — 오행 분포 + 강약

**Files:**
- Create: `packages/saju/src/elements.ts`
- Create: `packages/saju/src/elements.test.ts`

**로직:**
- 8자 각각의 오행 카운트 (천간 4 + 지지 4의 본기). 단순 빈도수.
- 강약: 일간 오행 카운트 비교
  - 4+ → very-strong, 3 → strong, 2 → balanced, 1 → weak, 0 → very-weak
  - (간이 룰. 진짜 신왕은 월령·통근까지 보지만 MVP는 빈도 기반)

- [ ] **Step 1: elements.test.ts 작성**

```ts
import { describe, expect, it } from "vitest";
import { computeElements, computeStrength } from "./elements";

describe("computeElements", () => {
  it("G1: 丁未/癸卯/壬辰/癸卯 → 木3 火1 土2 金0 水3", () => {
    // 천간: 丁(火) 癸(水) 壬(水) 癸(水) → 火1 水3
    // 지지: 未(土) 卯(木) 辰(土) 卯(木) → 土2 木2
    // 잠깐 — 卯×2가 아니라 G1은 月支·時支만 卯(2개). 日支는 辰. → 木2 土2.
    // 총합: 火1 水3 + 木2 土2 = wood:2 fire:1 earth:2 metal:0 water:3? 재계산:
    // 천간 4: 丁火, 癸水, 壬水, 癸水 → fire:1, water:3
    // 지지 4: 未土, 卯木, 辰土, 卯木 → earth:2, wood:2
    // 합: wood:2 fire:1 earth:2 metal:0 water:3 (총 8개) ✓
    const result = computeElements({
      year:  { stem: "丁", branch: "未" },
      month: { stem: "癸", branch: "卯" },
      day:   { stem: "壬", branch: "辰" },
      hour:  { stem: "癸", branch: "卯" },
    });
    expect(result).toEqual({ wood: 2, fire: 1, earth: 2, metal: 0, water: 3 });
  });

  it("hour null이면 6자만 카운트 합 = 6", () => {
    const result = computeElements({
      year:  { stem: "甲", branch: "子" },
      month: { stem: "乙", branch: "丑" },
      day:   { stem: "丙", branch: "寅" },
      hour:  null,
    });
    const total = result.wood + result.fire + result.earth + result.metal + result.water;
    expect(total).toBe(6);
  });
});

describe("computeStrength", () => {
  it("G1: 일간 壬(水), 水 카운트 3 → strong", () => {
    expect(computeStrength({ wood:2, fire:1, earth:2, metal:0, water:3 }, "壬")).toBe("strong");
  });
  it("일간 오행 4개 → very-strong", () => {
    expect(computeStrength({ wood:0, fire:4, earth:2, metal:1, water:1 }, "丁")).toBe("very-strong");
  });
  it("일간 오행 0개 → very-weak", () => {
    expect(computeStrength({ wood:2, fire:0, earth:3, metal:2, water:1 }, "丁")).toBe("very-weak");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @gons/saju test elements
```
Expected: FAIL.

- [ ] **Step 3: elements.ts 구현**

```ts
import type { Stem, Element } from "./hanja";
import { STEM_ELEMENT, BRANCH_ELEMENT } from "./hanja";
import type { SajuPillars, ElementCount, Strength } from "./types";

export function computeElements(pillars: SajuPillars): ElementCount {
  const counts: ElementCount = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  const bump = (el: Element) => { counts[el] += 1; };

  bump(STEM_ELEMENT[pillars.year.stem]);
  bump(BRANCH_ELEMENT[pillars.year.branch]);
  bump(STEM_ELEMENT[pillars.month.stem]);
  bump(BRANCH_ELEMENT[pillars.month.branch]);
  bump(STEM_ELEMENT[pillars.day.stem]);
  bump(BRANCH_ELEMENT[pillars.day.branch]);
  if (pillars.hour) {
    bump(STEM_ELEMENT[pillars.hour.stem]);
    bump(BRANCH_ELEMENT[pillars.hour.branch]);
  }
  return counts;
}

export function computeStrength(elements: ElementCount, dayStem: Stem): Strength {
  const dayEl = STEM_ELEMENT[dayStem];
  const count = elements[dayEl];
  if (count >= 4) return "very-strong";
  if (count === 3) return "strong";
  if (count === 2) return "balanced";
  if (count === 1) return "weak";
  return "very-weak";
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
pnpm --filter @gons/saju test elements
```
Expected: PASS (5/5).

```bash
git add packages/saju/src/elements.ts packages/saju/src/elements.test.ts
git commit -m "feat(saju): elements — 오행 분포 + 신강도

8자 천간·지지 빈도 카운트. 일간 오행 빈도로 5단계 신강도
(very-strong/strong/balanced/weak/very-weak). G1 통과.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: pattern.ts — 격국 + 용신/기신

**Files:**
- Create: `packages/saju/src/pattern.ts`
- Create: `packages/saju/src/pattern.test.ts`

**로직 (간이 MVP):**
- 격국: 월지 본기 천간 vs 일간의 십신 → 십신명 + "格"
  - 예: 일간 丁, 월지 卯(本氣 乙木), 십신=偏印 → "偏印格"
- 용신: 신강이면 일간을 제·설(財·官·食傷)하는 오행, 신약이면 일간을 생·부조(印·比劫)하는 오행
  - 매핑 테이블로 간단히
- 기신: 용신의 반대

⚠️ 진짜 사주학의 격국·용신은 통근·합충·조후까지 봐야 하지만, MVP는 신강도 + 월지 십신 기반 간이 룰.

- [ ] **Step 1: pattern.test.ts**

```ts
import { describe, expect, it } from "vitest";
import { computePattern } from "./pattern";

describe("computePattern", () => {
  it("G1: 일간 壬, 월지 卯(乙木→傷官), 강약 strong → 傷官格 + 용신 [fire, earth] (재·관)", () => {
    const result = computePattern({
      pillars: {
        year:  { stem: "丁", branch: "未" },
        month: { stem: "癸", branch: "卯" },
        day:   { stem: "壬", branch: "辰" },
        hour:  { stem: "癸", branch: "卯" },
      },
      strength: "strong",
    });
    expect(result.pattern).toBe("傷官格");
    // 신강이면 일간을 제·설하는 오행: 재(壬水→克火) + 관(壬水→被土克)
    expect(result.yongSin).toContain("fire");
    expect(result.yongSin).toContain("earth");
  });
});
```

- [ ] **Step 2: 실패 확인 + 구현**

```bash
pnpm --filter @gons/saju test pattern
```
Expected: FAIL.

`packages/saju/src/pattern.ts`:
```ts
import type { Element } from "./hanja";
import { BRANCH_MAIN_STEM, STEM_ELEMENT, STEM_YIN_YANG } from "./hanja";
import type { SajuPillars, Strength } from "./types";

export interface ComputePatternInput {
  pillars: SajuPillars;
  strength: Strength;
}

export interface PatternResult {
  pattern: string;       // 한자 e.g. "偏印格"
  yongSin: Element[];
  giSin: Element[];
}

const ELEMENT_GEN_NEXT: Record<Element, Element> = {
  wood:"fire", fire:"earth", earth:"metal", metal:"water", water:"wood",
};
const ELEMENT_CTRL_NEXT: Record<Element, Element> = {
  wood:"earth", earth:"water", water:"fire", fire:"metal", metal:"wood",
};

const TEN_GOD_HANJA: Record<string, string> = {
  比肩:"比肩格", 劫財:"劫財格", 食神:"食神格", 傷官:"傷官格",
  偏財:"偏財格", 正財:"正財格", 偏官:"偏官格", 正官:"正官格",
  偏印:"偏印格", 正印:"正印格",
};

import { tenGodOfStem } from "./tenGods-internal"; // ⚠️ Task 4의 tenGodOfStem을 export하려면 tenGods.ts에서 named export 추가 필요

export function computePattern(input: ComputePatternInput): PatternResult {
  const { pillars, strength } = input;
  const dayStem = pillars.day.stem;
  const monthBranchMainStem = BRANCH_MAIN_STEM[pillars.month.branch];
  const monthTenGod = tenGodOfStem(dayStem, monthBranchMainStem);
  const pattern = TEN_GOD_HANJA[monthTenGod] ?? "未定格";

  const dayEl = STEM_ELEMENT[dayStem];
  const strongLike = strength === "strong" || strength === "very-strong";

  const yongSin: Element[] = strongLike
    ? [
        ELEMENT_CTRL_NEXT[dayEl],                           // 일간이 극하는 (財)
        ELEMENT_CTRL_NEXT[ELEMENT_CTRL_NEXT[dayEl] as Element], // 일간을 극하는 (官)
      ]
    : [
        invertCtrl(dayEl),    // 일간을 생하는 (印)
        dayEl,                // 비겁 (자체 보강)
      ];
  const giSin: Element[] = yongSin.map((e) => oppositeElement(e));

  return { pattern, yongSin, giSin };
}

function invertCtrl(el: Element): Element {
  // 일간을 생하는 오행 (오행 생 순서의 이전 자리)
  const map: Record<Element, Element> = {
    wood:"water", fire:"wood", earth:"fire", metal:"earth", water:"metal",
  };
  return map[el];
}

function oppositeElement(el: Element): Element {
  // 용신의 반대로 간단히 — 용신을 극하는 오행을 기신으로
  return ELEMENT_CTRL_NEXT[el];
}
```

⚠️ `tenGodOfStem`을 `tenGods.ts`에서 외부 사용 가능하게 만들려면: Task 4의 `tenGods.ts` 끝에 `export { tenGodOfStem };` 추가 (그러나 Task 4 시점엔 내부 함수여서 export 안 함). Task 6 시작 전에 별도 commit으로 추가:

```ts
// tenGods.ts 마지막에 추가
export { tenGodOfStem, tenGodOfBranch };
```

그리고 `pattern.ts`에서:
```ts
import { tenGodOfStem } from "./tenGods";
```

- [ ] **Step 3: tenGods.ts 수정 (function export 추가) + 통과 확인**

먼저 `tenGods.ts` 패치:
```bash
# packages/saju/src/tenGods.ts 파일 마지막 줄에 추가:
#   export { tenGodOfStem, tenGodOfBranch };
```

```bash
pnpm --filter @gons/saju test pattern
pnpm --filter @gons/saju test tenGods  # 회귀 없음 확인
```
Expected: 둘 다 PASS.

- [ ] **Step 4: 커밋**

```bash
git add packages/saju/src/pattern.ts packages/saju/src/pattern.test.ts \
        packages/saju/src/tenGods.ts
git commit -m "feat(saju): pattern — 격국 + 용신/기신 (MVP 간이 룰)

월지 본기 천간 십신 → 격국명. 신강이면 재·관, 신약이면 인·비겁을
용신으로. G1(일간 壬水, 월지 卯木) → 傷官格 + 용신 [火,土] 통과.
통근·합충·조후 보정은 후속(spec §11 escape hatch).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: majorFortune.ts — 대운 10개

**Files:**
- Create: `packages/saju/src/majorFortune.ts`
- Create: `packages/saju/src/majorFortune.test.ts`

**로직:**
- 순행/역행: 남자 양년(연간 yang) 또는 여자 음년(연간 yin) → 순행. 남자 음년 또는 여자 양년 → 역행
- 입대운 나이: 절기 기준 일수 / 3 (3일=1년). 라이브러리에서 가져오거나 간이 룰로 9세 고정 후 보정 — MVP는 라이브러리 결과 신뢰
- 시작 간지: 월주 다음(순행) 또는 이전(역행) 간지부터 10개

`lunar-javascript`는 `eightChar.getYun(gender)`로 대운 계산 — Task 1에서 검증 필요.

- [ ] **Step 1: majorFortune.test.ts (G1 — 남자 정미년/음년 → 역행, 입대운 8세)**

⚠️ 라이브러리 확인 결과: lunar-javascript `getYun(1).getDaYun(11)`의 인덱스 0은 "대운 전 구간"(`getGanZhi()===""`), 인덱스 1부터가 실제 첫 대운. 입대운 나이 = **8세** (1974-10-19 기준 만 7세인데 lunar-javascript는 만+1 표기). 첫 대운 간지는 壬寅로 plan 추정과 동일.

```ts
import { describe, expect, it } from "vitest";
import { computeMajorFortunes } from "./majorFortune";

describe("computeMajorFortunes", () => {
  it("G1: 1967-03-29 05:30 남자 양력 → 역행, 입대운 8세, 첫 대운 壬寅", () => {
    const result = computeMajorFortunes({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
    });
    expect(result).toHaveLength(10);
    expect(result[0].startAge).toBe(8);
    expect(result[0]).toMatchObject({ stem: "壬", branch: "寅" });
    expect(result[0].startYear).toBe(1974);
    // 역행이므로 다음은 辛丑
    expect(result[1]).toMatchObject({ stem: "辛", branch: "丑" });
  });

  it("hour=null이어도 정상 작동 (시각은 입대운 계산에 영향, 정오로 폴백 가능)", () => {
    const result = computeMajorFortunes({
      birthDate: "1990-01-15",
      birthTime: null,
      calendar: "solar",
      gender: "female",
    });
    expect(result).toHaveLength(10);
  });
});
```

- [ ] **Step 2: 구현**

`packages/saju/src/majorFortune.ts`:
```ts
import { Solar, Lunar } from "lunar-javascript";
import type { Stem, Branch } from "./hanja";
import type { MajorFortune } from "./types";

export interface ComputeMajorFortunesInput {
  birthDate: string;
  birthTime: string | null;
  calendar: "solar" | "lunar";
  gender: "male" | "female";
}

export function computeMajorFortunes(input: ComputeMajorFortunesInput): MajorFortune[] {
  const [y, m, d] = input.birthDate.split("-").map(Number);
  const [hh, mm] = (input.birthTime ?? "12:00").split(":").map(Number);
  const solar = input.calendar === "solar"
    ? Solar.fromYmdHms(y, m, d, hh, mm, 0)
    : Lunar.fromYmdHms(y, m, d, hh, mm, 0).getSolar();

  const lunar = solar.getLunar();
  const eightChar = lunar.getEightChar();
  // lunar-javascript: Yun.gender 1=男, 0=女
  const yun = eightChar.getYun(input.gender === "male" ? 1 : 0);

  // getDaYun(N)의 인덱스 0은 "대운 전 출생~입대운 직전" 구간(getGanZhi()이 빈 문자열).
  // 실제 대운 10개를 원하면 11개 받고 인덱스 1부터.
  const daYunList = yun.getDaYun(11).slice(1);

  return daYunList.map((dy: any) => ({
    startAge: dy.getStartAge(),
    startYear: dy.getStartYear(),
    stem: dy.getGanZhi().charAt(0) as Stem,
    branch: dy.getGanZhi().charAt(1) as Branch,
  }));
}
```

⚠️ `getStartYear()` / `getDaYun()` API는 lunar-javascript 버전 따라 다름. Task 1 평가 단계에서 정확한 API를 README에 기록. 결과가 G1 기대값(9세, 壬寅 첫 대운)과 안 맞으면 라이브러리 reference 페이지를 보고 보정.

- [ ] **Step 3: 통과 확인 + 커밋**

```bash
pnpm --filter @gons/saju test majorFortune
```
Expected: PASS (2/2).

```bash
git add packages/saju/src/majorFortune.ts packages/saju/src/majorFortune.test.ts
git commit -m "feat(saju): majorFortune — 대운 10개 + 입대운 나이

남자 양년·여자 음년 순행, 그 외 역행. 라이브러리 getYun(gender).getDaYun(11)
의 인덱스 0(대운 전 구간) 제외, [1..10] 10개 매핑. G1 입대운 8세,
첫 대운 壬寅 통과.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: computeSajuChart.ts + hashProfile + index 통합

**Files:**
- Create: `packages/saju/src/computeSajuChart.ts`
- Create: `packages/saju/src/computeSajuChart.test.ts`
- Create: `packages/saju/src/hashProfile.ts`
- Create: `packages/saju/src/index.ts`

- [ ] **Step 1: hashProfile.ts (input_hash 계산)**

```ts
import { createHash } from "node:crypto";
import type { ComputeSajuInput } from "./types";

export function hashProfile(input: ComputeSajuInput): string {
  const normalized = [
    input.birthDate,
    input.birthTime ?? "",
    input.calendar,
    input.gender,
    (input.birthCity ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
```

- [ ] **Step 2: computeSajuChart.ts (통합)**

```ts
import { computePillars } from "./pillars";
import { computeTenGods } from "./tenGods";
import { computeElements, computeStrength } from "./elements";
import { computePattern } from "./pattern";
import { computeMajorFortunes } from "./majorFortune";
import { hashProfile } from "./hashProfile";
import type { SajuChart, ComputeSajuInput } from "./types";

export function computeSajuChart(input: ComputeSajuInput): SajuChart {
  const pillars = computePillars(input);
  const elements = computeElements(pillars);
  const strength = computeStrength(elements, pillars.day.stem);
  const tenGods = computeTenGods(pillars);
  const { pattern, yongSin, giSin } = computePattern({ pillars, strength });
  const majorFortunes = computeMajorFortunes(input);
  return {
    pillars,
    elements,
    strength,
    tenGods,
    pattern,
    yongSin,
    giSin,
    majorFortunes,
    inputHash: hashProfile(input),
  };
}
```

- [ ] **Step 3: index.ts (public API barrel)**

```ts
export { computeSajuChart } from "./computeSajuChart";
export { hashProfile } from "./hashProfile";
export type {
  SajuChart, SajuPillars, Pillar, ElementCount, TenGodAssignment,
  MajorFortune, Strength, ComputeSajuInput,
} from "./types";
export {
  STEMS, BRANCHES, STEM_KO, BRANCH_KO,
  ELEMENT_KO, ELEMENT_HANJA, TEN_GOD_KO,
} from "./hanja";
export type { Stem, Branch, Element, TenGod } from "./hanja";
```

- [ ] **Step 4: computeSajuChart.test.ts (G1 end-to-end 회귀)**

```ts
import { describe, expect, it } from "vitest";
import { computeSajuChart } from "./computeSajuChart";

describe("computeSajuChart — G1 end-to-end", () => {
  const G1 = {
    birthDate: "1967-03-29",
    birthTime: "05:30",
    calendar: "solar" as const,
    gender: "male" as const,
    birthCity: null,
  };

  it("4주 = 丁未 癸卯 壬辰 癸卯", () => {
    const chart = computeSajuChart(G1);
    expect(chart.pillars.year).toEqual({ stem: "丁", branch: "未" });
    expect(chart.pillars.month).toEqual({ stem: "癸", branch: "卯" });
    expect(chart.pillars.day).toEqual({ stem: "壬", branch: "辰" });
    expect(chart.pillars.hour).toEqual({ stem: "癸", branch: "卯" });
  });

  it("오행 = wood:2 fire:1 earth:2 metal:0 water:3", () => {
    const chart = computeSajuChart(G1);
    expect(chart.elements).toEqual({ wood: 2, fire: 1, earth: 2, metal: 0, water: 3 });
  });

  it("격국 = 傷官格, 용신에 fire+earth 포함", () => {
    const chart = computeSajuChart(G1);
    expect(chart.pattern).toBe("傷官格");
    expect(chart.yongSin).toEqual(expect.arrayContaining(["fire", "earth"]));
  });

  it("대운 10개, 첫 대운 = 8세 壬寅", () => {
    const chart = computeSajuChart(G1);
    expect(chart.majorFortunes).toHaveLength(10);
    expect(chart.majorFortunes[0].startAge).toBe(8);
    expect(chart.majorFortunes[0]).toMatchObject({ stem: "壬", branch: "寅" });
  });

  it("inputHash는 결정적이고 입력 변경 시 다름", () => {
    const h1 = computeSajuChart(G1).inputHash;
    const h2 = computeSajuChart({ ...G1, birthCity: "Seoul " }).inputHash;
    const h3 = computeSajuChart({ ...G1, birthCity: "seoul" }).inputHash;
    expect(h1).not.toBe(h2);
    expect(h2).toBe(h3); // trim + lowercase 정규화로 동일
  });
});
```

- [ ] **Step 5: 전체 테스트 + typecheck**

```bash
pnpm --filter @gons/saju test
pnpm --filter @gons/saju typecheck
```
Expected: 모든 테스트 PASS, typecheck 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add packages/saju/src/computeSajuChart.ts packages/saju/src/computeSajuChart.test.ts \
        packages/saju/src/hashProfile.ts packages/saju/src/index.ts
git commit -m "feat(saju): computeSajuChart — pillars/elements/tenGods/pattern/majorFortune 통합

public API 1개 (computeSajuChart). G1 end-to-end 회귀 5건 통과.
hashProfile은 birthCity 정규화(trim + lowercase) 후 SHA-256.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: 루트 워크스페이스 통합 + dashboard에서 import 가능 확인

**Files:**
- Modify: `apps/dashboard/package.json` (dependencies에 `@gons/saju` 추가)
- Modify: `pnpm-workspace.yaml` (변경 없음 — `packages/*` 이미 포함)

- [ ] **Step 1: dashboard package.json 패치**

`apps/dashboard/package.json`의 `dependencies` 섹션에 추가:
```json
"@gons/saju": "workspace:*"
```

- [ ] **Step 2: 워크스페이스 재설치**

```bash
cd /home/gon/projects/gon/gons-dashboard
pnpm install
```

- [ ] **Step 3: dashboard에서 import 한 줄 스모크 테스트**

`apps/dashboard/src/shared/lib/saju/smoke.test.ts` (임시):
```ts
import { describe, expect, it } from "vitest";
import { computeSajuChart } from "@gons/saju";

describe("@gons/saju 워크스페이스 import smoke", () => {
  it("dashboard에서 호출 가능 + G1 결과", () => {
    const chart = computeSajuChart({
      birthDate: "1967-03-29",
      birthTime: "05:30",
      calendar: "solar",
      gender: "male",
      birthCity: null,
    });
    expect(chart.pillars.day.stem).toBe("壬");
  });
});
```

- [ ] **Step 4: 실행 확인**

```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test shared/lib/saju/smoke
```
Expected: PASS.

⚠️ 스모크 테스트는 통과 후 **삭제하지 않고 유지** — `@gons/saju` 패키지 경계의 회귀 가드 1개로 남김. (Phase 1·2 작업 중 import path가 깨지면 즉시 알림.)

- [ ] **Step 5: 루트 typecheck/lint/test 전체 통과 확인**

```bash
pnpm typecheck
pnpm lint
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```
Expected: 모두 통과 (기존 통합 테스트 ECONNREFUSED 13개는 Gotcha #2 — 무관).

- [ ] **Step 6: Phase 0 마무리 커밋**

```bash
git add apps/dashboard/package.json apps/dashboard/src/shared/lib/saju/smoke.test.ts pnpm-lock.yaml
git commit -m "chore(saju): @gons/saju를 dashboard 의존성으로 등록 + 스모크 테스트

dashboard 워크스페이스에서 computeSajuChart 호출 가능 확인. 패키지
경계 회귀 가드용 스모크 테스트 1건 유지.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: PR 생성

- [ ] **Step 1: 브랜치 푸시 + PR 생성**

```bash
git push -u origin HEAD
gh pr create --title "feat(saju): Phase 0 — @gons/saju 워크스페이스 패키지" --body "$(cat <<'EOF'
## Summary

- 새 워크스페이스 패키지 `@gons/saju` 생성
- 만세력 라이브러리 평가 (manseryeok / korean-lunar-calendar / lunar-javascript) → 1위 선정
- pillars / tenGods / elements / pattern / majorFortune 5개 모듈 + 통합 `computeSajuChart`
- 골든 케이스 G1(1967-03-29 05:30 양력 남자) end-to-end 회귀 통과
- dashboard에서 `import { computeSajuChart } from "@gons/saju"` 가능

## Spec

`docs/superpowers/specs/2026-05-13-saju-detail-design.md` §3, §11.

## Test plan

- [ ] `pnpm --filter @gons/saju test` 모두 PASS
- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` 통과
- [ ] G1 골든 케이스: 4주 丁未 癸卯 丁卯 癸卯 / 오행 wood:3 fire:2 earth:1 metal:0 water:2 / 偏印格 / 입대운 9세 壬寅
- [ ] 라이브러리 평가 결과 `packages/saju/library-eval/README.md` 기록

## Next phases (별도 PR)

- Phase 1: DB 0007 마이그레이션 + `features/saju-reading` (LLM 해설 캐시)
- Phase 2: `/fortune/[profileId]` 페이지 + 6개 widgets

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 체크리스트 (작성 후 본인 확인)

- [x] **Spec 커버리지**: §3 packages/saju 구조 ✓, §11 라이브러리 평가 ✓, G1 골든 케이스 ✓
- [x] **Placeholder 스캔**: TBD/TODO 없음. ⚠️로 시작하는 보정 안내만 있음 (라이브러리 API 시그니처는 Task 1 결과에 따라 가변이라 inline 가이드 유지)
- [x] **타입 일관성**: `Stem/Branch/Element/TenGod` 모두 `hanja.ts`에서 import. `SajuChart` 필드명은 spec §3과 일치 (pillars, elements, strength, tenGods, pattern, yongSin, giSin, majorFortunes, inputHash)
- [x] **함수 시그니처**: `computePillars(ComputePillarsInput)`, `computeTenGods(SajuPillars)`, `computeElements(SajuPillars)`, `computeStrength(ElementCount, Stem)`, `computePattern(ComputePatternInput)`, `computeMajorFortunes(ComputeMajorFortunesInput)`, `computeSajuChart(ComputeSajuInput)` — 모두 명시
- [x] **`tenGodOfStem` cross-task export 의존성**: Task 6에서 Task 4 파일 수정 명시 ✓

---

## 메모

- Phase 1(`features/saju-reading` + DB 0007)은 별도 plan 파일 `2026-05-13-saju-phase1-reading-pipeline.md`로 작성
- Phase 2(`/fortune/[profileId]` UI)은 별도 plan 파일 `2026-05-13-saju-phase2-detail-page.md`로 작성
- 격국·용신은 MVP 간이 룰 — 진짜 사주학 통근·합충·조후는 후속(spec §12 R1 escape hatch와 별개 후속 backlog)
