# 메모 시스템 아키텍처 시각화 페이지 — 설계

- **날짜**: 2026-07-13
- **라우트**: `/memos/architecture`
- **목적**: 메모 도메인의 구조·데이터 흐름·워크플로우를 계층적 인터랙티브 그래프로 시각화하고, 특정 부분을 유지보수할 때 필요한 구체적 호출 명령어(curl/pnpm/psql)를 화면에서 바로 제공한다. 유지보수 담당자가 시스템 전체를 한눈에 파악하고, 수정 지점을 `파일:심볼` 수준으로 짚어 즉시 명령어를 복사할 수 있게 한다.

## 결정 사항 (사용자 확정)

| 항목 | 결정 |
|------|------|
| 산출물 | 대시보드 내 실제 페이지 (git 버전 관리, FSD 준수) |
| 데이터 성격 | 정적 구조도 (런타임 DB 데이터 미연동) |
| 상세 수준 | 계층적 — 개념 흐름을 먼저 보여주고, 노드 클릭/펼침 시 실제 `파일:함수` 심볼 + 명령어 노출 |
| 렌더링 | 자체 SVG/CSS 인터랙티브 그래프 (외부 라이브러리 의존 없음) |
| 라우트 | `/memos/architecture` — `/memos` 헤더에서 링크 진입, nav 트리 미변경 |
| 명령어 제공 | 복사 버튼 있는 코드블록, 시크릿은 `$VAR` 플레이스홀더 |
| v1 범위 | ① 워크플로우 그래프 + ② 유지보수 색인 탭. **DB 스키마 ER 탭은 v1 제외** (YAGNI — DB 레이어는 그래프 노드에 녹임) |

## 아키텍처 (FSD)

```
route:   app/(dashboard)/memos/architecture/page.tsx   # RSC. auth() 가드 후 정적 그래프 데이터를 뷰에 props로 주입
widget:  widgets/memo-architecture/
  ui/MemoArchitectureView.tsx   # "use client" — graph를 props로 받아 흐름 선택·노드 펼침·탭 전환·복사 오케스트레이션
  ui/WorkflowGraph.tsx          # 선택된 흐름을 레이어 컬럼 위에 렌더
  ui/LayerColumns.tsx           # 레이어 배경 그리드 (FSD 5레이어 + 운영 표식, 아래 "레이어 컬럼 정의" 참조)
  ui/FlowChips.tsx              # 8개 워크플로우 선택 레일
  ui/GraphNode.tsx              # 파일:심볼 노드 (클릭 → 상세)
  ui/GraphEdge.tsx              # 노드 간 SVG 엣지 (라벨: after()/FK/JOIN 등)
  ui/NodeDetailPanel.tsx        # 선택 노드의 역할·심볼·의존·유지보수 명령어
  ui/MaintenanceIndex.tsx       # 유지보수 색인 탭 (검색 가능 표)
  ui/CopyableCommand.tsx        # 복사 버튼 코드블록
  model/architecture-graph.ts   # ⭐ 정적 데이터 — 진실의 원천 (조사 결과 타입화). "server-only" 없음: 순수 데이터라 client 전달 허용
  model/types.ts                # Flow / GraphNode / Layer / MaintenanceEntry 타입
  index.ts                      # barrel — MemoArchitectureView, ARCHITECTURE_GRAPH, 타입 export (deep import 금지)
```

**설계 원칙**: 데이터/렌더 분리. `architecture-graph.ts`가 흐름·노드·엣지·명령어를 담고, 컴포넌트는 순수 렌더러. 메모 시스템이 바뀌면 이 데이터 파일 한 곳만 갱신한다. 그래프 데이터는 코드에서 정적 import하므로 **런타임 DB/LLM 조회가 없다**. 유일한 서버 의존은 인증 가드(아래 참조)다.

