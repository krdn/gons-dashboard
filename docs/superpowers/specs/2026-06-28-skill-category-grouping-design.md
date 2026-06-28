# 스킬 카탈로그 카테고리 분류 + 유형별 그룹 UI 설계

**날짜**: 2026-06-28
**도메인**: 스킬 카탈로그 (`/skills`)
**관련**: [[skill-catalog-i18n-overlay]], [[skill-catalog-buildtime-snapshot-pattern]]

## 1. 목표

89개 Claude Code 스킬에 **기능 축 카테고리**를 부여하고, `/skills` 페이지에서 **유형별 접이식 그룹 섹션**으로 묶어 볼 수 있게 한다. 사용자가 "어떤 종류의 스킬이 있는지" 한 화면에서 조망하고, 원하는 유형으로 빠르게 좁힐 수 있어야 한다.

현재는 89개가 알파벳순 평면 리스트라 "디자인 관련 스킬만 보기" 같은 탐색이 불가능하다.

## 2. 핵심 결정 (재작업 방지 — 반드시 준수)

### 2.1 카테고리 데이터는 큐레이트된 정적 overlay

원본 `SKILL.md`는 불가침(영어 트리거 매칭 load-bearing)이고 `snapshot-skills.ts`는 fs-only 결정적 빌드다. 따라서:

- **카테고리 = 별도 `categories.json` 큐레이션 파일** (translations.ko.json과 같은 committed overlay 계열).
- 런타임 description 정규식 분류 ❌, snapshot에 LLM 분류 주입 ❌ — 결정성 파괴.
- 분류 초안은 **오프라인 일회성 LLM 분석**으로 도출 후 `categories.json`에 커밋 (이 작업에서 이미 완료 — 3-렌즈 만장일치, disputed 0).

**근거**: category는 *언어*가 아니라 *구조 축*이라 translations와 분리. 한 파일에 `slug → {label, order, skills:[]}` 맵으로 두면 "89개가 정확히 한 번씩 등장하는가"와 표시 순서가 한 화면에서 눈으로 검증된다. 분산된 per-skill 필드는 순서도 없고 누락 감지가 어렵다.

### 2.2 완전성을 빌드에서 강제

`snapshot-skills.ts`가 categories.json을 역인덱싱해 각 meta에 `category` 주입할 때:

- 미매핑 스킬은 fallback 카테고리 `"uncategorized"` + `console.warn` (translatedCount 패턴 미러).
- 빌드 끝에 카테고리별 개수 로그 출력 → 새 스킬 silent drop 즉시 가시화.

### 2.3 그룹핑은 source 필터·검색과 직교

`filterSkills`(평면 필터: source + query)는 그대로 유지. 그 위에 **그룹핑 레이어**를 얹는다: 필터 결과를 category order대로 버킷팅 → 각 섹션 렌더. 그룹핑이 filterSkills를 우회하면 안 됨 — 필터 먼저, 결과를 그룹핑.

### 2.4 YAGNI

런타임 카테고리 편집 UI ❌, DB 테이블 ❌, 카테고리 관리 화면 ❌. 정적 렌더 전용. category를 *또* 칩 필터로 중복하지 않음 (접이식 섹션이 그 역할).

## 3. 카테고리 체계 (10개, 만장일치 분류 결과)

3개 독립 분류기(사용자 의도 / 핵심 동작 / 산출물 렌즈)가 89개 전부에 만장일치. `(gstack)` provider 접미사는 무시하고 기능으로 분류.

