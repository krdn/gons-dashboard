# gons-dashboard UI/UX 재설계 — 설계 스펙

**날짜**: 2026-06-28
**브랜치(예정)**: `feat/ui-ux-shell-primitives` 외 (PR 단위 분기)
**상태**: 설계 승인 대기
**근거 분석**: 13-에이전트 읽기전용 Workflow (6차원 분석 → 어드버사리얼 검증 → 종합, 1.1M 토큰). 검증 단계에서 분석의 사실 오류 3건 교정.

---

## 0. 사용자 승인 결정 (brainstorming)

| 분기 | 선택 |
|------|------|
| 스코프 | **C** — Phase 1 구조 → Phase 2 시각 (순차) |
| 트렌드 방향 | **기존 정체성 진화** (Swiss/editorial 심화, light 고정, 다크모드 추가 안 함) |
| 네비게이션 | **확장 사이드바** (접힘) |
| 위젯 배치 | **정적 레이아웃 설정** (선언적, 순수 RSC) |
| banned 가드레일 | **사이드바 유지 + editorial 가드레일** (균일 카드 그리드 금지, 위계 대비 필수, surface 절제, 사이드바=기능적) |

---

## 1. 개요

현재 대시보드는 디자인 토큰(OKLCH 색공간, 4px 그리드)이 이미 견고하다. 진짜 확장성 약점은 셋:
1. **공통 Card 프리미티브 부재** — 30개 `.tsx`가 `rounded-xl border ... bg-white p-4` 골격 복붙 (위젯 슬라이스 기준 18개). `bg-white`는 토큰(`--color-surface`) 이탈.
2. **글로벌 레이아웃 셸·네비 부재** — 5개 라우트가 `<main>`+`<header>` 복붙, /tiger는 `text-gray-600`/`bg-white`로 토큰 완전 이탈.
3. **위젯이 page.tsx 하드코딩** — 신규 도메인 추가 시 매번 수동 배선.

이 스펙은 견고한 토큰 시스템은 **건드리지 않고**, 위 3개 약점을 구조적으로 해소한 뒤(Phase 1), 그 위에 editorial 시각 진화를 칠한다(Phase 2).

### 불가침 제약 (전 섹션 관통)