**server/client 경계 (인증 이후에만 데이터 전달)**: `ARCHITECTURE_GRAPH`는 barrel(`@/widgets/memo-architecture`)에서 정적 top-level import한다(Next.js RSC 관례상 import는 모듈 로드 시점 — 인증 이전/이후 개념 아님). 인증 게이트가 작동하는 지점은 **import가 아니라 렌더/전달 시점**이다: `page.tsx`(RSC)는 `auth()` 가드를 통과하지 못하면 `redirect("/login")`으로 **JSX를 반환하기 전에 빠져나가므로**, `MemoArchitectureView`가 마운트되지 않고 `graph` prop이 클라이언트로 전달되지 않는다. `MemoArchitectureView`("use client")는 데이터를 직접 import하지 않고 **props로만** 받는다. 데이터는 이름·경로·명령어 문자열뿐(시크릿·PII 없음, `$VAR` 플레이스홀더만)이라 client 번들에 포함되어도 민감정보 노출은 아니지만, 접근 자체(페이지 렌더)는 인증으로 차단한다. **모든 import는 barrel `index.ts` 경유** — `page.tsx`가 `model/architecture-graph.ts`를 deep import하지 않는다(FSD public API 관례).

**인증 가드 (필수)**: 이 페이지도 다른 dashboard 라우트와 **동일한** per-page 인증을 건다. `memos/page.tsx`의 스켈레톤을 그대로 미러링:

```tsx
// app/(dashboard)/memos/architecture/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { MemoArchitectureView, ARCHITECTURE_GRAPH } from "@/widgets/memo-architecture";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";   // 기존 memos/settings 페이지와 동일 관례

export default async function MemoArchitecturePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모 시스템 아키텍처"
        actions={
          <Link href="/memos" className="text-sm text-[var(--color-text-muted)] hover:underline">
            ← 메모
          </Link>
        }
      />
      <MemoArchitectureView graph={ARCHITECTURE_GRAPH} />
    </PageContainer>
  );
}
```

`PageContainer`는 `width="narrow"`(900px), `PageHeader`의 뒤로가기 링크는 `actions` 슬롯에 `<Link href="/memos">`로 렌더 — 둘 다 `memos/settings/page.tsx`의 실제 사용 패턴과 동일하게 맞춘다(주석 아닌 실제 코드).

`app/(dashboard)/layout.tsx`에는 명시적으로 auth 가드가 **없다** (주석: "공유 layout은 soft-nav에서 재렌더 안 됨 — per-page redirect 유지"). 따라서 레이아웃 인증에 의존할 수 없고, `memos/page.tsx`·`memos/settings/page.tsx`가 각자 `auth()`를 호출하는 것과 **똑같이** 이 페이지도 페이지 상단에서 세션을 확인하고 없으면 `/login`으로 redirect해야 한다. 아키텍처·유지보수 명령어(cron 경로, 내부 파일 구조)는 로그인 전용(`ALLOWLIST_EMAILS`) 사용자에게만 노출되어야 하는 내부 정보이므로 이 가드는 콘텐츠가 정적이어도 생략 불가다. 세션 사용자 데이터는 그래프에 쓰지 않는다(가드 목적으로만 `auth()` 호출).

