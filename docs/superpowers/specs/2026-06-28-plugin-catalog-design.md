# Plugin 카탈로그 설계

**날짜**: 2026-06-28
**상태**: 설계 승인 → 구현 대기
**목적**: `/skills` 와 나란히 `/plugins` 페이지를 추가해, 설치된 Claude Code plugin을 심도 있게 발견·인벤토리할 수 있게 한다.

## 배경 — plugin은 skill과 데이터 모델이 다르다

skill 카탈로그는 89개 **평면(leaf)** 리스트였다. plugin은 43개 **컨테이너**다 — 각 plugin이 skills/agents/commands/hooks/MCP를 묶는다. 따라서 skill UI를 평평하게 복제하면 "심도"가 사라진다. plugin Detail은 **plugin → 내부 구성요소 드릴다운**이어야 한다.

이 설계는 skill 카탈로그의 검증된 패턴(build-time snapshot + overlay 머지 + 마스터-디테일 셸)을 **병렬 복제**한다. 공유 추상화는 만들지 않는다 (YAGNI — 컨테이너 모델 때문에 Detail이 충분히 달라서 조기 통합은 손해).

## 스코프 결정 (사용자 답변 기반)

- **1순위 목적**: 발견·인벤토리 중심. "이 plugin이 뭘 제공하나"를 한눈에.
- **MVP 레이어 4개**: 드릴다운 Detail + 마켓플레이스 그룹 + active/dormant 배지 + 한글 i18n overlay.
- **명시적 제외**: necessity tier(상/중/하/삭제) 같은 **주관적 health 판정 축**. 사용자가 발견 중심을 택했고, 주관적 판정은 ruflo 삭제금지 같은 랜드마인을 부른다. 객관적 사실 축(카운트·enabled·marketplace)만 노출한다.

## 데이터 소스 (build-time 머지)

운영 Docker는 `~/.claude`를 못 읽으므로 **모든 데이터를 빌드 시점 JSON에 박는다**. 런타임 fs 접근 0.

| 소스 | 제공 정보 |
|------|----------|
| `~/.claude/plugins/installed_plugins.json` | 설치된 43개 + installPath + version + marketplace(키의 `@` 뒤) |
| `~/.claude/settings.json` `enabledPlugins` (dict) | active(`true`) / dormant(`false`/누락) |
| 각 plugin의 `installPath` 하위 | `.claude-plugin/plugin.json`(desc/author/homepage/keywords) + 구성요소 카운트 |
| `entities/plugin/translations.ko.json` (committed overlay) | 한글 description |

### 구성요소 카운트 규칙 (installPath 하위, 검증됨)

- `skills/<name>/` 디렉토리 수 → `counts.skills` + 이름 목록
- `agents/*.md` 파일 수 → `counts.agents` + 이름 목록
- `commands/*.md` 파일 수 → `counts.commands` + 이름 목록
- `hooks/hooks.json` 또는 `hooks/` 존재 → `counts.hooks: boolean`
- `.mcp.json` 존재 → `counts.mcp: boolean`

installPath를 **직접** 쓴다 (ecc 같은 비표준 레이아웃·경로 탐색 실패 회피).

## 데이터 모델

```ts
// entities/plugin/model/types.ts
interface PluginComponentCounts {
  skills: number;
  agents: number;
  commands: number;
  hooks: boolean;
  mcp: boolean;
}

interface PluginComponents {
  skills: string[];   // 드릴다운용 이름 목록
  agents: string[];
  commands: string[];
}

interface PluginMeta {
  id: string;            // "superpowers@claude-plugins-official"
  name: string;          // "superpowers"
  marketplace: string;   // "claude-plugins-official"
  version: string;
  description: string;       // plugin.json (한글 overlay 시 override)
  author: string;            // "" if absent
  homepage: string;          // "" if absent
  keywords: string[];
  enabled: boolean;          // settings enabledPlugins (active vs dormant)
  resolved: boolean;         // installPath 존재 여부
  counts: PluginComponentCounts;
  components: PluginComponents;
}

// catalog envelope: { plugins: PluginMeta[], marketplaces: Record<slug,{label,count}> }
```

### unresolved 처리 — 숨기지 않고 배지로 표시

snapshot-skills는 깨진 항목을 skip한다. plugin은 **반대** — `resolved: false`로 **포함**한다. gonsautopilot처럼 설치 기록은 있으나 경로가 사라진 plugin을 "사라진 plugin"으로 보여주는 게 인벤토리 목적에 맞다. counts는 전부 0, Detail은 "경로 없음" 안내.

## 파일 레이아웃 (skill 미러)