- **토큰 단일출처 미러 — touch-point 비대칭**: color/text 토큰 = 3곳(`tokens.ts` + `globals.css :root` + `@theme inline`), space/shadow 토큰 = 2곳(`tokens.ts` + `:root`, `@theme inline` 미매핑 → `var()` 직접 소비).
- **FSD 의존성**: app → widgets → features → entities → shared. entities↔entities 직접 import 금지.
- **server/client seam (Gotcha #7)**: `"use server"` Server Action + server-only 함수 혼재 barrel → client import 시 module-not-found. `pnpm typecheck && lint`로 **못 잡음** → `cd apps/dashboard && pnpm build` 필수.
- **RSC 보존**: 위젯 대부분 async server component. client 전환 시 postgres 의존 끊김.
- **라이트모드 고정**: `globals.css`의 `@variant dark (&:where(.dark,.dark *))` 차단 불변. 신규 색은 OKLCH 저채도.

---

## 2. Phase 1 — 구조 (확정 아키텍처)

### 2.1 공통 프리미티브 — Card + WidgetHeader

두 관심사를 **분리**한다 (compound 컴포넌트 기각 — 헤더 변이가 너무 커서 단일 Header 슬롯이 안 맞음). 둘 다 **`"use client"` 없는 순수 presentational** → server·client 양쪽 트리에서 universal import.

> **핵심 seam 규칙**: 이벤트 핸들러 prop 금지. 붙는 순간 `"use client"` 강제 → server 위젯에서 못 씀. interactivity는 CSS hover만, 클릭은 children(client) 책임.

**`shared/ui/Card.tsx`** — 순수 표면(헤더 모름):

```ts
interface CardProps {
  as?: "article" | "div";              // 기본 "div" (section은 WidgetHeader 소유)
  padding?: "sm" | "md" | "lg";        // 16 / 24 / 32px
  tone?: "default" | "accent" | "dashed";
  className?: string;                  // escape-hatch (severity border-left, hover shadow, grid)
  "aria-labelledby"?: string;
  "aria-label"?: string;
  children: React.ReactNode;
}
```

- **padding md = `p-[var(--space-5)]` (=24px)**. ⚠️ Tailwind `p-5`는 기본 **20px**이라 토큰 이탈 — 반드시 `p-[var(--space-5)]` 표기. sm=`p-4`(16), lg=`p-6`(32).
- tone: accent(fortune-profile ×2), dashed(empty-state ×4) 증거 충분. **danger DROP** (severity는 border-left className escape-hatch).
- **DROP**: `interactive?` prop (깨끗한 소비자 0 — ReplyCard는 className escape-hatch).

> **프레이밍 (banned 'uniform radius/spacing/shadows' 준수)**: Card는 흡수기/uniformity enforcer가 **아니라** thin overridable wrapper. padding override 필수, 위계·크기 대비는 위젯 책임. surface/hairline 토큰만 제공.

**`shared/ui/WidgetHeader.tsx`** — 헤더 DRY 단위(실제 중복 단위):

```ts
interface WidgetHeaderProps {
  title: string;
  titleId: string;                     // aria-labelledby 연결
  count?: number;                      // font-mono tabular-nums 배지
  meta?: string;
  headerSlot?: React.ReactNode;        // 우측 액션 (element prop — seam 안전)
  children?: React.ReactNode;
}
```

- `<h2 id={titleId}>` + 고정 위계: 제목 `text-base font-semibold` vs count `text-xs` vs meta `font-normal text-muted` — banned 'uniform emphasis' 회피, count는 tabular-nums = semantic data.
- **`headerSlot` seam 안전**: client 컴포넌트(EmailSettingsDialog)를 *element prop*으로 받음(import 아님) → Gotcha #7 무관.
- 즉시 흡수 1순위: EmailDigest·ImportantEmails의 글자단위 복붙 헤더 2건(ImportantEmails만 meta 없음).

**`shared/ui/PageContainer.tsx`** — 라우트 컨테이너:

```ts
interface PageContainerProps {
  width?: "default" | "narrow";        // 1240 / 900px
  children: React.ReactNode;
}
```

- ⚠️ **폭 variant 필수** (회귀 방지): fortune `max-w-[900px]`, tiger `max-w-3xl` 실측 → narrow로 수렴.

**`shared/ui/PageHeader.tsx`** — 페이지 제목:

```ts
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;           // 우측 액션 slot
}
```

- **back-link 폐기** — 영속 사이드바가 fortune/skills의 `← 대시보드로`를 obsolete화.

**위치/배치**: 4개 모두 `shared/ui/<Name>.tsx` 단일 파일 + **deep import** (기존 컨벤션 — Modal/PriceChart/HelpHint 전부 파일별 deep import). **barrel(`shared/ui/index.ts`) 신설 보류** (surgical-change 위반). server-only 의존 0 → seam 분리 불필요.

### 2.2 (dashboard) Route Group 셸 + 확장 사이드바

```
app/
├── layout.tsx              # RootLayout 유지 (html/body/폰트) — 변경 없음, 순수 RSC
├── login/page.tsx          # 셸 밖 (그룹 미포함), 자체 센터 레이아웃
├── api/...                 # 셸 무관
└── (dashboard)/            # 인증 셸 그룹 (URL 세그먼트 0개 → 기존 경로/북마크 무손상)
    ├── layout.tsx          # RSC: cookies() 읽기 + ShellLayout 마운트 (auth 가드 넣지 않음)
    ├── page.tsx            # / (메인)
    └── stocks/ skills/ fortune/* tiger/* servers/*   # 이동

widgets/app-shell/          # app→widgets 합법
├── ShellLayout.tsx         # "use client" island — collapse useState(쿠키 초기값) + slot 조립
├── Sidebar.tsx             # "use client" — usePathname 활성 하이라이트, NAV_ITEMS map
└── navIcon.ts              # NavIconKey → 아이콘 컴포넌트 map (client)

shared/config/navigation.ts # NAV_ITEMS 데이터 (순수, JSX 없음 — server·client 양쪽 import 안전)
shared/ui/icons.tsx         # (기존) + 네비 아이콘 6종 신규 (home/chart/skill/fortune/tiger/server)
```

**RSC 보존 패턴**: `(dashboard)/layout.tsx`(RSC)가 client `ShellLayout`에 page 트리를 `children` slot으로 주입 → 그 트리는 **서버 렌더 유지**(postgres 의존 무손상). `"use client"`는 사이드바+collapse 로직에만. **선례**: `Modal.tsx`가 이미 `"use client"` island로 RSC page에 import됨 → island 패턴 routine.

**collapse 상태 = 쿠키** (localStorage 아님 — SSR 불일치/hydration flash 회피, Gotcha #3 + react-19 set-state-in-effect 메모리 정합). RSC layout이 `cookies()`로 읽어 `initialCollapsed` prop 전달 → flash 없음. 토글은 `document.cookie` 직접 갱신(Server Action 라운드트립 과함). 상태는 client `useState(initialCollapsed)` — **zustand 불필요**(현재 store 0개, YAGNI).

**인증 — layout 가드 금지 (검증으로 확정)**: Next.js 공유 layout은 sibling route 간 soft navigation에서 **재렌더 안 됨** → layout 가드는 (a) data-scoped page의 `session.user.id` null-deref, (b) skills의 request-time 가드 공백을 유발. **per-page redirect 가드 전부 유지.** v5 `auth()`는 request-cached라 저렴. 독립 KEEP: redirect 타깃을 `/login`으로 통일(tiger 5개의 `/api/auth/signin` 교정, `pages.signIn=/login` 실측).

**선언적 네비**: `shared/config/navigation.ts`의 `NAV_ITEMS[]`.

```ts
type NavIconKey = "home" | "chart" | "skill" | "fortune" | "tiger" | "server";
interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;                    // 컴포넌트 아닌 string key (데이터가 JSX/client 의존 안 끌게)
}
```

- 신규 라우트 = NAV_ITEMS 한 줄 + 새 아이콘 1개(icons.tsx에 네비 아이콘 0개 실측 — 정직한 caveat).
- **DROP**: `NavGroup "main|domain|ops"` 그룹 필드 — 5개 항목에 3그룹은 투기적, ops 미사용. 둘째 실그룹 생길 때 추가.

**banned 'sidebar dashboard' 가드레일**: 셸은 컨테이너+헤더만 제공, 카드 그리드 미강제(page가 editorial 컴포지션 소유 — 메인 7:4 비대칭 그리드 보존). 사이드바=기능(네비/활성 하이라이트/키보드 포커스), 가짜 메트릭 위젯 금지, surface 절제.

**모바일 드로어 → Phase 2 연기** (스코프 C 반응형 미포함. desktop-first 접힘 사이드바만으로 승인 범위 충족).

### 2.3 정적 위젯 레지스트리

**위치**: `app/_widgets/registry.ts` (app 레이어, private folder — 라우트 취급 안 됨). 최상단 `import "server-only";`.

```ts
import "server-only";
interface WidgetEntry {
  id: string;
  column: "main" | "aside";
  Component: (props?: never) => React.ReactNode | Promise<React.ReactNode>;  // async+동기 모두 수용
  Skeleton?: () => React.ReactNode;
}
export const WIDGET_REGISTRY: WidgetEntry[];
```

- 배치 근거: page-composition = app 관심사 + god-module 회피. (※ widgets→widgets는 `eslint.config.mjs:41`에서 *허용*됨 — 분석의 "boundary 위반" 주장은 거짓이나 결론은 app 배치 유지. 허용 ≠ 권장.)
- `import "server-only"`의 이중 역할: client가 실수로 import 시 `pnpm build` 즉시 실패 = Gotcha #7 조기 검출.
- **느슨한 타입**: `Component`/`Skeleton`이 async+동기 모두 수용 (버전 무관 — typecheck EXIT 0 실측).
- **DROP**: order/span/조건부 플래그 — 배열 위치=순서, 컬럼=1D flex(grid 아님 → span 무의미), 조건부 위젯 0개. 추가 시 plugin 시스템 발명 = YAGNI.

**렌더**: `renderEntry` 헬퍼가 Skeleton 유무 분기(있으면 `<Suspense>`, 없으면 keyed Fragment). column 필터로 7:4 그리드 + **컬럼별 gap 보존**(main `gap-10` / aside `gap-4` 실측 — 균일화 금지 = banned 정신 능동 준수). Component+Skeleton 페어 구조가 fallback 유실 리스크를 구조적으로 차단.

**엔트리화 범위**: Suspense 쌍 위젯 7개(async) + SupplementChecker(skeleton-less). Link 카드 2개·Tasks placeholder·PushSubscribeButton(footer chrome)은 인라인 유지.

**page.tsx before/after**:
```tsx
// AS-IS: 위젯 하드코딩 나열
<Suspense fallback={<EmailDigestSkeleton/>}><EmailDigestCard/></Suspense>
<Suspense fallback={<ImportantEmailsSkeleton/>}><ImportantEmailsCard/></Suspense>
... (×7)

// TO-BE: 레지스트리 map
{mainColumn.map(renderEntry)}   // 좌 7fr
{asideColumn.map(renderEntry)}  // 우 4fr
```

### 2.4 토큰 이탈 정리 — Phase 1 범위

**Phase 1 포함 (고립만)**: *고립* `bg-white → bg-[var(--color-surface)]`. `--color-surface: oklch(100% 0 0)` = **순백 → 진짜 no-op, 시각 동등, 리뷰 최소**. 클래스 문자열 변경이라 seam 무관.

**Phase 1 제외 → Phase 2**: gray/slate 중성색, 의미색 114건, /tiger 공존 bg-white(hairline 없음+shadow-sm이라 시각 변경 동반). (사유 §3.6)

---

## 3. Phase 2 — 시각 진화 (editorial delta)

방향: **Pretendard 단일 패밀리를 optical 규율(weight·tracking·tabular-nums·scale)로 밀어붙이는 Swiss/editorial 심화.** Required Qualities ≥4 충족 (scale contrast / spacing rhythm / depth-layering / designed hover-focus / flow motion / data-viz-as-system = **6개**).

### 3.1 타이포 위계
`displayXl: 52px` 신설(hero 인사말 전용, 로고 display 32px 유지) → hero(52)→section(32)→h1(22) 3단 드롭. weight 3단 고정(bold 700 / semibold 600 / normal 400). 숫자는 항상 tabular-nums + font-mono. **serif 미도입**(performance.md preload 예산 — Latin serif는 예산 위반; Noto Serif KR은 한국어/한자 scoped accent에만). `font-optical-sizing: auto`는 **REVISE** — Pretendard Variable의 `opsz` 축 노출 확인 후 채택, 없으면 삭제.

### 3.2 여백 리듬
off-scale `gap-10`(40px) 회수. `space-9: 80px` 신설(hero↔첫 그룹 큰 호흡). 그룹 경계 `space-8`(64), 그룹 내부 `space-5~6`(24/32) 타이트. **DROP**: `space-10: 96px`(미배정, 소비자 0).

### 3.3 surface 깊이
*공존* bg-white → surface 전면 교체(Tiger ×4는 hairline 없음+shadow-sm이라 시각 변경 동반). 3단 명도 zone(bg 98.4% / surface 100% / surface-2 96.5%)으로 그림자 없이 깊이. `shadow.cardHover` 신설(hover 부상). grain 미도입(light Swiss 절제).

### 3.4 모션
위젯 진입 fade-up(opacity+translateY, **compositor-only**). `@keyframes fade-up` globals.css 추가, reduced-motion 전역 가드(globals.css:122) 재사용. **REVISE**: stagger(index×40ms) 삭제 — 각 위젯이 독립 Suspense라 비동기 마운트 → 조율 웨이브 안 나옴. fade-up base는 visible, `opacity:0`은 keyframe 내부(FOUC 회피).

### 3.5 data-viz
PriceChart 하드코딩 색 교체: `#f59e0b`(라인 139)→`chart-2`, `#10b981`(라인 148)→`chart-3`. severity/accent는 의미 전용 보존(categorical ≠ semantic). **DROP**: chart-4(소비자 0), chart-1(accent와 값 동일 → price line=`var(--color-accent)` 유지).

### 3.6 의미색 + soft 배경 토큰
의미색 114건(red/amber/green) → severity/warn 토큰. **`severity-{high,med,ok,warn}-soft` 배경 토큰 신설** — 이미 인라인 hand-roll된 `bg-[oklch(96%_0.04_...)]` 5+곳 + HostBadge 트레일링 `0` 오타 버그 동반 해소. **DROP**: accent-soft/strong, brand-tiger(consumer 0 / 단일페이지 = 과추상; tiger amber는 warn 재사용 or "의도적 Tailwind amber 예외" 문서화). gray/slate 매핑은 1:1 no-op 아님(surface-2 vs gray-50 2pp, **text-subtle vs gray-500 7pp 역방향**) → 시각 검수 동반, gray-500→subtle 매핑은 개별 재검토.

### Phase 2 신규 토큰 통합 테이블 (미러 비대칭 반영)

| 토큰 | 값 | 미러 위치 | 소비 |
|------|-----|----------|------|
| `text.displayXl` | 52px | **3곳** (tokens.ts + `:root` + `@theme inline`) | `text-display-xl` |
| `space.9` | 80px | **2곳** (tokens.ts + `:root`) | `gap-[var(--space-9)]` |
| `shadow.cardHover` | `0 4px 12px -6px …, 0 0 0 1px var(--color-hairline-strong)` | **2곳** | `shadow-[var(--shadow-card-hover)]` |
| `color.chart2` | OKLCH 앰버 저채도 | **3곳** | recharts stroke |
| `color.chart3` | OKLCH 그린 저채도 | **3곳** | recharts stroke |
| `color.severityHighSoft` | `oklch(96% 0.04 28)` | **3곳** | 배지 배경 |
| `color.severityOkSoft` | `oklch(96% 0.04 155)` | **3곳** | 배지 배경 |
| `color.severityWarnSoft` | `oklch(96% 0.04 70)` | **3곳** | 배지 배경 |
| `@keyframes fade-up` | opacity+translateY | globals.css only (토큰 아님) | 위젯 진입 |

> 신규 색은 전부 OKLCH 저채도 / light 고정 / `@variant dark` 차단 보존.

---

## 4. 마이그레이션 계획 (PR 단위 + 리스크)

| PR | 작업 | Phase | 파일 수 | 리스크 | 비고 |
|----|------|-------|--------|--------|------|
| **PR1** | Card + WidgetHeader + PageContainer + PageHeader 프리미티브 신설 | 1 | 4 | **낮음** | 소비자 0, presentational, seam-clean. Card 최소 렌더 테스트 1개(회귀 가드) |
| **PR2a** | *고립* bg-white → surface (no-op) | 1 | ~17 | **낮음** | 순백 시각 동등, 리뷰 최소 |
| **PR3** | (dashboard) route group 셸 + 사이드바 island + navigation.ts + 네비 아이콘 6종 | 1 | 5~7 | **MED** | seam 1급 노출점(Modal island 선례로 routine). **실 Chromium 검증 1회** (jsdom 한계) |
| **PR4** | 6개+ page 셸 정리(PageContainer/PageHeader) + **위젯 레지스트리(메인)** | 1 | 6 + 2 | **중** | Suspense 페어 유지. redirect `/login` 통일 |
| **PR5+** | 위젯 batch 마이그레이션 (Card/WidgetHeader 적용) | 1 | 슬라이스 batch | **MED** | 슬라이스 단위 병렬(saju-tri ×4 / email-digest / tiger-cards / server-overview …). 테스트 3개 전부 로직 .ts → 시각 회귀 자동망 부재 → 슬라이스별 스크린샷 검증 |
| **PR2b** | /tiger Tailwind 팔레트 → 토큰 | 2 | tiger 전체 | **MED** | 실제 시각 변화. 독립 PR(파일 겹침 0) |
| **후속** | Phase 2 시각 진화(토큰 + 모션 + editorial 구성) | 2 | tokens.ts + globals.css + page.tsx + PriceChart | **높음·불확정** | 의사결정 비용 > 코드 비용. 구조 안정 후 별도 트랙 |

**병렬성**: PR1 머지 후 위젯 batch(PR5)와 셸(PR3/4)은 독립 트랙. **단일 PR 금지**(30+파일 한 PR = 리뷰/롤백 비용 과대, 운영=Docker image 원자 교체).

**CRITICAL 리스크 (단 1건)**: barrel seam — `cd apps/dashboard && pnpm build`로만 확정 검출. PR3·PR4·PR5 각각 1회 필수. (사이드바 client state의 RSC layout 침범은 Modal island 선례로 MED 강등.)

---

## 5. 불가침 제약 체크리스트

- [ ] **FSD**: 모든 신규 코드 shared/app 레이어. entities↔entities 0. registry는 app→widgets(eslint:41 허용).
- [ ] **RSC**: Card/WidgetHeader/PageContainer/PageHeader 모두 `"use client"` 없음. layout=RSC, ShellLayout/Sidebar만 client island. page 트리는 children slot으로 서버 렌더 유지.
- [ ] **seam (Gotcha #7)**: shared/ui seam-clean(server-only/use server export 0). headerSlot=element prop. registry=server tree 단독 + `import "server-only"`. **PR3·PR4·PR5 각각 `cd apps/dashboard && pnpm build` 1회 필수.**
- [ ] **토큰 단일출처**: 신규 토큰 시 비대칭 미러(color/text 3곳, space/shadow 2곳). 기존 토큰 사용만이면 미러 불요. md 패딩=`p-[var(--space-5)]`(`p-5` ≠ 24px).
- [ ] **light 고정**: `@variant dark` 차단 불변. 신규 색 OKLCH 저채도.
- [ ] **build**: typecheck+lint로 seam 미검출 인지. 셸·사이드바는 실 Chromium 검증 추가.

---

## 6. YAGNI / 제외 항목 (드롭 + 사유)

- **WidgetShell (surface+header 합성)** — phase-1 소비자 0(흡수 1순위 두 위젯은 표면 없음). WidgetHeader로 대체.
- **Card `interactive` prop** — 깨끗한 소비자 0(className escape-hatch로 충분).
- **Card `tone: "danger"` / `as: "li"|"section"`** — severity는 border-left escape-hatch, li/section 실소비자 0.
- **shared/ui barrel 신설** — surgical-change 위반(기존 deep import 컨벤션).
- **NavGroup 그룹 필드** — 5항목에 3그룹 투기적, ops 미사용.
- **layout auth 가드 끌어올리기** — soft-nav 미재렌더 → null-deref + 접근 갭(per-page redirect 유지).
- **모바일 드로어** — 스코프 C 미포함(Phase 2 연기).
- **registry order/span/조건부 플래그** — 배열=순서, 컬럼=1D flex, 조건부 위젯 0개.
- **space-10 (96px)** — 리듬 배치 미배정, 소비자 0.
- **chart-4 / chart-1** — chart-4는 "예비"(4계열 차트 없음), chart-1=accent 값 동일.
- **accent-soft/strong, brand-tiger 토큰** — consumer 0 / 단일페이지 전용 = 과추상.
- **stagger 모션 (index×40ms)** — 독립 Suspense 비동기 마운트라 조율 웨이브 불가(fade-up 본체만 KEEP).
- **사이드바 collapse cross-session persist (zustand)** — local state + 쿠키로 충분(현재 store 0개).

---

## 7. 검증으로 잡은 분석 오류 (참고 — 어드버사리얼 검증 작동 증거)

1. widget-registry "widgets→widgets boundary 위반" → **거짓** (eslint.config.mjs:41 허용).
2. "5개 라우트 max-w 복붙" → **부분 거짓** (fortune=900, tiger=3xl로 폭 상이 → PageContainer width variant 필수).
3. "p-5 = 24px" → **거짓** (Tailwind 기본 20px, 24px는 `p-[var(--space-5)]` 필요).
