# Saju Phase 2 — `/fortune/[profileId]` 상세 페이지 + 위젯 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 `/fortune/[profileId]`로 진입해 한자 사주팔자 · 오행 분포 · 십신 · 격국·용신 · 대운 · 5섹션 LLM 해설을 보는 상세 페이지. 홈 위젯과 프로필 관리 페이지 양쪽에서 진입.

**Architecture:** Next.js App Router RSC. 한 페이지가 Phase 1의 `ensureChartAndReadings` 1회 호출 후 6개 dumb 위젯에 props로 전달. 대운 strip 외에는 상호작용 없는 정적 그리드 — 한자 명조 폰트와 5색 오행 토큰으로 시각적 차별화. 해설 markdown은 `react-markdown`으로 렌더.

**Tech Stack:** Next.js 16 RSC, Tailwind CSS v4, Noto Serif KR 폰트, `react-markdown` (신규 의존성).

**Spec reference:** `docs/superpowers/specs/2026-05-13-saju-detail-design.md` §6, §8.

**Prerequisite:** PR #50 (Phase 1) 머지 완료. main에 `ensureChartAndReadings`, `getSajuChartByProfile` 존재.

---

## File Structure

```
apps/dashboard/
├── package.json                                   # MODIFY — react-markdown 추가
├── src/
│   ├── app/
│   │   ├── globals.css                            # MODIFY — --font-hanja + 5색 오행 토큰
│   │   ├── layout.tsx                             # MODIFY — Noto Serif KR preconnect (이미 next/font 패턴 있으면 그것 사용)
│   │   └── fortune/
│   │       └── [profileId]/
│   │           └── page.tsx                       # NEW — RSC, ensureChartAndReadings 호출
│   └── widgets/
│       ├── saju-detail/                           # NEW
│       │   ├── ui/
│       │   │   ├── SajuDetailHeader.tsx
│       │   │   ├── SajuPillarsBoard.tsx
│       │   │   ├── SajuElementsChart.tsx
│       │   │   ├── SajuTenGodsTable.tsx
│       │   │   ├── SajuPatternCard.tsx
│       │   │   ├── SajuMajorFortuneStrip.tsx
│       │   │   └── SajuReadingSection.tsx
│       │   └── index.ts
│       └── fortune/ui/FortuneCardClient.tsx       # MODIFY — '상세' 링크 추가
└── widgets/fortune-profiles/ui/FortuneProfileCard.tsx  # MODIFY — '상세보기' 링크 추가
```

각 위젯은 server component (dumb) — props만 받고 데이터 페치 없음. 페이지(`page.tsx`)에서 `ensureChartAndReadings` 한 번 호출 후 props 분배.

---

## Task 1: react-markdown 의존성 추가

**Files:**
- Modify: `apps/dashboard/package.json` (dependencies)

- [ ] **Step 1: package.json에 추가**

`apps/dashboard/package.json` dependencies에:
```json
"react-markdown": "^9.0.1"
```

(2026-05 기준 안정 버전. 정확한 최신 버전은 `pnpm view react-markdown version`으로 확인 후 minor만 ^로.)

- [ ] **Step 2: 설치**

```
pnpm install
```

- [ ] **Step 3: 커밋**

`apps/dashboard/package.json` + `pnpm-lock.yaml` 스테이지.

```
chore(saju): react-markdown 추가 — Phase 2 해설 섹션 마크다운 렌더

5개 LLM 해설 섹션(overview/personality/career/health/major_fortune)이
markdown text 로 들어오므로 react-markdown 으로 안전하게 렌더링.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 2: globals.css — 오행 색 + 한자 폰트 토큰

**Files:**
- Modify: `apps/dashboard/src/app/globals.css`

- [ ] **Step 1: `:root` 안에 토큰 추가** (기존 토큰 블록 끝에)

```css
/* 사주 상세 — 한자 명조 폰트 */
--font-hanja: 'Noto Serif KR', 'Noto Serif TC', 'Noto Serif SC', serif;

