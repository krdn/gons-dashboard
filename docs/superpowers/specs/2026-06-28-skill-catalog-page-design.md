# Claude Code 스킬 카탈로그 페이지 설계

- **작성일**: 2026-06-28
- **상태**: 승인 (구현 대기)
- **도메인**: dev-tools (개발 보조 위젯 — "개발에 필요한 기능 메뉴"의 1번 입주자)

## 한 줄 요약

`~/.claude/skills/`에 설치된 standalone 스킬 94개를 **빌드 시점에 JSON으로 스냅샷**해
committed로 저장하고, `/skills` 라우트에서 **master-detail (좌측 검색 가능 리스트 +
우측 본문 마크다운 렌더)** 로 보여준다. 운영(gons.krdn.kr)에서도 동작한다.

## 배경 / 동기

사용자가 "개발에 필요한 기능을 구성하는 메뉴"를 원하며, 그 첫 기능으로 **Claude Code에
설치된 스킬의 자세한 사용법·출처를 볼 수 있는 페이지**를 요청. 앞으로 여러 dev-tool
기능을 추가할 예정이지만, YAGNI 원칙상 이번에는 거대한 nav 프레임워크를 짓지 않고
가벼운 라우트 + 진입 링크 1개로 시작한다.

## 핵심 제약 (아키텍처를 가르는 결정)

**데이터 소스가 repo 밖(`~/.claude/skills/`)에 있는데, 앱은 Docker 컨테이너로 배포된다.**

- 로컬 `pnpm dev`: 프로세스가 `gon`이라 `~/.claude/skills/*/SKILL.md`를 fs로 읽을 수 있음
- 운영 컨테이너(`ghcr.io/krdn/gons-dashboard`, 192.168.0.5): `/home/gon/.claude/`가
  마운트 안 됨 → 런타임 fs read는 빈 페이지

**결정 (사용자 확인):** 운영에서도 표시해야 하므로 → **build-time snapshot 패턴**.
스크립트가 SKILL.md들을 스캔해 committed JSON으로 구워 넣고, RSC는 그 JSON을 읽는다.
Docker 빌드 컨텍스트에 JSON이 포함되므로 운영에서도 그대로 동작.

## 확정된 결정 사항 (브레인스토밍 Q&A)

| 축 | 결정 | 이유 |
|----|------|------|
| 배포 범위 | 운영(gons.krdn.kr)에서도 표시 | build-time snapshot 필요 |
| 스킬 범위 | top-level standalone + personal 만 (`~/.claude/skills/`) | YAGNI; 플러그인·gstack 중첩 수백 개는 보류 |
| 콘텐츠 깊이 | 리스트(메타) + SKILL.md 본문 전문 렌더 | "자세한 사용법·출처" 요구 충족 |
| body 전달 | metadata/body 물리 분리, body 는 선택 시 lazy-fetch | recon 실측 3.59 MB → flight payload 폭증 방지 |
| 레이아웃 | 좌측 리스트 + 우측 상세 (master-detail) | 브라우저/도큐멘테이션 탐색 고전 패턴 |
| 구현 단위 | widget | 데이터 표시 위주 조합 컴포넌트 |
| frontmatter 파서 | gray-matter (devDependency 신규) | folded scalar·배열·한국어 → 정규식 깨짐 |

## 데이터 아키텍처

> **⚠️ 결정 정정 (recon 실측 후, 2026-06-28):** 초기 스펙은 `body`(SKILL.md 본문)를
> 메타데이터와 함께 client 위젯 props 로 전달하려 했으나, **top-level SKILL.md 총합이
> 3.59 MB** (가장 큰 `spec` 122 KB) 로 실측됨. 전부 RSC flight payload 에 실으면 초기
> 로드가 `ecc/web/performance.md` 의 app-page 예산(300 KB)을 12배 초과. → **metadata 와
> body 를 물리적으로 분리.** 리스트는 metadata 만(~수십 KB), body 는 선택 시 lazy-fetch.