**FSD 의존 방향**: `widgets/memo-architecture`는 `entities/memo/client`(타입)와 필요 시 `shared`(공통 UI 프리미티브·유틸)만 하위 참조. features·entities/*/server 미참조 — 이 위젯은 메모 도메인을 *설명*할 뿐 *실행*하지 않으므로 실제 feature 코드나 server repo를 import하지 않는다. 그래프 데이터는 코드 심볼을 **문자열로** 참조(실제 import 아님). `PageContainer`·`PageHeader`(shared/ui)는 **위젯이 아니라 `page.tsx`(app 레이어)가** import해 위젯을 감싼다(위 스켈레톤 참조) — 위젯 자체는 그래프 렌더에만 집중한다. ESLint boundaries 정의(`eslint.config.mjs`)상 레이어는 `app → widgets → features → entities → shared` 순이며, app page는 widgets·shared를, 위젯은 entities·shared를 하위 참조하므로 규칙을 만족한다.

## 데이터 모델

```ts
// FSD 레이어 (eslint.config.mjs boundaries 정의와 동일): app → widgets → features → entities → shared.
// cron 라우트는 app 레이어(src/app/api/cron/*)의 진입점, DB 스키마는 shared 레이어(shared/lib/db) 하위다.
type Layer = "app" | "widgets" | "features" | "entities" | "shared";

interface GraphNode {
  id: string;              // 안정 키
  layer: Layer;
  label: string;           // 표시명 (예: "createMemoAction")
  path: string;            // 파일 경로 (repo-relative)
  symbol?: string;         // 함수/컴포넌트/테이블 심볼
  role: string;            // 한 문장 역할 (한국어)
  keyExports?: string[];   // 주요 export 시그니처
  dependsOn?: string[];    // 의존 노드/모듈
  maintenance?: MaintenanceEntry[];
  warning?: string;        // ⚠️ 함정 (인라인 경고)
}

interface FlowEdge { from: string; to: string; label?: string }  // label: "after()", "FK", "JOIN" 등

type Trigger = "user" | "cron" | "after";           // 원자 트리거

interface Flow {
  id: string;
  label: string;                                    // 칩 라벨
  summary: string;
  triggers: Trigger[];                              // 조합 표현 (예: ["after","cron"] = after 즉시경로 + cron sweep 폴백)
  llm: { model: string; touchpoint: string } | null;
  async: boolean;
  idempotencyKey: string | null;                    // 🔑 재실행 안전 마커
  nodeIds: string[];                                // 흐름이 지나는 노드 순서
  edges: FlowEdge[];
}
```

`trigger`를 단일 유니온이 아니라 **`triggers: Trigger[]` 배열**로 둔다 — 워크플로우 1(작성=`["user","after"]`), 2·4(분류·추출=`["after","cron"]`, after 즉시경로 + cron sweep 폴백)처럼 한 흐름이 여러 진입점을 갖는 실제 구조를 정확히 표현하기 위함. 칩 배지는 배열을 순회해 트리거 아이콘을 모두 표시(👆user·📨after·⏰cron).

```ts

interface MaintenanceEntry {
  task: string;            // "분류 프롬프트 수정"
  where: string;           // "classifyMemo.ts:buildSystemPrompt"
  how: string;             // 방법 설명
  command?: string;        // 복사 가능 명령 (curl/pnpm/psql/INSERT)
  warning?: string;        // ⚠️ 주의
}
```

## 담을 8개 크로스레이어 워크플로우 (조사 확정)

1. **메모 작성 → AI 정리 → 승인 저장 → 백그라운드 분류·액션추출** (user+after, LLM Sonnet 정리, async) — 대표 write path, 전 레이어 관통
2. **메모 자동 분류** (after+cron, Haiku, 🔑`category IS NULL`) — `memo-classify` 23분 sweep. upsertCategory→setMemoCategory 순서 (FK)
3. **메모 변환(프리셋)** (user, 프리셋 모델, sync) — 미리보기→승인, `upsertTransformation`
4. **메모 액션 추출** (after+cron, Sonnet, 🔑`actionsExtractedAt` claim-first) — `memo-extract-actions` 41분, 48h 창
5. **액션 상태 전이** (user, no-LLM, `ACTION_ITEM_ALLOWED_FROM` 상태기계)
6. **기한 리마인더 push** (cron, no-LLM, 🔑`remindedAt`) — `memo-action-reminders` 37분
7. **주간 다이제스트 + 백필** (cron, Sonnet, 🔑`unique(user_id,week_end)`) — `memo-digest` 매일 19:05, 오래된 순 컷(PR #297)
8. **메모 검색 + 카테고리 필터** (user, no-LLM, 읽기전용) — ILIKE 다중필드, `SEARCH_MEMOS_LIMIT+1` 절단판별

## 화면 레이아웃

```
┌─────────────────────────────────────────────────────────────┐
│  메모 시스템 아키텍처                              [← 메모]    │
│  [워크플로우 그래프]  [유지보수 색인]   ← 탭                   │
├─────────────────────────────────────────────────────────────┤
│  ① 워크플로우 선택 레일 (8개 흐름 칩, 각 칩에 트리거·LLM 배지) │
├─────────────────────────────────────────────────────────────┤
│  ② 계층 그래프 (선택 흐름을 FSD 레이어 컬럼 위에)             │
│   app   │ widgets │ features  │ entities   │ shared          │
│  Page  ─▶ Widget ─▶ Composer ─▶ createMemo ─▶ memos (db)     │
│  cron⏰ ─────────────────────▶ classify ───▶ memo_categories │
│                     ▼ after()                                │
│   흐름 배지: 🤖모델 · ⚡async · 🔑멱등키 · ⏰트리거           │
│   (선택 안 된 흐름 노드는 흐리게)                             │
├─────────────────────────────────────────────────────────────┤
│  ③ 노드 상세 패널 (클릭 시, 접힘 가능)                        │
│    경로 · 역할 · 주요 export · 의존 · ⚠️함정 · 유지보수 명령  │
│    curl -X POST http://localhost:3020/api/cron/memo-classify │
│      -H "Authorization: Bearer $CRON_BEARER_TOKEN"    [복사]  │
└─────────────────────────────────────────────────────────────┘
```

**레이어 컬럼 정의 (5개, ESLint boundaries와 동일)**: `app → widgets → features → entities → shared` 순으로 왼→오 배치(FSD 의존 방향). 두 가지 진입점이 `app` 레이어를 공유한다 — 사용자 라우트(`src/app/(dashboard)/…/page.tsx`)와 cron 라우트(`src/app/api/cron/*/route.ts`). cron 노드는 `app` 컬럼에 두되 ⏰ 표식으로 구분한다. **DB 테이블은 별도 컬럼이 아니라 `shared` 레이어**의 노드(`shared/lib/db/schema/memo.ts`의 각 테이블)로 표기하고, DB 노드임을 `(db)` 서브라벨로 나타낸다.

- **한 번에 하나의 흐름**에 집중: 선택된 흐름 노드/엣지만 진하게, 나머지는 흐리게.
- **흐름 배지**: LLM 모델(🤖 Haiku/Sonnet/없음), async(⚡), 멱등키(🔑), 트리거(⏰cron/👆user/📨after — `triggers` 배열을 모두 표시).
- 노드 클릭 → 하단 상세 패널: `파일:심볼`, 역할, 주요 export, 의존, ⚠️함정(인라인), 유지보수 명령어(복사 버튼, `Authorization: Bearer $CRON_BEARER_TOKEN` 형식).

## 유지보수 색인 탭

top 유지보수 시나리오를 검색 가능한 표로. 컬럼: **작업 / 어디를(파일:심볼) / 어떻게(명령·문장) / ⚠️주의**. 각 행의 `command` 필드는 복사 버튼 코드블록으로 렌더하며, **완전히 복사 가능한 형태**(placeholder는 `$VAR`, 생략 없음)여야 한다 — `...` 같은 불완전 조각 금지. 조사가 확정한 시나리오와 각 `command`:

- **메모 cron 4종 로컬 수동 트리거** — `classifyMemo` 등 route. `command`(각 cron별 4행):
  ```bash
  curl -X POST http://localhost:3020/api/cron/memo-classify         -H "Authorization: Bearer $CRON_BEARER_TOKEN"
  curl -X POST http://localhost:3020/api/cron/memo-digest           -H "Authorization: Bearer $CRON_BEARER_TOKEN"
  curl -X POST http://localhost:3020/api/cron/memo-extract-actions  -H "Authorization: Bearer $CRON_BEARER_TOKEN"
  curl -X POST http://localhost:3020/api/cron/memo-action-reminders -H "Authorization: Bearer $CRON_BEARER_TOKEN"
  ```
- **분류 프롬프트·모델·토큰 수정** — `classifyMemo.ts:buildSystemPrompt` / `HAIKU_MODEL`. ⚠️ `MemoCategoryResponseSchema`에 slug regex 금지. `command`: `pnpm typecheck && pnpm lint`
- **새 카테고리 태그 추가(코드 없이)** — `memo_categories` INSERT(마이그레이션 0044 참조). `command`:
  ```bash
  psql "$DATABASE_URL" -c "INSERT INTO memo_categories (id,label_ko,is_seed) VALUES ('meeting-log','회의록',false) ON CONFLICT DO NOTHING;"
  ```
- **고정 상수 LLM 작업 모델 변경(정리·분류·추출·다이제스트)** — 각 파일 모델 상수를 직접 교체: 정리=`cleanup-transcript.ts:CLEANUP_MODEL`, 분류=`shared/lib/llm/anthropic.ts:HAIKU_MODEL`(classifyMemo가 참조), 추출=`extractMemoActions.ts:EXTRACT_MODEL`, 다이제스트=`generateWeeklyDigest.ts:DIGEST_MODEL`. ⚠️ 생성 계열(정리·추출·다이제스트)은 haiku 금지(이메일 초안 거절 전례). ⚠️ **`HAIKU_MODEL`은 메모 전용이 아니다** — `shared/lib/llm/anthropic.ts`의 공유 상수라 메모 분류(`classifyMemo.ts`)뿐 아니라 **이메일 답장 분류(`classify-thread.ts`)·중요도 분류(`classify-important.ts`)도 함께 사용**한다. 이 상수를 바꾸면 이메일 분류 모델까지 동시에 바뀐다. 메모 분류 모델만 독립 변경하려면 먼저 메모 전용 상수(예: `MEMO_CLASSIFY_MODEL`)를 분리해 `classifyMemo.ts`만 그것을 참조하게 해야 한다. `command`: `cd apps/dashboard && pnpm build`
- **변환(transform) 모델 변경 — 상수 아님, 프리셋 경유** — 변환은 고정 상수가 없다. 사용자 프리셋 모델(`memo_transform_presets.model`/`model_id`)을 우선 사용하고, 미지정이면 `getDefaultMemoModel`(전체 기본 모델)을 상속한다. 해석은 `features/memo-transform/lib/preset-resolver.ts:resolvePreset`, 실제 호출은 `transform-memo.ts`가 `preset.modelId`로. 기본값·폴백 조정은 프리셋 설정 UI(`/memos/settings`) 또는 폴백 env `MEMO_LLM_MODEL_{CLAUDE,CODEX,GEMINI}`. `HAIKU_MODEL`은 분류 전용이라 변환과 무관. `command`: `cd apps/dashboard && pnpm build`
- **새 빌트인 프리셋 추가** — **3개 파일, 4개 정의를 함께** 갱신: `entities/memo/model/types.ts`의 `TRANSFORM_PRESET_IDS`(ID 튜플) + `TRANSFORM_PRESET_LABELS`(라벨 레코드), `features/memo-transform/lib/prompts.ts`의 `PRESET_INSTRUCTIONS`, `features/memo-transform/lib/preset-meta.ts`의 `TRANSFORM_PRESETS`(`{minInputLen, strictPreserve}`). Record 타입이라 하나 빠뜨리면 tsc가 잡는다. `command`: `pnpm typecheck`
- **액션 상태기계 수정** — `actionItem.ts:ACTION_ITEM_ALLOWED_FROM`. ⚠️ DB CHECK·fixture 동기. `command`: `pnpm typecheck && pnpm test`
- **다이제스트 백필·주차경계·재부상** — `week.ts:enumerateMissingWeekEnds`. ⚠️ 오래된 순 컷 유지(PR #297). `command`: `pnpm test`
- **cron 스케줄 변경** — `apps/cron/scheduler.js`(crontab 문자열 + 하단 콘솔 로그 동기). ⚠️ cron 컨테이너는 Docker로만 빌드(GHA가 `apps/cron` 컨텍스트로 `ghcr.io/krdn/gons-dashboard-cron:latest` 푸시)라 로컬 pnpm으로 안 돌고 **이미지 빌드 + 운영 컨테이너 교체까지** 해야 반영됨. `gh run watch`는 빌드 대기일 뿐 — `pull` + `up -d cron`으로 실제 교체 필수(CLAUDE.md §운영 배포, RUNBOOK). `command`:
  ```bash
  set -e
  COMPOSE="/home/gon/projects/gon/gons-dashboard/docker-compose.yml"
  gh run watch                                                       # GHA 이미지 빌드 완료 대기
  docker --context home-server compose -f "$COMPOSE" pull cron       # 새 cron 이미지 받기
  docker --context home-server compose -f "$COMPOSE" up -d cron      # 컨테이너 교체
  ```
- **운영 DB 마이그레이션 선적용** — ⚠️ `db:migrate`가 운영 tracking 인식 못 함(우회 필수). 새 마이그레이션 SQL 파일을 psql `-f`로 트랜잭션 적용한 뒤 이미지 배포. ⚠️ **운영 daemon 대상은 반드시 `docker --context home-server`**(alias `dserver`) — plain `docker`는 로컬 context(`default`)를 대상으로 해 운영이 아닌 로컬에 적용되는 사고(CLAUDE.md §운영 배포, RUNBOOK 인프라 요약). ⚠️ psql에 **`-v ON_ERROR_STOP=1`** 필수 — 없으면 SQL 오류에도 계속 진행해 silent partial-apply. 운영 DB명은 `gons_dashboard`. `command`(`$MIGRATION_FILE`에 실제 파일 경로 지정 — 예: `apps/dashboard/drizzle/0045_*.sql`. 현재 최신은 0044이므로 다음 마이그레이션 기준):
  ```bash
  set -e
  MIGRATION_FILE="apps/dashboard/drizzle/0045_new_migration.sql"   # ← 실제 파일로 교체
  test -f "$MIGRATION_FILE"                                         # 없으면 여기서 중단(fail-closed)
  REMOTE="/tmp/$(basename "$MIGRATION_FILE")"                       # 고정 /tmp/mig.sql 재사용 사고 방지
  docker --context home-server cp "$MIGRATION_FILE" "gons-dashboard-postgres:$REMOTE"
  docker --context home-server exec gons-dashboard-postgres \
    psql -U gons -d gons_dashboard -v ON_ERROR_STOP=1 --single-transaction -f "$REMOTE"
  docker --context home-server exec gons-dashboard-postgres rm -f "$REMOTE"
  ```
  (`set -e`로 `cp` 실패 시 psql 미실행 — 이전 작업의 잔여 `/tmp` SQL 재적용 차단. `--single-transaction`이 파일 전체를 BEGIN/COMMIT으로 감싸 오류 시 자동 롤백. 적용 후 remote 파일 삭제.)

**시크릿·연결정보 규칙**: `command` 문자열에는 `$CRON_BEARER_TOKEN`, `$DATABASE_URL` 같은 **환경변수 참조만** 넣고 실제 값·호스트·비밀번호를 평문으로 두지 않는다. `architecture-graph.ts` 데이터에도 동일 규칙 적용.

## 인라인 함정(⚠️) — 해당 노드에 경고 표시

- `MemoCategoryResponseSchema`에 slug regex 금지 (throw→llm-unavailable→etc fallback 도달 실패→무한 미분류, 커밋 5699622)
- `gatewayDefaults` provider는 `claude-cli` (`anthropic`이면 `/v1` 누락→404)
- `enumerateMissingWeekEnds` 오래된 순 컷 유지 (최신 우선이면 커서가 4주 초과 공백 잔여 주 영구 스킵, PR #297)
- `insertActionItemsAndMark` claim-first 순서 (뒤집으면 after↔cron 경합 중복 삽입)
- server/client barrel seam (`client.ts`에 repo 함수 금지 — DB import가 client 번들로 끌려가 build 실패, Gotcha #1·#7)
- LLM 관측(`logLlmSpend`)은 best-effort try/catch (throw가 성공 분류를 뒤집지 않게, PR #161)
- push 뒤 `markActionItemReminded`는 별도 try (같은 try면 double-send, PR #157)

## 스타일·검증

- 라이트모드 고정 (`globals.css` 디자인 토큰), 기존 `PageContainer`(narrow)·`PageHeader` 재사용
- 시각 표기는 locale-free (hydration mismatch 회피, Gotcha #3) — 이 페이지는 시각 표시 없음이라 사실상 무관하나 관례 준수
- 시크릿(`CRON_BEARER_TOKEN` 등)은 화면·데이터·주석 어디에도 평문 금지 — `$VAR` 플레이스홀더만
- 검증: `pnpm typecheck && pnpm lint`, `cd apps/dashboard && pnpm build`(server/client seam 확인), `/memos/architecture` 실제 렌더 확인. 그래프 데이터는 정적이라 DB 없이 렌더되지만, **인증 가드는 반드시 검증**한다 — 로그아웃 상태(또는 세션 쿠키 제거)로 접근 시 `/login` redirect 확인, 로그인 상태로 접근 시 정상 렌더 확인 (dev OAuth 세션 재사용 패턴으로 인증 상태 테스트).

## v1 범위 밖 (의도적 제외)

- DB 스키마 ER 다이어그램 탭 (DB 레이어는 그래프 노드에 포함, 별도 탭은 YAGNI)
- 런타임 데이터 연동 (실제 메모 수·cron 최근 실행 상태 등 — 정적 구조도로 확정)
- 그래프 자동 레이아웃 엔진 (8개 흐름은 데이터에 좌표/순서를 직접 기술, 자동 배치 불필요)