/* 사주 상세 — 5색 오행 (식별 가능한 채도 분리) */
--color-wood:  oklch(70% 0.13 145);  /* 청록 */
--color-fire:  oklch(65% 0.20  30);  /* 적 */
--color-earth: oklch(70% 0.10  80);  /* 황 */
--color-metal: oklch(78% 0.02 250);  /* 백·은 */
--color-water: oklch(50% 0.12 250);  /* 흑·청 */
```

- [ ] **Step 2: 폰트 로딩**

기존 layout.tsx에서 `next/font/google` 패턴이 있는지 확인 (`grep -n 'next/font' src/app/layout.tsx`). 있으면 그 패턴을 따라 `Noto_Serif_KR` 추가. 없으면 `<link rel="preconnect" href="https://fonts.googleapis.com">` + `<link href="...Noto+Serif+KR..." rel="stylesheet">` 패턴.

⚠️ Next.js 16 권장은 `next/font/google` — Google CDN 호출을 빌드 타임에 처리해 FOUT 차단. 다음을 layout.tsx에 추가:

```tsx
import { Noto_Serif_KR } from "next/font/google";

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-hanja",
});

// <body className={notoSerifKr.variable}>...
```

⚠️ `next/font/google`은 빌드 시점에 폰트를 다운로드. 빌드 머신이 Google에 접근 가능해야 함 (CI는 OK).

⚠️ Korean subsets는 자동 처리되므로 명시 안 함.

- [ ] **Step 3: typecheck + 커밋**

```
feat(saju): globals.css — 한자 폰트 + 5색 오행 토큰

--font-hanja (Noto Serif KR via next/font/google), --color-{wood,fire,
earth,metal,water} oklch 5색. 상세 페이지 비주얼 토큰.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 3: SajuPillarsBoard — 한자 4주 메인 비주얼

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuPillarsBoard.tsx`

### Logic
- 4주(연/월/일/시) 한자 표 + 한글 음 + 십신 라벨
- 일간(日干) 칸은 accent 강조 — 자기 자신은 십신 라벨 자리에 `─`
- 시맨틱 `<table>` + `<th scope="col">`, 한자에 `lang="ko-Hani"`
- 모바일: 2×2 reflow (sm 미만)

- [ ] **Step 1: 컴포넌트**

```tsx
import type { SajuChartRow } from "@/entities/saju-chart";
import { STEM_KO, BRANCH_KO, TEN_GOD_KO, ELEMENT_HANJA, STEM_ELEMENT, BRANCH_ELEMENT, type Stem, type Branch, type Element, type TenGod } from "@gons/saju";

interface CellProps {
  hanja: string;
  ko: string;
  tenGod?: TenGod | null;
  element: Element;
  highlight?: boolean;
}

function Cell({ hanja, ko, tenGod, element, highlight }: CellProps) {
  return (
    <td
      className={`p-3 align-top text-center ${
        highlight
          ? "bg-[var(--color-accent)]/8 border-[var(--color-accent)]"
          : ""
      } border border-[var(--color-hairline)]`}
    >
      <div
        className={`font-[family-name:var(--font-hanja)] text-4xl leading-none text-[var(--color-${element})]`}
        lang="ko-Hani"
      >
        {hanja}
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-subtle)]">({ko})</div>
      <div className="mt-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {tenGod ? TEN_GOD_KO[tenGod] : "─"}
      </div>
    </td>
  );
}

export interface SajuPillarsBoardProps {
  chart: Pick<
    SajuChartRow,
    "yearStem" | "yearBranch" | "monthStem" | "monthBranch"
    | "dayStem" | "dayBranch" | "hourStem" | "hourBranch" | "tenGods"
  >;
}