```
빌드 시점 (개발자 머신)                    committed (git)              런타임 (로컬+운영 공통)
┌──────────────────────┐   생성   ┌──────────────────────────┐
│ scripts/             │ ───────> │ entities/skill/catalog.   │ import  RSC page.tsx
│  snapshot-skills.ts  │          │   json   (metadata only)  │ ──────> 좌측 리스트 (메타)
│  (~/.claude/skills/  │          ├──────────────────────────┤
│   스캔, gray-matter  │ ───────> │ public/skill-catalog/     │ fetch   클릭 시 body
│   파싱, symlink 추적) │          │   <name>.json (body 1개씩) │ <────── 우측 상세 (마크다운)
└──────────────────────┘          └──────────────────────────┘
```

- **catalog.json** (metadata, committed in `entities/skill/`): 리스트 렌더용. body 없음.
- **public/skill-catalog/<name>.json** (body, committed): 스킬당 1파일. `public/` 은
  Docker 이미지에 포함되므로 운영에서 `fetch("/skill-catalog/<name>.json")` 로 정적 서빙.
  API 라우트도 런타임 fs 도 불필요. body 는 선택된 스킬 1개만 받으므로 초기 payload 무관.

### 스냅샷 스크립트

- **위치**: `apps/dashboard/src/scripts/snapshot-skills.ts`
- **실행**: `pnpm skills:snapshot` (root → apps/dashboard 위임 thin proxy). 수동 실행.
  스킬이 바뀌면 사용자가 한 번 돌려 JSON 갱신 후 커밋. cron/watch 자동화는 보류(YAGNI).
- **frontmatter 파싱**: **gray-matter** (devDependency 신규 추가). `---` delimiter 분리
  + YAML 파싱을 `{ data, content }` 로 한 번에 반환 → metadata/body 분리에 정확히 부합.
  정규식 hand-roll 금지 — recon 에서 folded scalar(`description: >` in caveman,
  llm-gateway-consumer-setup), 배열 필드, 한국어/특수문자로 정규식 파싱이 깨짐을 확인.
  gray-matter 는 build-time devDependency 라 client bundle 예산과 무관(react-markdown 의
  "새 의존성 0" 제약은 런타임 bundle 에 대한 것).
- **동작**:
  1. `~/.claude/skills/` 하위 각 항목 순회 (실디렉토리 + symlink). loose 파일
     (`upgrade-domain.md` 등 디렉토리 아닌 것) skip.
  2. 각 항목의 `SKILL.md` 읽기. 없으면 skip (recon: `learned`, `vault-workspace` 2개).
  3. gray-matter 로 `{ data, content }` 분리 → metadata(data) + body(content)
  4. symlink 여부로 `source` 분류 (아래 규칙)
  5. metadata 를 `SkillMeta[]` 로 모아 `catalog.json` 에 name asc 정렬해 기록
  6. 각 스킬의 body 를 `public/skill-catalog/<name>.json` 에 개별 기록
     (`{ body: string }` 형태). name 에 `:`/`/` 가 있으면 파일명 안전하게 sanitize.
- **출처(source) 분류 규칙**:
  - symlink → `personal` (recon: 14개 전부 `~/.agents/skills/` 타겟)
  - 실제 디렉토리(symlink 아님) → `standalone`
  - `plugin` 은 현재 scope 에 0개 (플러그인 스킬은 범위 밖) → **enum 에서 제외**(YAGNI)
- **에러 처리 / 로깅**:
  - SKILL.md 없음 → skip + dropped 카운트 누적
  - frontmatter 파싱 실패 → 해당 스킬 skip + `console.warn`, 스크립트 중단 안 함
  - `name` 누락 → 디렉토리명을 fallback name 으로
  - 마지막에 `console.log` 로 `생성 N개 / skip M개` 요약 (silent truncation 금지)

### 타입