```
entities/plugin/
  model/types.ts             # PluginMeta 등 타입
  lib/parsePlugin.ts         # plugin.json 파싱 + 구성요소 카운트 순수 함수
  plugin-catalog.json        # 생성물 (커밋, tracked)
  translations.ko.json       # 한글 overlay (committed source)
  server.ts                  # getPlugins() — catalog.json 읽어 반환 (import "server-only")
  client.ts                  # PluginMeta 타입 + 상수 re-export (UI용)
  index.ts                   # 미러 — server entry (entities는 server/client 분리 미적용, skill처럼 단일 가능)

scripts/snapshot-plugins.ts  # installed_plugins + settings + installPath 머지 → catalog.json

widgets/plugin-catalog/
  index.ts
  lib/filterPlugins.ts       # 검색 + marketplace 필터 + enabled 필터
  lib/groupPlugins.ts        # marketplace별 그룹핑 (순수 함수)
  ui/PluginCatalog.tsx       # 마스터-디테일 셸 ("use client")
  ui/PluginGroupSection.tsx  # 접이식 marketplace 섹션
  ui/PluginList.tsx          # 행: 이름 + 구성요소 카운트 칩 + enabled 배지
  ui/PluginDetail.tsx        # 드릴다운: 구성요소 이름 목록 + 메타 + homepage 링크
  ui/PluginStatusBadge.tsx   # active/dormant/missing 배지

app/(dashboard)/plugins/page.tsx  # getPlugins() → PluginCatalog
```

> **참고**: skill entities는 `index.ts` 단일 barrel을 쓴다 (server/client 혼재 통증이 안 드러나서). plugin도 동일하게 단일 `index.ts` + `server.ts`/`client.ts` 분리로 시작하되, `getPlugins`(fs/server-only)와 타입(client)이 한 barrel에 섞이면 Gotcha #1 패턴(server.ts + client.ts)을 적용한다. catalog.json은 정적 import라 server-only 의존이 약해 단일 barrel로 충분할 가능성이 높다 — build로 검증.

## UI 구조

좌측 마스터(검색 + marketplace 필터 칩 + enabled 필터 칩 + 접이식 그룹 리스트) + 우측 Detail. skill 셸과 동일 grid.

### 마스터 리스트 행 (PluginList)
```
superpowers                    [14 skills] [hooks]   ● active
ralph-loop                     [3 cmds] [hooks]      ● active
context7                       [MCP]                 ○ dormant
gonsautopilot                  (경로 없음)            ⚠ missing
```
구성요소 카운트를 **칩**으로 (0인 축은 생략). enabled 배지는 우측 정렬.

### Detail (드릴다운 — 핵심 차별점)
```
superpowers  v6.0.3  ·  claude-plugins-official  ·  ● active
Core skills library for Claude Code: TDD, debugging...
by Jesse Vincent · github.com/obra/superpowers ↗

[Skills 14]
  brainstorming · systematic-debugging · test-driven-development · ...
[Agents 0]  [Commands 0]  [Hooks ✓]  [MCP —]

keywords: skills, tdd, debugging, collaboration, best-practices
```
구성요소 이름 목록이 "이 plugin이 무엇을 묶는가"를 직접 보여준다. homepage는 외부 링크(`rel="noreferrer"`).

### 필터 축 (전부 직교)
- **검색**: name + description
- **marketplace**: 전체 / claude-plugins-official / ecc / ruflo / ... (동적)
- **상태**: 전체 / active / dormant / missing

## 테스트

skill 카탈로그 테스트 패턴 미러 (jsdom, vitest):

1. `parsePlugin.test.ts` — plugin.json 파싱 + 구성요소 카운트 (fixture 디렉토리). resolved/unresolved 양쪽.
2. `plugin-filter.test.ts` — filterPlugins 직교성 (검색 × marketplace × 상태).
3. `plugin-group.test.ts` — groupPlugins marketplace 그룹핑 + 빈 그룹 제외.
4. `plugin-catalog-toggle.test.tsx` — 접이식 토글 결정적 검증 (브라우저 인터랙션 누적 신호 회피 — skill 교훈).

## 검증 (구현 후 필수)

- `cd apps/dashboard && pnpm typecheck && pnpm lint` — FSD boundary 포함
- `cd apps/dashboard && pnpm build` — **server/client seam은 typecheck/lint로 안 잡힘** (Gotcha #7). 1회 필수.
- `pnpm plugins:snapshot` 후 catalog.json 생성·분포 로그 확인
- 생성물 크기 확인 — 본문 마크다운 없이 메타+이름목록뿐이라 작아야 함. 비대하면 gitignore 재검토.

## 비목표 (YAGNI)

- necessity tier (주관적 health 판정)
- skill 카탈로그와의 공유 추상화/통합
- plugin 활성화/비활성화 토글 액션 (읽기 전용 발견 도구)
- 마켓플레이스에서 미설치 plugin 탐색 (설치된 것만)