| order | slug | label | 개수 | 대표 스킬 |
|-------|------|-------|------|----------|
| 1 | `planning-spec` | 계획·스펙·요구사항 | 15 | spec, plan-*, grill-*, to-prd, triage |
| 2 | `workflow-orchestration` | 워크플로·오케스트레이션 | 12 | gon:*, ship, write-a-skill, benchmark |
| 3 | `platform-ecosystem` | 플랫폼·에코시스템 | 11 | port, framework, ios-*, codex, setup-* |
| 4 | `code-quality` | 코드 품질·리뷰·테스트 | 10 | review, qa, tdd, diagnose, health |
| 5 | `docs-knowledge` | 문서화·지식 | 9 | auto-doc, graphify, vault, make-pdf |
| 6 | `design-ux` | 디자인·UI/UX | 7 | design-*, diagram, ios-design-review |
| 7 | `deploy-ops` | 배포·운영·모니터링 | 7 | deploy-manager, land-and-deploy, canary |
| 8 | `browser-automation` | 브라우저·웹 자동화 | 7 | browse, playwright-cli, scrape |
| 9 | `session-context` | 세션·컨텍스트·메모리 | 6 | context-*, caveman, notify-important |
| 10 | `security-safety` | 보안·안전 가드 | 5 | cso, careful, guard, freeze |

**order는 개수 내림차순** — 큰 그룹이 위에 와서 첫 화면에서 밀도 높은 콘텐츠를 먼저 보여준다. (단, 사용자가 의미 순서를 원하면 조정 가능 — §7 참조)

전체 배정은 `categories.json`에 명시. 89개 = Σ개수 (15+12+11+10+9+7+7+7+6+5 = 89). ✅

### 경계 판정 (검토 필요 시 조정 가능)

- `benchmark`/`benchmark-models` → workflow-orchestration (성능 측정 파이프라인으로 봄. code-quality 도 합리적 — 사용자 선택 시 이동).
- `ios-design-review` → design-ux (시각 감사), `ios-qa` → code-quality (QA), 나머지 ios-* → platform-ecosystem.
- `retro` → deploy-ops (릴리스 회고), `landing-report` → deploy-ops (배포 큐 대시보드).
- `notify-important` → session-context (커뮤니케이션/알림).

## 4. 데이터 모델 변경

### 4.1 신규: `entities/skill/categories.json`

```jsonc
{
  "planning-spec": {
    "label": "계획·스펙·요구사항",
    "order": 1,
    "skills": ["spec", "plan-ceo-review", "..." ]
  },
  "workflow-orchestration": { "label": "...", "order": 2, "skills": [...] },
  // ... 10개
}
```

### 4.2 `entities/skill/model/types.ts`

```ts
// SkillMeta 에 category 추가 (snapshot 빌드 시 주입).
export interface SkillMeta {
  // ... 기존 필드
  category: string; // categories.json 의 slug. 미매핑 시 "uncategorized".
}

// categories.json 의 형태.
export interface SkillCategory {
  label: string;
  order: number;
  skills: string[];
}
export type SkillCategories = Record<string, SkillCategory>;

// 미매핑 fallback (SOURCE_LABEL 패턴).
export const UNCATEGORIZED = "uncategorized";
export const UNCATEGORIZED_LABEL = "기타";
```

`label`/`order`는 categories.json이 단일 출처 — types.ts에 하드코딩한 `CATEGORY_LABEL` 상수는 **두지 않는다** (drift 위험). UI는 빌드된 메타에서 label/order를 받는다 (§5.1).

### 4.3 `scripts/snapshot-skills.ts`

`loadTranslations()` 옆에 `loadCategories()` 추가. 역인덱스(`skill name → {slug, label, order}`) 구성 후 각 meta에 주입:

```ts
const catIndex = buildCategoryIndex(loadCategories()); // name → {slug,label,order}
// meta 생성 후:
const cat = catIndex[meta.name];
meta.category = cat?.slug ?? UNCATEGORIZED;
if (!cat) { uncategorized.push(meta.name); }
```

빌드 끝에:
```ts
console.log(`[snapshot-skills] 카테고리 분포: ${카테고리별 개수}`);
if (uncategorized.length) console.warn(`⚠️ 미분류 ${uncategorized.length}개: ${uncategorized.join(", ")}`);
```