export function SajuPillarsBoard({ chart }: SajuPillarsBoardProps) {
  // tenGods는 jsonb. TenGodAssignment 형태 캐스팅.
  const tg = chart.tenGods as {
    yearStem: TenGod; yearBranch: TenGod;
    monthStem: TenGod; monthBranch: TenGod;
    dayBranch: TenGod;
    hourStem: TenGod | null; hourBranch: TenGod | null;
  };

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr className="text-xs text-[var(--color-text-muted)]">
          <th scope="col" className="p-2 font-medium">시주 (時柱)</th>
          <th scope="col" className="p-2 font-medium">일주 (日柱)</th>
          <th scope="col" className="p-2 font-medium">월주 (月柱)</th>
          <th scope="col" className="p-2 font-medium">연주 (年柱)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          {chart.hourStem && chart.hourBranch ? (
            <Cell
              hanja={chart.hourStem}
              ko={STEM_KO[chart.hourStem as Stem]}
              tenGod={tg.hourStem}
              element={STEM_ELEMENT[chart.hourStem as Stem]}
            />
          ) : (
            <td className="p-3 text-center text-xs text-[var(--color-text-subtle)] border border-dashed border-[var(--color-hairline)]">
              시각 미상
            </td>
          )}
          <Cell
            hanja={chart.dayStem}
            ko={STEM_KO[chart.dayStem as Stem]}
            tenGod={null}
            element={STEM_ELEMENT[chart.dayStem as Stem]}
            highlight
          />
          <Cell
            hanja={chart.monthStem}
            ko={STEM_KO[chart.monthStem as Stem]}
            tenGod={tg.monthStem}
            element={STEM_ELEMENT[chart.monthStem as Stem]}
          />
          <Cell
            hanja={chart.yearStem}
            ko={STEM_KO[chart.yearStem as Stem]}
            tenGod={tg.yearStem}
            element={STEM_ELEMENT[chart.yearStem as Stem]}
          />
        </tr>
        <tr>
          {chart.hourStem && chart.hourBranch ? (
            <Cell
              hanja={chart.hourBranch}
              ko={BRANCH_KO[chart.hourBranch as Branch]}
              tenGod={tg.hourBranch}
              element={BRANCH_ELEMENT[chart.hourBranch as Branch]}
            />
          ) : (
            <td className="p-3 text-center text-xs text-[var(--color-text-subtle)] border border-dashed border-[var(--color-hairline)]">
              —
            </td>
          )}
          <Cell
            hanja={chart.dayBranch}
            ko={BRANCH_KO[chart.dayBranch as Branch]}
            tenGod={tg.dayBranch}
            element={BRANCH_ELEMENT[chart.dayBranch as Branch]}
          />
          <Cell
            hanja={chart.monthBranch}
            ko={BRANCH_KO[chart.monthBranch as Branch]}
            tenGod={tg.monthBranch}
            element={BRANCH_ELEMENT[chart.monthBranch as Branch]}
          />
          <Cell
            hanja={chart.yearBranch}
            ko={BRANCH_KO[chart.yearBranch as Branch]}
            tenGod={tg.yearBranch}
            element={BRANCH_ELEMENT[chart.yearBranch as Branch]}
          />
        </tr>
      </tbody>
    </table>
  );
}
```

⚠️ `text-[var(--color-${element})]` 같은 Tailwind dynamic class는 빌드 시 purge로 사라질 수 있음. element가 5개 고정이므로 safelist 또는 `style={{ color: \`var(--color-${element})\` }}`로 inline 처리하는 게 안전.

⚠️ Tailwind v4의 default `arbitrary value` 패턴이 `text-[var(--color-foo)]`을 지원하지만 동적 보간(`color-${element}`)은 빌드 분석 못 함. **inline style이 더 안전**:

```tsx
<div style={{ color: `var(--color-${element})` }} className="...">
```

이렇게 수정.

⚠️ `chart.hourStem`은 `string | null`. `string` 타입 assertion이 필요한 곳에서 narrow:
- if (chart.hourStem) 블록 안에서는 `chart.hourStem as Stem` 가능. 외부에서는 안 됨.

- [ ] **Step 2: 모바일 reflow는 별도 시간 들이지 않음** — `w-full table-fixed`로 가로 스크롤 허용. (Phase 2 후속에서 sm:grid-cols-2 reflow 보강 가능.)

- [ ] **Step 3: typecheck + 커밋**

```
feat(saju): SajuPillarsBoard — 한자 4주 메인 비주얼

table 시맨틱 + lang="ko-Hani" 접근성. 일간 칸 accent 강조. 5색 오행
인라인 style. 출생시 미상이면 시주 칸 dashed border.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 4: SajuElementsChart — 오행 분포 바

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuElementsChart.tsx`

### Logic
- 5개 오행을 가로 막대 5개로. 카운트 0~5 정도 (총 8자).
- 0인 오행은 라벨 + "─" 표시 (결함 강조 — 예: G1의 metal:0)

- [ ] **Step 1: 컴포넌트**

```tsx
import type { ElementCount, Element } from "@gons/saju";
import { ELEMENT_KO } from "@gons/saju";

const ELEMENTS: Element[] = ["wood", "fire", "earth", "metal", "water"];
const MAX_COUNT = 8;

export interface SajuElementsChartProps {
  elements: ElementCount;
}

export function SajuElementsChart({ elements }: SajuElementsChartProps) {
  return (
    <ul className="flex flex-col gap-2">
      {ELEMENTS.map((el) => {
        const count = elements[el];
        const pct = Math.round((count / MAX_COUNT) * 100);
        return (
          <li key={el} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs font-medium text-[var(--color-text-muted)]">
              {ELEMENT_KO[el]}
            </span>
            <div className="flex-1 rounded-sm bg-[var(--color-surface-2)] h-2">
              <div
                className="h-2 rounded-sm"
                style={{
                  width: count === 0 ? 0 : `${pct}%`,
                  backgroundColor: `var(--color-${el})`,
                }}
                aria-label={`${ELEMENT_KO[el]} ${count}개`}
              />
            </div>
            <span
              className={`w-6 shrink-0 text-right text-xs tabular-nums ${
                count === 0
                  ? "text-[var(--color-severity-high)] font-medium"
                  : "text-[var(--color-text-subtle)]"
              }`}
            >
              {count === 0 ? "─" : count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: typecheck + 커밋**

```
feat(saju): SajuElementsChart — 오행 분포 막대

5개 오행 가로 막대 + 결함(count=0) 강조. 5색 오행 토큰 사용.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 5: SajuTenGodsTable — 십신 배치표

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuTenGodsTable.tsx`

### Logic
- `TenGodAssignment` 7개 위치를 4주×2자 표 형태로
- 일간 자리는 "─"

- [ ] **Step 1: 컴포넌트**

```tsx
import { TEN_GOD_KO, type TenGod } from "@gons/saju";

interface TenGodAssignment {
  yearStem: TenGod; yearBranch: TenGod;
  monthStem: TenGod; monthBranch: TenGod;
  dayBranch: TenGod;
  hourStem: TenGod | null; hourBranch: TenGod | null;
}

function Cell({ tg }: { tg: TenGod | null | "self" }) {
  if (tg === "self") return <td className="p-2 text-center text-xs text-[var(--color-text-subtle)]">─</td>;
  if (tg === null) return <td className="p-2 text-center text-xs text-[var(--color-text-subtle)]">—</td>;
  return (
    <td className="p-2 text-center text-xs">
      <span className="font-[family-name:var(--font-hanja)]" lang="ko-Hani">{tg}</span>
      <span className="ml-1 text-[var(--color-text-subtle)]">({TEN_GOD_KO[tg]})</span>
    </td>
  );
}

export function SajuTenGodsTable({ tenGods }: { tenGods: TenGodAssignment }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-[var(--color-text-muted)]">
          <th scope="col" className="p-2 text-left font-medium">위치</th>
          <th scope="col" className="p-2 font-medium">시</th>
          <th scope="col" className="p-2 font-medium">일</th>
          <th scope="col" className="p-2 font-medium">월</th>
          <th scope="col" className="p-2 font-medium">연</th>
        </tr>
      </thead>
      <tbody className="border-t border-[var(--color-hairline)]">
        <tr>
          <th scope="row" className="p-2 text-left text-xs text-[var(--color-text-muted)] font-medium">천간</th>
          <Cell tg={tenGods.hourStem} />
          <Cell tg="self" />
          <Cell tg={tenGods.monthStem} />
          <Cell tg={tenGods.yearStem} />
        </tr>
        <tr className="border-t border-[var(--color-hairline)]">
          <th scope="row" className="p-2 text-left text-xs text-[var(--color-text-muted)] font-medium">지지</th>
          <Cell tg={tenGods.hourBranch} />
          <Cell tg={tenGods.dayBranch} />
          <Cell tg={tenGods.monthBranch} />
          <Cell tg={tenGods.yearBranch} />
        </tr>
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: 커밋**

```
feat(saju): SajuTenGodsTable — 십신 4주×2자 배치표

천간/지지 행, 시일월연 열. 일간 자리는 ─, 출생시 미상 자리는 —.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 6: SajuPatternCard — 격국·신강·용신/기신

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuPatternCard.tsx`

```tsx
import type { Element, Strength } from "@gons/saju";
import { ELEMENT_KO } from "@gons/saju";

const STRENGTH_KO: Record<Strength, string> = {
  "very-strong": "극왕",
  "strong": "신왕",
  "balanced": "중화",
  "weak": "신약",
  "very-weak": "극약",
};

export interface SajuPatternCardProps {
  pattern: string;
  strength: Strength;
  yongSin: Element[];
  giSin: Element[];
}

export function SajuPatternCard({ pattern, strength, yongSin, giSin }: SajuPatternCardProps) {
  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">격국</dt>
      <dd>
        <span className="font-[family-name:var(--font-hanja)] text-base" lang="ko-Hani">{pattern}</span>
      </dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">신강도</dt>
      <dd className="text-sm">{STRENGTH_KO[strength]} <span className="text-xs text-[var(--color-text-subtle)]">({strength})</span></dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">용신</dt>
      <dd className="flex flex-wrap gap-2">
        {yongSin.map((el) => (
          <span
            key={el}
            className="rounded px-2 py-0.5 text-xs"
            style={{ backgroundColor: `var(--color-${el})`, color: "white" }}
          >
            {ELEMENT_KO[el]}
          </span>
        ))}
      </dd>

      <dt className="text-xs font-medium text-[var(--color-text-muted)]">기신</dt>
      <dd className="flex flex-wrap gap-2">
        {giSin.map((el) => (
          <span
            key={el}
            className="rounded border border-[var(--color-hairline-strong)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
          >
            {ELEMENT_KO[el]}
          </span>
        ))}
      </dd>
    </dl>
  );
}
```

- [ ] **Step 2: 커밋**

```
feat(saju): SajuPatternCard — 격국·신강·용신·기신 카드

dl/dt/dd 시맨틱. 용신은 5색 오행 chip, 기신은 outline. 한자 명조 폰트.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 7: SajuMajorFortuneStrip — 대운 10개 가로 스트립

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuMajorFortuneStrip.tsx`

### Logic
- 10개 대운 가로 그리드
- 현재 진행 중인 대운(`currentAge >= startAge && currentAge < nextStartAge`)은 accent
- 클릭은 일단 없음 — 단순 표시

```tsx
import type { MajorFortune } from "@gons/saju";
import { STEM_KO, BRANCH_KO, type Stem, type Branch } from "@gons/saju";

export interface SajuMajorFortuneStripProps {
  majorFortunes: MajorFortune[];
  currentAge: number;
}

function isCurrent(fortunes: MajorFortune[], i: number, age: number): boolean {
  const next = fortunes[i + 1];
  return age >= fortunes[i].startAge && (next ? age < next.startAge : true);
}

export function SajuMajorFortuneStrip({ majorFortunes, currentAge }: SajuMajorFortuneStripProps) {
  return (
    <ol className="grid grid-cols-5 gap-2 sm:grid-cols-10">
      {majorFortunes.map((mf, i) => {
        const current = isCurrent(majorFortunes, i, currentAge);
        return (
          <li
            key={i}
            className={`rounded p-2 text-center ${
              current
                ? "border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/8"
                : "border border-[var(--color-hairline)]"
            }`}
          >
            <div
              className="font-[family-name:var(--font-hanja)] text-base leading-none"
              lang="ko-Hani"
            >
              {mf.stem}{mf.branch}
            </div>
            <div className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
              {STEM_KO[mf.stem as Stem]}{BRANCH_KO[mf.branch as Branch]}
            </div>
            <div className="mt-1 text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {mf.startAge}세~
            </div>
            {current && (
              <div className="mt-1 text-[10px] font-medium text-[var(--color-accent)]">
                진행 중
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: 커밋**

```
feat(saju): SajuMajorFortuneStrip — 대운 10개 가로 스트립

현재 진행 중 대운 accent 강조. 5+10 반응형 그리드.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 8: SajuReadingSection — 5섹션 해설 카드

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuReadingSection.tsx`

### Logic
- 5섹션 각각을 카드로
- `body=null`이면 "해설 생성 실패 — 새로고침" placeholder
- markdown은 `react-markdown` 으로 렌더

```tsx
import ReactMarkdown from "react-markdown";
import {
  READING_SECTIONS,
  READING_SECTION_LABEL,
  type ReadingSection,
} from "@/entities/saju-chart";

export interface SajuReadingSectionsProps {
  readings: Record<ReadingSection, string | null>;
  errors: Array<{ section: ReadingSection; message: string }>;
}

export function SajuReadingSections({ readings, errors }: SajuReadingSectionsProps) {
  const errorBySection = Object.fromEntries(errors.map((e) => [e.section, e.message]));

  return (
    <div className="flex flex-col gap-6">
      {READING_SECTIONS.map((section) => {
        const body = readings[section];
        const err = errorBySection[section];
        return (
          <section
            key={section}
            aria-labelledby={`reading-${section}`}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h3
              id={`reading-${section}`}
              className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              {READING_SECTION_LABEL[section]}
            </h3>
            {body ? (
              <div className="prose prose-sm max-w-none text-sm text-[var(--color-text)]">
                <ReactMarkdown>{body}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-severity-high)]">
                해설 생성 실패 {err ? `— ${err}` : ""}. 새로고침으로 재시도.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

⚠️ `prose prose-sm`은 Tailwind Typography plugin. 프로젝트에 없으면 제거하고 기본 styling. `pnpm list @tailwindcss/typography` 로 확인. 없으면 plugin 추가 (Task 1과 묶어도 됨) 또는 plain styling만.

- [ ] **Step 2: Tailwind Typography 확인 + 필요 시 plugin 추가**

```
pnpm --filter @gons/dashboard list @tailwindcss/typography
```

없으면 prose 제거하고 직접 spacing:

```tsx
<div className="text-sm leading-relaxed text-[var(--color-text)] [&>p+p]:mt-2 [&>ul]:my-2 [&>ul]:pl-5">
```

- [ ] **Step 3: 커밋**

```
feat(saju): SajuReadingSection — 5섹션 해설 카드

react-markdown 으로 markdown body 렌더. body=null + errors[] 매칭으로
실패 섹션은 "해설 생성 실패" placeholder. aria-labelledby 시맨틱.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 9: SajuDetailHeader + barrel

**Files:**
- Create: `apps/dashboard/src/widgets/saju-detail/ui/SajuDetailHeader.tsx`
- Create: `apps/dashboard/src/widgets/saju-detail/index.ts`

- [ ] **Step 1: SajuDetailHeader.tsx**

```tsx
import Link from "next/link";
import type { FortuneProfile } from "@/entities/fortune-profile";
import { RELATION_LABEL } from "@/entities/fortune-profile";

export interface SajuDetailHeaderProps {
  profile: FortuneProfile;
}

export function SajuDetailHeader({ profile }: SajuDetailHeaderProps) {
  return (
    <header className="mb-8">
      <nav className="mb-3 flex items-center gap-3 text-xs text-[var(--color-text-subtle)]">
        <Link href="/" className="hover:underline">대시보드</Link>
        <span>·</span>
        <Link href="/fortune" className="hover:underline">사주 프로필</Link>
      </nav>
      <h1 className="text-display font-bold tracking-tight">
        {profile.name}
        {profile.nameHanja && (
          <span
            className="ml-2 font-[family-name:var(--font-hanja)] text-[var(--color-text-muted)]"
            lang="ko-Hani"
          >
            {profile.nameHanja}
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {RELATION_LABEL[profile.relation]} · {profile.birthDate}
        {profile.birthTime ? ` ${profile.birthTime}` : " 시각 미상"}
        {" · "}
        {profile.calendar === "solar" ? "양력" : "음력"}
        {" · "}
        {profile.gender === "male" ? "남자" : "여자"}
      </p>
    </header>
  );
}
```

- [ ] **Step 2: index.ts barrel**

```ts
export { SajuDetailHeader } from "./ui/SajuDetailHeader";
export { SajuPillarsBoard } from "./ui/SajuPillarsBoard";
export { SajuElementsChart } from "./ui/SajuElementsChart";
export { SajuTenGodsTable } from "./ui/SajuTenGodsTable";
export { SajuPatternCard } from "./ui/SajuPatternCard";
export { SajuMajorFortuneStrip } from "./ui/SajuMajorFortuneStrip";
export { SajuReadingSections } from "./ui/SajuReadingSection";
```

- [ ] **Step 3: 커밋**

```
feat(saju): SajuDetailHeader + saju-detail barrel

이름·한자·관계·생년월일·달력·성별 헤더 + 백링크 네비. barrel은 7개
컴포넌트 노출.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 10: `/fortune/[profileId]/page.tsx` — RSC 페이지

**Files:**
- Create: `apps/dashboard/src/app/fortune/[profileId]/page.tsx`

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getFortuneProfile } from "@/entities/fortune-profile";
import { ensureChartAndReadings } from "@/features/saju-reading";
import {
  SajuDetailHeader,
  SajuPillarsBoard,
  SajuElementsChart,
  SajuTenGodsTable,
  SajuPatternCard,
  SajuMajorFortuneStrip,
  SajuReadingSections,
} from "@/widgets/saju-detail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ profileId: string }>;
}

function ageFromBirthDate(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const hasHadBirthday =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hasHadBirthday) age -= 1;
  return age;
}

export default async function SajuDetailPage({ params }: PageProps) {
  const { profileId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await getFortuneProfile(profileId);
  if (!profile || profile.userId !== session.user.id) notFound();

  const currentAge = ageFromBirthDate(profile.birthDate);

  const result = await ensureChartAndReadings({
    profileId,
    userId: session.user.id,
    currentAge,
  });
  if (!result) notFound();

  const { chart, readings, errors } = result;

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <SajuDetailHeader profile={profile} />

      <section
        aria-labelledby="pillars-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="pillars-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          사주팔자
        </h2>
        <SajuPillarsBoard chart={chart} />
      </section>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          aria-labelledby="elements-heading"
          className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
        >
          <h2 id="elements-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
            오행 분포
          </h2>
          <SajuElementsChart elements={chart.elements} />
        </section>
        <section
          aria-labelledby="pattern-heading"
          className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
        >
          <h2 id="pattern-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
            격국 · 용신
          </h2>
          <SajuPatternCard
            pattern={chart.pattern}
            strength={chart.strength as never}
            yongSin={chart.yongSin as never}
            giSin={chart.giSin as never}
          />
        </section>
      </div>

      <section
        aria-labelledby="ten-gods-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="ten-gods-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          십신
        </h2>
        <SajuTenGodsTable tenGods={chart.tenGods as never} />
      </section>

      <section
        aria-labelledby="major-fortune-heading"
        className="mb-8 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
      >
        <h2 id="major-fortune-heading" className="mb-4 text-sm font-semibold text-[var(--color-text-muted)]">
          대운 흐름
        </h2>
        <SajuMajorFortuneStrip
          majorFortunes={chart.majorFortunes as never}
          currentAge={currentAge}
        />
      </section>

      <section aria-labelledby="readings-heading" className="mb-8">
        <h2 id="readings-heading" className="mb-4 text-base font-semibold">
          해설
        </h2>
        <SajuReadingSections readings={readings} errors={errors} />
      </section>
    </main>
  );
}
```

⚠️ `as never` 캐스팅: chart의 jsonb 필드(strength, yongSin, giSin, tenGods, majorFortunes)는 Drizzle에서 정확한 enum/타입을 잃을 수 있음. 위젯의 props 타입과 잘 맞추되 필요 시 `as` 캐스팅 사용. 이상적으로는 page에서 한 번 `chart`를 transform 함수로 narrow한 뒤 props로 전달.

⚠️ Next.js 16의 `params`는 `Promise<>`로 변경. `await params` 패턴 필수.

- [ ] **Step 2: 빌드 가능 확인**

```
pnpm --filter @gons/dashboard typecheck
pnpm --filter @gons/dashboard lint
pnpm --filter @gons/dashboard build
```

(build는 next/font/google이 빌드 시점에 폰트 다운로드 시도 — 인터넷 없으면 fail. CI에서는 OK.)

- [ ] **Step 3: 커밋**

```
feat(saju): /fortune/[profileId] 상세 페이지 RSC

ensureChartAndReadings 1회 호출 → 6개 widgets 에 props 분배. ownership
가드 (getFortuneProfile + userId 매칭) 통과 못 하면 notFound. currentAge
는 birthDate 기반 계산.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 11: 진입 동선 — 홈 위젯 + /fortune 페이지

**Files:**
- Modify: `apps/dashboard/src/widgets/fortune/ui/FortuneCardClient.tsx`
- Modify: `apps/dashboard/src/widgets/fortune-profiles/ui/FortuneProfileCard.tsx`

- [ ] **Step 1: FortuneCardClient.tsx** — 기존 헤더의 '관리' 옆에 '상세' 추가

Read the file first, then find the section:
```tsx
<Link
  href="/fortune"
  className="text-xs text-[var(--color-text-subtle)] hover:underline"
  aria-label="사주 프로필 관리"
>
  관리
</Link>
```

Replace with:
```tsx
<div className="flex gap-3 text-xs">
  {selectedId && (
    <Link
      href={`/fortune/${selectedId}`}
      className="text-[var(--color-accent)] hover:underline"
    >
      상세
    </Link>
  )}
  <Link
    href="/fortune"
    className="text-[var(--color-text-subtle)] hover:underline"
    aria-label="사주 프로필 관리"
  >
    관리
  </Link>
</div>
```

- [ ] **Step 2: FortuneProfileCard.tsx** — 각 카드에 '상세보기' 링크 추가

Read first; find existing controls (edit/delete buttons). Add a `상세보기` link near them:

```tsx
<Link
  href={`/fortune/${profile.id}`}
  className="text-xs text-[var(--color-accent)] hover:underline"
>
  상세보기 →
</Link>
```

배치 위치는 카드의 footer 영역(편집·삭제 버튼 옆)으로.

- [ ] **Step 3: typecheck + lint + 커밋**

```
feat(saju): 홈 위젯 + /fortune 카드에 상세 진입 링크

홈 FortuneCard 의 헤더에 '상세' (현재 선택된 프로필 id 사용),
/fortune 페이지 FortuneProfileCard 의 카드 footer 에 '상세보기' 링크.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 12: 최종 게이트 + PR

- [ ] **Step 1: 전체 검증**

```
pnpm typecheck
pnpm --workspace-concurrency=1 lint
pnpm --filter @gons/saju test
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
  pnpm --filter @gons/dashboard test
pnpm --filter @gons/dashboard build
```

Expected: 모두 clean. saju 21/21 + generateReading 3/3 PASS. build 성공 (next/font/google이 빌드 시점에 폰트 받음).

⚠️ build 실패 시 가장 흔한 원인:
- jsonb 필드 narrow 안 됨 → `as` 캐스팅 추가
- react-markdown peer dep 충돌 → `pnpm install --force`
- next/font 빌드 머신에서 인터넷 없음 → CI 에서만 작동

- [ ] **Step 2: push + PR**

```
git push -u origin feat/saju-phase2
gh pr create ...
```

PR body 본문에:
- Summary (6 widgets + 1 page + 2 entry links)
- Spec reference §6, §8
- Test plan (typecheck/lint/build/saju test)
- Screenshot (가능하면 운영 배포 후 추가)
- Next phases (3 세운, 4 궁합 — 별도 spec)

---

## Self-Review 체크리스트

- [ ] **Spec 커버리지**: §6 (라우트 + 6 widgets + 진입 2곳 + 디자인 토큰) ✓, §8 (ownership 가드 RSC + notFound) ✓
- [ ] **Placeholder 스캔**: ⚠️ 외 TBD/TODO 없음
- [ ] **타입 일관성**: `SajuChartRow.tenGods`/`elements`/`yongSin`/`giSin`/`majorFortunes` 등 jsonb 필드를 위젯 props 타입에 맞춰 narrow하는 패턴 — page에서 한 번 정리해 `as` 캐스팅을 최소화하는 게 이상적
- [ ] **함수 시그니처**: 위젯 7개 모두 props 명시 + dumb (props만 받음)
- [ ] **접근성**: `<table>` 시맨틱, `lang="ko-Hani"`, `aria-labelledby`, focus-visible 유지

---

## 메모

- **Phase 2 후속 (별도 spec)**: 세운(년도별 운세), 궁합(프로필 2인 선택)
- jsonb narrow를 깔끔히 하려면 `entities/saju-chart`에 transform 함수 추가 (예: `parseSajuChartRow`) — 이번 PR 범위는 아니나 코드 중복이 보이면 후속 작업
- e2e 테스트(Playwright)는 운영 배포 후 1회 수동 — 사용자 본인 사주(G1 壬辰일주)로 페이지 진입 + 6개 섹션 모두 렌더 + 5섹션 LLM 응답 도착 확인