```ts
// entities/skill/model/types.ts
export type SkillSource = "standalone" | "personal";

// 리스트(catalog.json)에 담기는 경량 메타데이터 — body 없음
export interface SkillMeta {
  name: string;          // frontmatter name (없으면 디렉토리명)
  description: string;   // frontmatter description (없으면 "")
  version: string | null;
  model: string | null;
  source: SkillSource;
  filePath: string;      // 원본 SKILL.md 경로 (표시용, ~/ 축약)
  bodyPath: string;      // "/skill-catalog/<sanitized-name>.json" (fetch URL)
}

// public/skill-catalog/<name>.json 의 형태
export interface SkillBody {
  body: string;          // SKILL.md frontmatter 이후 마크다운 전문
}
```

## FSD 컴포넌트 구조

프로젝트 FSD 규칙(`entities/<name>` server/client seam, barrel public API, ESLint
boundaries)을 따른다.

```
entities/skill/
├── model/types.ts          # SkillMeta, SkillBody, SkillSource 타입
├── lib/parseSkill.ts       # 순수 함수 — gray-matter 결과 → SkillMeta (파서/분류 로직, 테스트 대상)
├── catalog.json            # committed 메타데이터 스냅샷 — 스크립트가 덮어씀
├── server.ts               # getSkills() — catalog.json import, SkillMeta[] 반환
└── client.ts               # SkillMeta/SkillBody/SkillSource 타입 re-export + SOURCE_LABEL 상수

widgets/skill-catalog/
├── ui/SkillCatalog.tsx     # "use client" — master-detail 셸 (검색/필터/선택/body fetch 상태)
├── ui/SkillList.tsx        # 좌측 리스트 (검색 인풋 + source 필터 + 필터링된 항목)
├── ui/SkillDetail.tsx      # 우측 본문 (메타 헤더 + react-markdown 렌더 + loading/empty-state)
├── lib/filterSkills.ts     # 순수 함수 — (query, sourceFilter) → 필터링 결과 (테스트 대상)
└── index.ts                # barrel — SkillCatalog export

app/skills/page.tsx          # RSC — getSkills() 호출 후 <SkillCatalog skills={...} />
public/skill-catalog/        # 스냅샷 스크립트가 생성하는 body JSON 디렉토리 (committed)
```

- **데이터 흐름**:
  1. RSC page 가 `getSkills()` 로 **메타데이터 배열만** 읽어 client 위젯에 props 전달
     (catalog.json, 본문 없음 → 초기 payload 경량).
  2. 검색/필터/선택은 client 상태. 검색/필터는 메모리 내 순수 함수(`filterSkills`).
  3. 스킬 선택 시 `fetch(meta.bodyPath)` 로 `public/skill-catalog/<name>.json` 에서
     body 1개만 받아 우측에 마크다운 렌더. fetch 중 loading, 실패 시 에러 상태.
- **catalog.json 위치**: `entities/skill/` 안에 둬서 도메인 응집. body 는 `public/` 에.
  스냅샷 스크립트가 두 출력을 모두 덮어쓴다.
- **server/client seam**: catalog.json 은 순수 JSON 이라 Node-only 의존이 없지만, FSD
  seam 일관성을 위해 `getSkills()` 는 `server.ts`(`import "server-only"`)에, client
  컴포넌트가 쓰는 타입·상수는 `client.ts` 에 둔다. (Gotcha #1 패턴 — UI 컴포넌트는 widget
  에 있으므로 client.ts 는 타입·상수만 노출, `server-only` import 절대 금지.)

## UI / 디자인

- **마크다운 렌더**: 기존 `react-markdown ^10.1.0` 재사용 (런타임 bundle 새 의존성 0).
  saju-detail 패턴(부모 div 에 `[&_p+p]:mt-2 [&_ul]:list-disc` 등 Tailwind arbitrary
  selector)을 그대로 차용. 코드 블록 신택스 하이라이팅은 1차엔 단순 `<pre>` 스타일(YAGNI).
- **좌측 리스트**:
  - 상단 검색 인풋 — `name` + `description` 부분 문자열 필터 (client-side, 소문자 비교)
  - 출처(source) 필터 칩 — standalone / personal (FilterChip 패턴, host-dashboard 참조)
  - 각 항목: 스킬 이름(굵게) + 설명 1줄 truncate + 출처 뱃지. 선택 시 강조.