catalog.json은 category 필드를 포함하게 되고, **카테고리 label/order 맵도 catalog 옆에 함께 출력**해야 UI가 섹션 헤더·순서를 안다.

**generated vs source 구분 (함정 회피 — [[skill-catalog-i18n-overlay]])**: `categories.json`은 *committed source*(사람이 편집), `category-meta.json`은 *generated*(snapshot 출력, 직접 편집 금지)다. 둘이 같은 `entities/skill/` 디렉토리에 있으면 혼동된다. 따라서:

- **source**: `entities/skill/categories.json` (편집 대상)
- **generated**: `catalog.json`처럼 snapshot이 덮어쓰는 산출물. 별도 파일 대신 **`catalog.json` 자체에 카테고리 메타를 함께 담는다** — `{ skills: SkillMeta[], categories: Record<slug,{label,order}> }` envelope. catalog.json은 이미 generated라 새 generated 파일을 안 만들어도 됨.

⚠️ **breaking 주의**: catalog.json 형태가 `SkillMeta[]` → `{skills, categories}` envelope로 바뀐다. 소비자는 `server.ts`(`getSkills`)뿐이므로 거기서 `.skills`로 언랩. page→SkillCatalog로 `categories`도 함께 전달. 기존 배열 직접 import 없음을 grep으로 확인 후 진행.

## 5. UI/UX 변경

### 5.1 그룹핑 로직: `widgets/skill-catalog/lib/groupSkills.ts` (신규)

```ts
export interface SkillGroup {
  slug: string;
  label: string;
  order: number;
  skills: SkillMeta[];
}

// 필터된 평면 리스트 → category order 순 그룹 배열.
// 빈 그룹(필터로 0개)은 제외. category-meta 로 label/order 해석.
export function groupSkills(
  filtered: SkillMeta[],
  categoryMeta: Record<string, { label: string; order: number }>,
): SkillGroup[]
```

`filterSkills` 출력을 입력으로 받음 — 직교성 보장. 정렬: order asc, 그룹 내 스킬은 name asc(기존과 동일).

### 5.2 `SkillCatalog.tsx` — 그룹 렌더 + 펼침 상태

- `filtered`(기존) → `groups = groupSkills(filtered, categoryMeta)` 추가.
- 펼침 상태: `expanded: Set<string>` (slug). 기본 = **전체 펼침** (조망이 목적이라 처음엔 다 보임). 사용자가 섹션 헤더 클릭으로 토글.
- 검색어가 있으면(`query !== ""`) 매칭된 그룹은 **강제 펼침** (접힌 섹션에 숨은 결과 방지).
- category-meta는 server에서 page가 SkillCatalog로 전달 (catalog과 함께 import).

### 5.3 `SkillList.tsx` → 섹션 분할

현재 평면 `<ul>` 을 `SkillGroupSection` 반복으로 교체:

```
SkillCatalog
 └ groups.map(g => <SkillGroupSection group={g} expanded={...} onToggle={...} selectedName onSelect />)
                      └ <button> 섹션 헤더 (label + 개수 + ▼/▶ 아이콘, aria-expanded)
                      └ {expanded && <SkillList skills={g.skills} ... />}  ← 기존 SkillList 재사용
```

`SkillList`는 평면 리스트 렌더 책임만 유지 (변경 최소화). 섹션 래핑은 신규 `SkillGroupSection`이 담당.

**접근성**:
- 섹션 헤더 = `<button aria-expanded={expanded} aria-controls={listId}>`.
- 리스트 `<ul id={listId} role="list">`.
- 아이콘은 `aria-hidden` (텍스트 label이 정보 전달).

### 5.4 디테일 패널 — 카테고리 배지

`SkillDetail.tsx` 헤더의 메타 칩 줄(source/version/model 옆)에 **카테고리 배지** 추가:

```tsx
<span className="inline-flex rounded-md border border-[var(--color-accent)] bg-[var(--color-surface-2)] px-1.5 py-0.5">
  {categoryLabel}
</span>
```

accent 보더로 source 칩(hairline 보더)과 시각 구분. 값싼 추가 — 디테일에서도 "이 스킬이 어느 유형인가" 즉시 인지.

### 5.5 리스트 행 — 카테고리 컬러 도트 (선택적, 경량)

각 스킬 행 좌측에 카테고리별 색 도트(2px) 추가 → 그룹 섹션 안에선 중복이지만, 검색 결과에서 섹션이 섞일 때 시각 앵커. **MVP에서는 생략**, 사용자 요청 시 추가. 디자인 토큰에 카테고리 컬러 10개를 정의해야 하므로 YAGNI 보류.

## 6. 컴포넌트 경계 요약

| 단위 | 책임 | 의존 |
|------|------|------|
| `categories.json` (source) | 큐레이트된 분류 단일 출처 (편집 대상) | (데이터) |
| `catalog.json` (generated) | `{skills, categories}` envelope — snapshot 출력 | snapshot 빌드 |
| `snapshot-skills.ts` | 역인덱싱 + category 주입 + 완전성 warn + envelope 출력 | categories.json |
| `server.ts` | `getSkills()` (`.skills` 언랩) + `getSkillCategories()` 신규 | catalog.json |
| `groupSkills.ts` | 필터 결과 → 그룹 배열 (순수 함수) | SkillMeta, category-meta |
| `SkillGroupSection.tsx` | 한 섹션 (헤더 토글 + 리스트) | SkillList |
| `SkillCatalog.tsx` | 펼침 상태 + 검색-펼침 연동 | groupSkills, SkillGroupSection |
| `SkillList.tsx` | 평면 리스트 (변경 거의 없음) | — |
| `SkillDetail.tsx` | 카테고리 배지 추가 | category label |

각 단위는 독립 테스트 가능: `groupSkills`(순수 함수 — 빈 그룹 제외/정렬/직교성), `SkillGroupSection`(토글 a11y), snapshot 완전성(89개 매핑).

## 7. 테스트 전략

1. **groupSkills 순수 함수** (vitest): 필터 결과 그룹핑, 빈 그룹 제외, order 정렬, 미분류→기타 그룹.
2. **snapshot 완전성**: categories.json의 skills 합집합 = catalog 89개 (중복/누락 0). 회귀 가드.
3. **SkillGroupSection a11y** (jsdom): aria-expanded 토글, 검색 시 강제 펼침.
4. **typecheck/lint/build** PASS (build이 server/client seam 게이트 — [[features-barrel-server-client-seam]] 교훈).

## 8. 작업 순서 (구현 플랜 입력)

1. `categories.json` 작성 (분류 결과 커밋).
2. types.ts: category 필드 + SkillCategory/SkillCatalog envelope 타입 + UNCATEGORIZED.
3. snapshot-skills.ts: loadCategories + 역인덱싱 + category 주입 + `{skills, categories}` envelope 출력 + 완전성 warn.
4. `pnpm skills:snapshot` 재생성 → catalog.json envelope 형태로 갱신.
5. server.ts: `getSkills()` envelope 언랩 + `getSkillCategories()` 추가. page.tsx: 둘 다 전달 (`skills.length` 동작 유지).
6. groupSkills.ts (순수 함수) + 테스트.
7. SkillGroupSection.tsx + SkillCatalog 펼침 상태 + 검색-펼침 연동.
8. SkillDetail 카테고리 배지.
9. typecheck/lint/build + 브라우저 검증.

## 9. 비목표

- 카테고리 다국어 (label은 한글 고정 — 이 대시보드는 ko 전용).
- 카테고리별 색상 테마 (§5.5 YAGNI 보류).
- 스킬 다중 카테고리 (1 스킬 = 1 카테고리, primary function).
- 카테고리 추가/편집 UI.
