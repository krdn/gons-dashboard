# gons-dashboard UI/UX Phase 1 (구조) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공통 UI 프리미티브(Card/WidgetHeader/PageContainer/PageHeader) + (dashboard) 레이아웃 셸 + 확장 사이드바 + 정적 위젯 레지스트리를 도입해, 카드/페이지 스타일 복붙과 위젯 하드코딩을 구조적으로 제거한다. 시각은 거의 그대로 두고 확장성만 확보한다(스코프 C Phase 1).

**Architecture:** 순수 presentational 프리미티브를 `shared/ui`에 추가(이벤트 핸들러 prop 금지 → server·client 양쪽 universal import). `(dashboard)` route group의 RSC layout이 client `ShellLayout` island에 page 트리를 children slot으로 주입(위젯 서버 렌더 유지). 위젯 배치는 `app/_widgets/registry.ts`(server-only)의 선언적 배열로.

**Tech Stack:** Next.js 16 App Router (RSC), TypeScript strict, Tailwind v4, Vitest(node env), @radix-ui/react-dialog(기존).

## Global Constraints

이 섹션은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **토큰 미러 비대칭**: color/text 토큰 = 3곳(`src/shared/config/tokens.ts` + `src/app/globals.css :root` + `globals.css @theme inline`), space/shadow = 2곳(`tokens.ts` + `:root`). 이 플랜은 **기존 토큰만 사용** → 신규 토큰 미러 불요. (신규 토큰은 Phase 2.)
- **md 패딩 표기**: Tailwind `p-5` = 기본 **20px**(토큰 이탈). 24px가 필요하면 반드시 `p-[var(--space-5)]`.
- **FSD 의존성**: app → widgets → features → entities → shared (상위만 하위 참조). entities↔entities 직접 import 금지.
- **server/client seam (Gotcha #7)**: `"use server"` Server Action + server-only 함수 혼재 barrel을 client가 import하면 module-not-found. `pnpm typecheck && lint`로 **못 잡음** → `cd apps/dashboard && pnpm build` 필수.
- **RSC 보존**: 위젯 대부분 async server component. `"use client"`를 프리미티브/레지스트리에 붙이지 말 것.
- **라이트모드 고정**: `globals.css`의 `@variant dark` 차단 불변. 신규 색 금지(Phase 1).
- **테스트 파일 위치 (블로커)**: vitest `include`는 `src/**/*.test.ts`만 포함(`.test.tsx` 미포함). **JSX를 렌더하는 테스트는 반드시 `tests/` 아래 `.test.tsx`로 작성**(`tests/**/*.test.tsx`는 glob 포함). JSX 없는 로직 테스트는 `src` 옆 `.test.ts` 가능.
- **검증 명령**: `cd apps/dashboard && pnpm typecheck && pnpm lint`. seam 위험 태스크는 `pnpm build` 추가. 테스트는 `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`(DB 미연결 통합 13개 ECONNREFUSED는 정상).
- **커밋 메시지**: 한국어, conventional commits(feat/refactor/docs). attribution은 settings에서 비활성.

---

## File Structure

**신규:**
- `apps/dashboard/src/shared/ui/Card.tsx` — 순수 표면 프리미티브
- `apps/dashboard/src/shared/ui/WidgetHeader.tsx` — 위젯 헤더 DRY
- `apps/dashboard/src/shared/ui/PageContainer.tsx` — 라우트 컨테이너
- `apps/dashboard/src/shared/ui/PageHeader.tsx` — 페이지 제목
- `apps/dashboard/tests/shared-ui/Card.test.tsx` — Card padding 매핑 회귀 가드
- `apps/dashboard/src/shared/config/navigation.ts` — NAV_ITEMS 데이터(JSX 없음)
- `apps/dashboard/src/widgets/app-shell/ShellLayout.tsx` — client island(collapse + slot)
- `apps/dashboard/src/widgets/app-shell/Sidebar.tsx` — client(usePathname 하이라이트)
- `apps/dashboard/src/widgets/app-shell/navIcon.tsx` — NavIconKey → 아이콘 map(client)
- `apps/dashboard/src/widgets/app-shell/index.ts` — barrel
- `apps/dashboard/src/app/(dashboard)/layout.tsx` — RSC 셸 layout
- `apps/dashboard/src/app/_widgets/registry.ts` — 정적 위젯 레지스트리(server-only)
- `apps/dashboard/src/app/_widgets/renderEntry.tsx` — Suspense/Fragment 분기 헬퍼
- `apps/dashboard/src/app/_widgets/renderEntry.test.ts` — 분기 로직 테스트(JSX 없음)

**이동(파일 내용 유지, 경로만):**
- `app/page.tsx stocks/ skills/ fortune/ tiger/ servers/` → `app/(dashboard)/` 하위

**수정:**
- `apps/dashboard/src/shared/ui/icons.tsx` — 네비 아이콘 6종 추가
- 각 라우트 `page.tsx` — PageContainer/PageHeader 적용, redirect `/login` 통일
- `apps/dashboard/src/app/(dashboard)/page.tsx` — 메인을 레지스트리 map으로

---

## Task 1: Card 프리미티브 + padding 회귀 테스트

**Files:**
- Create: `apps/dashboard/src/shared/ui/Card.tsx`
- Test: `apps/dashboard/tests/shared-ui/Card.test.tsx`

**Interfaces:**
- Produces: `Card` 컴포넌트. props `{ as?: "article"|"div"; padding?: "sm"|"md"|"lg"; tone?: "default"|"accent"|"dashed"; className?: string; "aria-labelledby"?: string; "aria-label"?: string; children: React.ReactNode }`.

- [ ] **Step 1: 실패 테스트 작성** (JSX 렌더 → tests/ 아래, renderToStaticMarkup으로 node env 동작)

`apps/dashboard/tests/shared-ui/Card.test.tsx`:
```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Card } from "@/shared/ui/Card";

describe("Card padding 매핑", () => {
  it("md는 p-[var(--space-5)] (=24px, p-5≠24px 회귀 가드)", () => {
    const html = renderToStaticMarkup(<Card padding="md">x</Card>);
    expect(html).toContain("p-[var(--space-5)]");
    expect(html).not.toContain(" p-5"); // Tailwind 기본 20px 이탈 방지
  });

  it("sm=p-4, lg=p-6", () => {
    expect(renderToStaticMarkup(<Card padding="sm">x</Card>)).toContain("p-4");
    expect(renderToStaticMarkup(<Card padding="lg">x</Card>)).toContain("p-6");
  });

  it("기본 표면 클래스(rounded + hairline + surface)를 항상 포함", () => {
    const html = renderToStaticMarkup(<Card>x</Card>);
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-[var(--color-hairline)]");
    expect(html).toContain("bg-[var(--color-surface)]");
  });

  it("tone=dashed는 점선 경계, as=article은 article 태그", () => {
    expect(renderToStaticMarkup(<Card tone="dashed">x</Card>)).toContain("border-dashed");
    expect(renderToStaticMarkup(<Card as="article">x</Card>)).toMatch(/^<article/);
  });

  it("className escape-hatch를 병합한다", () => {
    expect(renderToStaticMarkup(<Card className="border-l-2">x</Card>)).toContain("border-l-2");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- Card.test`
Expected: FAIL — `Cannot find module '@/shared/ui/Card'` 또는 export 없음.

- [ ] **Step 3: Card 구현** (`"use client"` 없음 — 순수 presentational)

`apps/dashboard/src/shared/ui/Card.tsx`:
```tsx
// 공통 카드 표면 프리미티브 — 순수 presentational (이벤트 핸들러 prop 없음 → server·client universal).
// 위계·크기 대비는 소비 위젯 책임. 이 컴포넌트는 surface/hairline 토큰만 제공한다(thin wrapper).
import { type ReactNode } from "react";

interface CardProps {
  as?: "article" | "div";
  padding?: "sm" | "md" | "lg";
  tone?: "default" | "accent" | "dashed";
  className?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  children: ReactNode;
}

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  sm: "p-4",
  md: "p-[var(--space-5)]", // 24px — Tailwind p-5는 기본 20px이라 토큰 이탈
  lg: "p-6",
};

const TONE: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-[var(--color-hairline)] bg-[var(--color-surface)]",
  accent:
    "border-[var(--color-hairline)] bg-[var(--color-surface)] ring-1 ring-[var(--color-accent)]/20",
  dashed:
    "border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)]",
};

export function Card({
  as = "div",
  padding = "md",
  tone = "default",
  className = "",
  children,
  ...a11y
}: CardProps) {
  const Tag = as;
  const cls = `rounded-xl border ${TONE[tone]} ${PADDING[padding]} ${className}`.trim();
  return (
    <Tag className={cls} {...a11y}>
      {children}
    </Tag>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- Card.test`
Expected: PASS (5 tests).

- [ ] **Step 5: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/shared/ui/Card.tsx apps/dashboard/tests/shared-ui/Card.test.tsx
git commit -m "feat: Card 공통 표면 프리미티브 + padding 회귀 테스트"
```

---

## Task 2: WidgetHeader 프리미티브

**Files:**
- Create: `apps/dashboard/src/shared/ui/WidgetHeader.tsx`

**Interfaces:**
- Produces: `WidgetHeader` 컴포넌트. props `{ title: string; titleId: string; count?: number; meta?: string; headerSlot?: React.ReactNode; children?: React.ReactNode }`.

- [ ] **Step 1: WidgetHeader 구현** (`"use client"` 없음. headerSlot은 element prop이라 seam 안전)

`apps/dashboard/src/shared/ui/WidgetHeader.tsx`:
```tsx
// 위젯 헤더 DRY 단위 — 제목 + count(tabular-nums 배지) + meta + 우측 액션 슬롯.
// headerSlot은 element prop(import 아님) → client 컴포넌트 주입해도 Gotcha #7 무관.
import { type ReactNode } from "react";

interface WidgetHeaderProps {
  title: string;
  titleId: string;
  count?: number;
  meta?: string;
  headerSlot?: ReactNode;
  children?: ReactNode;
}

export function WidgetHeader({
  title,
  titleId,
  count,
  meta,
  headerSlot,
  children,
}: WidgetHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2
        id={titleId}
        className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
      >
        <span>{title}</span>
        {count !== undefined && (
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {count}
          </span>
        )}
        {meta && (
          <span className="text-xs font-normal text-[var(--color-text-muted)]">
            {meta}
          </span>
        )}
        {children}
      </h2>
      {headerSlot}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 0.

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/shared/ui/WidgetHeader.tsx
git commit -m "feat: WidgetHeader 위젯 헤더 프리미티브"
```

---

## Task 3: PageContainer + PageHeader 프리미티브

**Files:**
- Create: `apps/dashboard/src/shared/ui/PageContainer.tsx`
- Create: `apps/dashboard/src/shared/ui/PageHeader.tsx`

**Interfaces:**
- Produces:
  - `PageContainer` props `{ width?: "default"|"narrow"; children: React.ReactNode }` (default=1240, narrow=900)
  - `PageHeader` props `{ title: string; subtitle?: string; actions?: React.ReactNode }`

- [ ] **Step 1: PageContainer 구현**

`apps/dashboard/src/shared/ui/PageContainer.tsx`:
```tsx
// 라우트 공통 컨테이너 — 폭 variant(default 1240 / narrow 900).
import { type ReactNode } from "react";

interface PageContainerProps {
  width?: "default" | "narrow";
  children: ReactNode;
}

const WIDTH: Record<NonNullable<PageContainerProps["width"]>, string> = {
  default: "max-w-[1240px]",
  narrow: "max-w-[900px]",
};

export function PageContainer({ width = "default", children }: PageContainerProps) {
  return (
    <div className={`mx-auto w-full ${WIDTH[width]} px-6 py-12`}>{children}</div>
  );
}
```

- [ ] **Step 2: PageHeader 구현** (back-link 없음 — 사이드바가 대체)

`apps/dashboard/src/shared/ui/PageHeader.tsx`:
```tsx
// 페이지 제목 헤더 — title + subtitle + 우측 actions 슬롯.
import { type ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-display font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 0.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/shared/ui/PageContainer.tsx apps/dashboard/src/shared/ui/PageHeader.tsx
git commit -m "feat: PageContainer + PageHeader 라우트 프리미티브"
```

---

## Task 4: 파일럿 마이그레이션 — EmailDigestCard로 프리미티브 실소비 검증

> **목적**: 프리미티브 API가 "소비자 0" 리스크를 안 지도록, 첫 실소비자로 검증한다(advisor: PR1 직후 실위젯 1개). EmailDigestCard는 WidgetHeader 흡수 1순위(글자단위 복붙 헤더 + EmailSettingsDialog headerSlot).

**Files:**
- Modify: `apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx`

**Interfaces:**
- Consumes: `WidgetHeader` (Task 2). EmailDigestCard는 표면 없는 `<section>`이라 Card는 안 씀(헤더만 흡수).

- [ ] **Step 1: 현재 파일 확인**

Run: `cat apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx`
헤더 블록(`<div className="mb-4 flex items-center justify-between">` ~ `</div>`)이 WidgetHeader와 1:1 대응함을 확인.

- [ ] **Step 2: WidgetHeader로 헤더 교체**

`EmailDigestCard.tsx`의 import에 추가:
```tsx
import { WidgetHeader } from "@/shared/ui/WidgetHeader";
```

헤더 블록 전체(제목 h2 + count + meta + EmailSettingsDialog 래퍼 div)를 다음으로 교체:
```tsx
      <WidgetHeader
        title="답장 필요"
        titleId="reply-needed-heading"
        count={items.length}
        meta={`최근 ${settings.windowDays}일`}
        headerSlot={<EmailSettingsDialog initial={settings} />}
      />
```
> `<section aria-labelledby="reply-needed-heading">`는 그대로 둔다(titleId가 연결 유지).

- [ ] **Step 3: typecheck + lint + build (seam 검증 — client EmailSettingsDialog를 element prop으로)**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: 전부 통과. build가 통과하면 headerSlot element-prop 주입이 seam-clean임이 확정.

- [ ] **Step 4: 시각 동등 확인** (dev 서버 또는 기존 스냅샷 — 헤더 마크업이 동일 클래스를 내는지 육안)

Run: `cd apps/dashboard && grep -n "WidgetHeader" src/widgets/email-digest/ui/EmailDigestCard.tsx`
Expected: import + 사용 각 1건. (시각 회귀 자동망 없음 → 실제 렌더는 Task 후 dev에서 1회 확인 권장.)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/email-digest/ui/EmailDigestCard.tsx
git commit -m "refactor: EmailDigestCard 헤더를 WidgetHeader로 — 프리미티브 첫 실소비"
```

---

## Task 5: 네비 아이콘 6종 + navigation.ts 데이터

**Files:**
- Modify: `apps/dashboard/src/shared/ui/icons.tsx` (끝에 추가)
- Create: `apps/dashboard/src/shared/config/navigation.ts`

**Interfaces:**
- Produces:
  - icons.tsx: `HomeIcon`, `ChartIcon`, `SkillIcon`, `FortuneIcon`, `TigerIcon`, `ServerIcon` (각 `{ size?, className? }`)
  - navigation.ts: `type NavIconKey = "home"|"chart"|"skill"|"fortune"|"tiger"|"server"`, `interface NavItem { href; label; icon: NavIconKey }`, `export const NAV_ITEMS: NavItem[]`

- [ ] **Step 1: 네비 아이콘 추가** (기존 `svgProps(size)` 패턴 재사용 — icons.tsx 끝에 append)

`apps/dashboard/src/shared/ui/icons.tsx` 끝에:
```tsx
export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function ChartIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 4-5" />
    </svg>
  );
}

export function SkillIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4z" />
    </svg>
  );
}

export function FortuneIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function TigerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01M9 15c1 1 5 1 6 0" />
    </svg>
  );
}

export function ServerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}
```

- [ ] **Step 2: navigation.ts 작성** (JSX 없음 — server·client 양쪽 import 안전. icon은 string key)

`apps/dashboard/src/shared/config/navigation.ts`:
```ts
// 글로벌 네비게이션 데이터 (순수 — JSX/client 의존 없음).
// 신규 라우트 추가 = 여기 한 줄 + icons.tsx 아이콘 1개 + navIcon.tsx 매핑 1줄.
export type NavIconKey =
  | "home"
  | "chart"
  | "skill"
  | "fortune"
  | "tiger"
  | "server";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/stocks", label: "주식", icon: "chart" },
  { href: "/skills", label: "스킬", icon: "skill" },
  { href: "/fortune", label: "운세", icon: "fortune" },
  { href: "/tiger", label: "호상담", icon: "tiger" },
  { href: "/servers", label: "서버", icon: "server" },
];
```
> ⚠️ `/servers` 인덱스 라우트가 없으면(현재 `servers/[hostName]`만 존재 가능) NAV_ITEMS에서 그 줄을 빼거나, Task 8에서 인덱스 page를 함께 만든다. Step 3에서 확인.

- [ ] **Step 3: /servers 인덱스 라우트 존재 확인**

Run: `ls apps/dashboard/src/app/servers/ 2>/dev/null; ls apps/dashboard/src/app/\(dashboard\)/servers/ 2>/dev/null`
Expected에 따라: `page.tsx` 없으면 NAV_ITEMS의 `/servers` 줄을 주석 처리(YAGNI — 인덱스 라우트 신설은 범위 밖).

- [ ] **Step 4: typecheck + lint**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: 에러 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/shared/ui/icons.tsx apps/dashboard/src/shared/config/navigation.ts
git commit -m "feat: 네비 아이콘 6종 + navigation.ts 선언적 네비 데이터"
```

---

## Task 6: app-shell — Sidebar + navIcon + ShellLayout (client islands)

**Files:**
- Create: `apps/dashboard/src/widgets/app-shell/navIcon.tsx`
- Create: `apps/dashboard/src/widgets/app-shell/Sidebar.tsx`
- Create: `apps/dashboard/src/widgets/app-shell/ShellLayout.tsx`
- Create: `apps/dashboard/src/widgets/app-shell/index.ts`

**Interfaces:**
- Consumes: `NAV_ITEMS`, `NavIconKey` (Task 5); 네비 아이콘들 (Task 5).
- Produces: `ShellLayout` props `{ initialCollapsed: boolean; children: React.ReactNode }`. `index.ts`가 `ShellLayout` export.

- [ ] **Step 1: navIcon.tsx** (string key → 아이콘 컴포넌트 map. client — JSX 포함)

`apps/dashboard/src/widgets/app-shell/navIcon.tsx`:
```tsx
"use client";
import {
  HomeIcon,
  ChartIcon,
  SkillIcon,
  FortuneIcon,
  TigerIcon,
  ServerIcon,
} from "@/shared/ui/icons";
import { type NavIconKey } from "@/shared/config/navigation";

const MAP: Record<NavIconKey, (p: { size?: number; className?: string }) => React.ReactNode> = {
  home: HomeIcon,
  chart: ChartIcon,
  skill: SkillIcon,
  fortune: FortuneIcon,
  tiger: TigerIcon,
  server: ServerIcon,
};

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  const Cmp = MAP[icon];
  return <Cmp size={18} className={className} />;
}
```

- [ ] **Step 2: Sidebar.tsx** (client — usePathname 활성 하이라이트)

`apps/dashboard/src/widgets/app-shell/Sidebar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/shared/config/navigation";
import { NavIcon } from "./navIcon";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주요 메뉴"
      className="flex flex-col gap-1 p-3"
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <NavIcon icon={item.icon} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: ShellLayout.tsx** (client island — collapse state + 사이드바 + slot. 토글은 쿠키 직접 갱신)

`apps/dashboard/src/widgets/app-shell/ShellLayout.tsx`:
```tsx
"use client";
import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";

const COOKIE = "sidebar_collapsed";

export function ShellLayout({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // 1년 유지. Server Action 라운드트립 불요 — 다음 SSR이 이 쿠키로 초기값 결정.
    document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex min-h-full">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-[var(--color-hairline)] bg-[var(--color-surface)] transition-[width] md:flex md:flex-col ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div className="flex items-center justify-between p-3">
          {!collapsed && (
            <span className="px-2 text-sm font-bold tracking-tight">
              gons<span className="text-[var(--color-accent)]">.</span>
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
            className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
        <Sidebar collapsed={collapsed} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: index.ts barrel**

`apps/dashboard/src/widgets/app-shell/index.ts`:
```ts
export { ShellLayout } from "./ShellLayout";
```

- [ ] **Step 5: typecheck + lint + build (seam 1급 노출점 — client island)**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: 전부 통과. (이 시점엔 ShellLayout이 아직 layout에 안 붙어 dead code지만, 컴파일 무결성 확인.)

- [ ] **Step 6: 커밋**

```bash
git add apps/dashboard/src/widgets/app-shell/
git commit -m "feat: app-shell — 확장 사이드바 client island (collapse=쿠키)"
```

---

## Task 7: (dashboard) route group layout + 라우트 이동

> **주의(되돌리기 어려운 단계)**: 라우트 디렉토리를 `git mv`로 옮긴다. 한 번에 하고 build로 검증.

**Files:**
- Create: `apps/dashboard/src/app/(dashboard)/layout.tsx`
- Move: `app/page.tsx`, `app/stocks/`, `app/skills/`, `app/fortune/`, `app/tiger/`, (`app/servers/` 있으면) → `app/(dashboard)/` 하위

**Interfaces:**
- Consumes: `ShellLayout` (Task 6).

- [ ] **Step 1: 현재 app 라우트 구조 확인**

Run: `ls apps/dashboard/src/app/`
이동 대상(page.tsx + 도메인 디렉토리) 식별. `login/`, `api/`, `globals.css`, `layout.tsx`, `favicon.ico`는 **이동 안 함**.

- [ ] **Step 2: route group 디렉토리 생성 + git mv**

```bash
cd apps/dashboard/src/app
mkdir "(dashboard)"
git mv page.tsx "(dashboard)/page.tsx"
git mv stocks "(dashboard)/stocks"
git mv skills "(dashboard)/skills"
git mv fortune "(dashboard)/fortune"
git mv tiger "(dashboard)/tiger"
# servers 디렉토리가 있으면:
test -d servers && git mv servers "(dashboard)/servers"
```

- [ ] **Step 3: (dashboard)/layout.tsx 작성** (RSC — cookies()로 collapse 초기값, auth 가드 없음)

`apps/dashboard/src/app/(dashboard)/layout.tsx`:
```tsx
// 인증 셸 그룹의 RSC layout. cookies()로 사이드바 collapse 초기값을 읽어
// client ShellLayout에 주입(hydration flash 회피). page 트리는 children slot으로
// 주입되어 서버 렌더 유지(위젯 postgres 의존 무손상).
// auth 가드는 넣지 않는다 — 공유 layout은 soft-nav에서 재렌더 안 됨(per-page redirect 유지).
import { cookies } from "next/headers";
import { ShellLayout } from "@/widgets/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = (await cookies()).get("sidebar_collapsed")?.value === "1";
  return <ShellLayout initialCollapsed={collapsed}>{children}</ShellLayout>;
}
```

- [ ] **Step 4: build (라우트 이동 + 셸 결합 — 가장 위험한 검증)**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: 전부 통과. 빌드 출력에 `/`, `/stocks`, `/skills`, `/fortune`, `/tiger` 라우트가 여전히 같은 경로로 등록됨(route group은 URL 세그먼트 0개).

- [ ] **Step 5: 커밋**

```bash
git add -A apps/dashboard/src/app/
git commit -m "feat: (dashboard) route group 셸 layout + 라우트 이동"
```

---

## Task 8: 각 라우트 page를 PageContainer/PageHeader로 정리 + redirect 통일

**Files:**
- Modify: `app/(dashboard)/skills/page.tsx`, `stocks/page.tsx`, `fortune/page.tsx`, `tiger/page.tsx`

**Interfaces:**
- Consumes: `PageContainer`, `PageHeader` (Task 3).

- [ ] **Step 1: skills/page.tsx 정리** (back-link 제거 — 사이드바가 대체)

`<main className="mx-auto w-full max-w-[1240px] px-6 py-12">` ~ `</main>`을:
```tsx
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";
// ... (Link import는 back-link 제거로 불필요해지면 삭제)

return (
  <PageContainer>
    <PageHeader
      title="Claude Code 스킬"
      subtitle={`설치된 스킬의 사용법과 출처를 살펴봅니다 (${skills.length}개).`}
    />
    <SkillCatalog skills={skills} />
  </PageContainer>
);
```

- [ ] **Step 2: stocks/page.tsx 정리** (제목이 `text-[28px] md:text-display`였음 → PageHeader가 text-display 통일)

```tsx
return (
  <PageContainer>
    <PageHeader
      title="주식 타임프레임 분석"
      subtitle="한국·미국 종목을 페르소나 × 장/중/단기 관점으로 분석합니다 (예: 삼성전자, AAPL · powered by tickerlens)"
    />
    <StocksView initialHistory={history} />
  </PageContainer>
);
```

- [ ] **Step 3: fortune/page.tsx 정리** (narrow 폭 + back-link 제거)

```tsx
return (
  <PageContainer width="narrow">
    <PageHeader title={/* 기존 title */} subtitle={/* 기존 subtitle */} />
    {/* 기존 본문 */}
  </PageContainer>
);
```
> 기존 title/subtitle 텍스트는 `cat`으로 확인 후 그대로 옮긴다.

- [ ] **Step 4: tiger/page.tsx 정리 + redirect 통일** (토큰 이탈 `text-gray-*`/`bg-white`는 Phase 2 PR2b — 여기선 컨테이너/헤더만)

tiger의 `<main className="mx-auto max-w-3xl ...">` → `<PageContainer width="narrow">`, `<header>` → `<PageHeader>`. 그리고 redirect 타깃이 `/api/auth/signin`이면 `/login`으로:
```bash
grep -n "redirect\|signin" apps/dashboard/src/app/\(dashboard\)/tiger/page.tsx
```
발견되는 `/api/auth/signin` → `/login`으로 교체.
> ⚠️ tiger 본문의 `text-gray-600`/`bg-white`/amber는 **이 태스크에서 건드리지 않음**(Phase 2). 컨테이너+헤더+redirect만.

- [ ] **Step 5: typecheck + lint + build**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: 전부 통과. 사용 안 하는 `Link` import 등 orphan은 제거(내 변경이 만든 orphan만).

- [ ] **Step 6: 커밋**

```bash
git add -A apps/dashboard/src/app/
git commit -m "refactor: 라우트 page를 PageContainer/PageHeader로 정리 + redirect /login 통일"
```

---

## Task 9: 정적 위젯 레지스트리 + renderEntry + 메인 page 적용

**Files:**
- Create: `apps/dashboard/src/app/_widgets/registry.ts`
- Create: `apps/dashboard/src/app/_widgets/renderEntry.tsx`
- Create: `apps/dashboard/src/app/_widgets/renderEntry.test.ts`
- Modify: `apps/dashboard/src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: 위젯 배럴들(`@/widgets/email-digest` 등).
- Produces: `type WidgetEntry`, `WIDGET_REGISTRY: WidgetEntry[]`, `renderEntry(entry): React.ReactNode`.

- [ ] **Step 1: renderEntry 분기 테스트 작성** (JSX 없음 → src 옆 `.test.ts`, glob 통과. element type만 검사)

`apps/dashboard/src/app/_widgets/renderEntry.test.ts`:
```ts
import { Suspense, Fragment } from "react";
import { describe, it, expect } from "vitest";
import { renderEntry } from "./renderEntry";

const Dummy = () => null;
const DummySkel = () => null;

describe("renderEntry 분기", () => {
  it("Skeleton 있으면 Suspense로 감싼다", () => {
    const el = renderEntry({ id: "a", column: "main", Component: Dummy, Skeleton: DummySkel }) as any;
    expect(el.type).toBe(Suspense);
  });

  it("Skeleton 없으면 Fragment(keyed)로 렌더", () => {
    const el = renderEntry({ id: "b", column: "main", Component: Dummy }) as any;
    expect(el.type).toBe(Fragment);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- renderEntry`
Expected: FAIL — module 없음.

- [ ] **Step 3: registry.ts 작성** (server-only — client import 시 build 실패 = seam 조기 검출)

`apps/dashboard/src/app/_widgets/registry.ts`:
```ts
import "server-only";
import { type ReactNode } from "react";
import { EmailDigestCard, EmailDigestSkeleton } from "@/widgets/email-digest";
import { ImportantEmailsCard, ImportantEmailsSkeleton } from "@/widgets/important-emails";
import { ServerOverviewCard, ServerOverviewSkeleton } from "@/widgets/server-overview";
import { StockAnalysisCard, StockAnalysisSkeleton } from "@/widgets/stock-analysis";
import { AutopilotCard, AutopilotSkeleton } from "@/widgets/autopilot";
import { FortuneCard, FortuneSkeleton } from "@/widgets/fortune";
import { CalendarCard, CalendarSkeleton } from "@/widgets/calendar";
import { SupplementCheckerCard } from "@/widgets/supplement-checker";

export interface WidgetEntry {
  id: string;
  column: "main" | "aside";
  Component: (props?: never) => ReactNode | Promise<ReactNode>;
  Skeleton?: () => ReactNode;
}

// 배열 위치 = 렌더 순서. column = 좌(main 7fr) / 우(aside 4fr).
export const WIDGET_REGISTRY: WidgetEntry[] = [
  { id: "email-digest", column: "main", Component: EmailDigestCard, Skeleton: EmailDigestSkeleton },
  { id: "important-emails", column: "main", Component: ImportantEmailsCard, Skeleton: ImportantEmailsSkeleton },
  { id: "server-overview", column: "main", Component: ServerOverviewCard, Skeleton: ServerOverviewSkeleton },
  { id: "stock-analysis", column: "main", Component: StockAnalysisCard, Skeleton: StockAnalysisSkeleton },
  { id: "autopilot", column: "main", Component: AutopilotCard, Skeleton: AutopilotSkeleton },
  { id: "fortune", column: "aside", Component: FortuneCard, Skeleton: FortuneSkeleton },
  { id: "calendar", column: "aside", Component: CalendarCard, Skeleton: CalendarSkeleton },
  { id: "supplement-checker", column: "aside", Component: SupplementCheckerCard },
];
```

- [ ] **Step 4: renderEntry.tsx 작성**

`apps/dashboard/src/app/_widgets/renderEntry.tsx`:
```tsx
import { Suspense, Fragment, createElement, type ReactNode } from "react";
import { type WidgetEntry } from "./registry";

export function renderEntry(entry: WidgetEntry): ReactNode {
  const body = createElement(entry.Component);
  if (entry.Skeleton) {
    return createElement(
      Suspense,
      { key: entry.id, fallback: createElement(entry.Skeleton) },
      body,
    );
  }
  return createElement(Fragment, { key: entry.id }, body);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test -- renderEntry`
Expected: PASS (2 tests).

- [ ] **Step 6: 메인 page.tsx를 레지스트리 map으로** (Link 카드 2개·Tasks·footer는 인라인 유지)

`app/(dashboard)/page.tsx`의 위젯 나열 블록(좌 컬럼 Suspense들 / 우 컬럼 Suspense들)을 레지스트리 map으로 교체:
```tsx
import { PageContainer } from "@/shared/ui/PageContainer";
import { WIDGET_REGISTRY } from "@/app/_widgets/registry";
import { renderEntry } from "@/app/_widgets/renderEntry";
// ... 기존 auth/greeting/Link/PushSubscribeButton import 유지

const mainWidgets = WIDGET_REGISTRY.filter((w) => w.column === "main");
const asideWidgets = WIDGET_REGISTRY.filter((w) => w.column === "aside");

// 그리드 내부:
<div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
  <div className="flex flex-col gap-10">
    {mainWidgets.map(renderEntry)}
    {/* 기존 Link 카드 2개(주식/스킬) 그대로 인라인 유지 */}
  </div>
  <aside aria-label="우측 위젯" className="flex flex-col gap-4">
    {asideWidgets.map(renderEntry)}
    {/* 기존 Tasks placeholder 인라인 유지 */}
  </aside>
</div>
```
> ⚠️ greeting/header/footer(PushSubscribeButton)와 `<main>`은 그대로. `<main className="mx-auto w-full max-w-[1240px] ...">`는 PageContainer로 바꿔도 되고 유지해도 됨 — 메인은 greeting 등 커스텀이 많으니 **PageContainer로 감싸되 header/greeting/footer는 children으로 유지**.

- [ ] **Step 7: typecheck + lint + build (레지스트리가 server-only로 client 누수 차단되는지)**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: 전부 통과. 빌드가 통과하면 레지스트리가 server tree 단독임이 확정.

- [ ] **Step 8: 커밋**

```bash
git add apps/dashboard/src/app/_widgets/ apps/dashboard/src/app/\(dashboard\)/page.tsx
git commit -m "feat: 정적 위젯 레지스트리 + renderEntry — 메인 page 선언적 배치"
```

---

## Task 10: 전체 검증 + 정리

- [ ] **Step 1: 전체 검증 스택**

Run:
```bash
cd apps/dashboard
pnpm typecheck && pnpm lint && pnpm build
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test
```
Expected: typecheck/lint/build 통과. test는 신규 Card/renderEntry 통과 + 기존 통과(DB 통합 13개 ECONNREFUSED는 정상).

- [ ] **Step 2: dev 서버 육안 확인** (시각 회귀 자동망 부재 → 수동 1회)

Run: `cd apps/dashboard && pnpm dev` 후 `http://localhost:3020`:
- 사이드바 표시 + 접힘/펼침 토글 동작
- 새로고침 시 collapse 상태 유지(쿠키)
- 각 라우트(/, /stocks, /skills, /fortune, /tiger) 이동 + 활성 하이라이트
- 메인 위젯들이 이전과 동일 배치로 렌더(레지스트리)
- 비로그인 시 /login redirect 유지

- [ ] **Step 3: 워킹트리 청결 확인** (staged-edit-lost 회귀 방지)

Run: `git status && git diff HEAD --stat`
Expected: 미커밋 변경 없음(이 작업 분). 무관 변경(redis/client.ts 등)은 그대로 둠.

- [ ] **Step 4: PR 생성** (사용자 확인 후 — push는 비가역)

> ⚠️ push/PR 생성 전 사용자 확인. 브랜치는 `feat/ui-ux-shell-primitives` (현재 skill-catalog 브랜치와 분리 권장).

---

## 후속 (이 플랜 범위 밖)

- **위젯 batch 마이그레이션 (PR5+)**: Task 4(EmailDigestCard)가 worked example. 나머지 위젯(server-overview/autopilot/calendar/fortune/saju-tri ×4/tiger-cards/...)을 같은 패턴으로 Card/WidgetHeader 적용. 슬라이스 단위 병렬, 각 슬라이스 후 build. → **별도 플랜**(18개 enumerate 회피).
- **Phase 2 시각 진화**: 토큰 신설(displayXl/space-9/shadow-cardHover/chart-2,3/severity-*-soft) + 모션(fade-up) + /tiger 토큰 이탈 정리(PR2b) + editorial 구성. → **별도 스펙·플랜**(스펙 §3).

---

## Self-Review

- **Spec 커버리지**: §2.1 프리미티브(Task 1~3) ✓, §2.2 셸+사이드바(Task 5~7) ✓, §2.3 레지스트리(Task 9) ✓, §2.4 토큰 고립 정리 → Task 4가 EmailDigest만 → **나머지 bg-white 고립 치환은 후속 batch에 포함**(이 플랜은 foundation+파일럿). §2.2 redirect /login 통일(Task 8 tiger) ✓. PageContainer width variant(Task 3) ✓.
- **Placeholder**: 모든 코드 step에 실제 코드 포함. fortune title/subtitle만 "기존 텍스트 확인 후 이동"(실텍스트가 파일에 있어 안전).
- **타입 일관성**: `WidgetEntry`(Task 9)의 `Component`/`Skeleton` 시그니처가 registry·renderEntry·test에서 일치. `NavIconKey`(Task 5)가 navigation.ts·navIcon.tsx 일치. `ShellLayout` props `initialCollapsed`가 Task 6·7 일치.