- **우측 상세**:
  - 메타 헤더: 이름, 버전, model, 출처, 원본 경로(`filePath`)
  - 본문: fetch 한 SKILL.md 마크다운 전문 렌더
  - 상태별: 선택 없음 → empty-state / fetch 중 → loading / fetch 실패 → 에러 메시지
- **스타일**: 기존 토큰(`globals.css`) + Tailwind v4, **라이트 모드 고정**.
  카드 `rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)]`,
  뱃지 `inline-flex ... rounded-md border px-1.5 py-0.5 font-mono text-xs` 컨벤션 차용.
- **진입 경로**: 메인 `page.tsx` 좌측 콘텐츠 영역의 `/stocks` 링크(라인 110-118) 아래에
  같은 카드 스타일로 `/skills` 링크 1개 추가. `/skills/page.tsx` 헤더에는 fortune 패턴의
  `← 대시보드로` 백링크 포함. 공유 nav 추출은 보류(YAGNI — 현재 nav 는 페이지별 `<Link>`
  분산형이며, 기능이 3~4개 더 쌓였을 때 리팩토링).

## 에러 처리 / 엣지 케이스

- 스냅샷 스크립트: SKILL.md 없음/파싱 실패 시 skip + 경고 로그(중단 안 함). `name` 누락 시
  디렉토리명 fallback. 마지막에 생성/skip 카운트 요약 로그.
- 페이지: catalog.json 은 항상 존재(committed) → 런타임 에러 거의 없음. 빈 배열이어도
  empty-state 로 graceful. body fetch 실패 → 우측에 에러 메시지(전체 페이지 안 깨짐).

## 테스트 (fixture 기반 — live 카탈로그 개수 단언 금지)

> recon: 스킬 모집단은 설치/제거로 변하고 개수 추정이 불안정. **fixture 문자열로 파서를
> 테스트**하고, live catalog.json 의 개수는 단언하지 않는다(flake 방지).

- `entities/skill/lib/parseSkill.ts` 단위 테스트:
  - 정상 frontmatter(name/description/version/model 전부) → 올바른 SkillMeta
  - version/model 누락 → null
  - folded scalar(`description: >`) 멀티라인 → 한 줄로 접힘 (caveman fixture)
  - 한국어/특수문자 description 보존
  - name 누락 → 디렉토리명 fallback
  - source 분류: isSymlink=true → personal, false → standalone
- `widgets/skill-catalog/lib/filterSkills.ts` 단위 테스트 (it.each 매개변수화):
  - 검색어 부분 일치(name·description), 대소문자 무시
  - source 칩 필터 (standalone/personal/전체)
  - 검색 + source 동시 적용

## 명시적으로 범위 밖 (YAGNI)

- 자동 동기화(cron/watch) — 수동 스냅샷
- 플러그인 스킬(수백 개, `~/.claude/plugins/cache/.../skills/`) + gstack 중첩 스킬 — top-level standalone/personal 만
- `plugin` source enum 값 — 현재 scope 0개라 제외
- 공유 nav 프레임워크 — 진입 링크 1개
- 코드 블록 신택스 하이라이팅 — 후속
- 스킬 즐겨찾기/검색 히스토리 등 부가 기능

## 검증 (구현 후)

```bash
pnpm skills:snapshot          # catalog.json + public/skill-catalog/*.json 생성 확인
pnpm typecheck                # tsc --noEmit
pnpm lint                     # ESLint (FSD boundary 포함)
pnpm test                     # 단위 테스트 (parseSkill, filterSkills)
cd apps/dashboard && pnpm build  # server/client seam 검출 (Gotcha #7 — PR 전 필수)
```

운영 배포 후: `/skills` 라우트가 운영에서도 catalog.json(메타) + `/skill-catalog/<name>.json`
(body, public 정적 서빙)을 읽어 스킬을 렌더하는지 확인 (런타임 fs 접근 없이 동작 = 아키텍처 검증).
