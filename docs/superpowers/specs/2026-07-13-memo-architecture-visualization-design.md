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
route:   app/(dashboard)/memos/architecture/page.tsx   # RSC, 정적. 데이터 import만, DB/LLM 의존 없음
widget:  widgets/memo-architecture/
  ui/MemoArchitectureView.tsx   # "use client" — 흐름 선택·노드 펼침·탭 전환·복사 오케스트레이션
  ui/WorkflowGraph.tsx          # 선택된 흐름을 5개 레이어 컬럼 위에 렌더
  ui/LayerColumns.tsx           # FSD 레이어 배경 그리드 (app→widget→feature→entity→db·cron)
  ui/FlowChips.tsx              # 8개 워크플로우 선택 레일
  ui/GraphNode.tsx              # 파일:심볼 노드 (클릭 → 상세)
  ui/GraphEdge.tsx              # 노드 간 SVG 엣지 (라벨: after()/FK/JOIN 등)
  ui/NodeDetailPanel.tsx        # 선택 노드의 역할·심볼·의존·유지보수 명령어
  ui/MaintenanceIndex.tsx       # 유지보수 색인 탭 (검색 가능 표)
  ui/CopyableCommand.tsx        # 복사 버튼 코드블록
  model/architecture-graph.ts   # ⭐ 정적 데이터 — 진실의 원천 (조사 결과 타입화)
  model/types.ts                # Flow / GraphNode / Layer / MaintenanceEntry 타입
  index.ts                      # barrel — MemoArchitectureView export
```

**설계 원칙**: 데이터/렌더 분리. `architecture-graph.ts`가 흐름·노드·엣지·명령어를 담고, 컴포넌트는 순수 렌더러. 메모 시스템이 바뀌면 이 데이터 파일 한 곳만 갱신한다. 페이지는 정적이라 인증 외 서버 의존이 없다 (RSC에서 데이터를 코드로 import).

**FSD 의존 방향**: `widgets/memo-architecture`는 `entities/memo/client`(타입)와 `shared/ui`(PageContainer, PageHeader)만 참조. features 미참조 — 이 위젯은 메모 도메인을 *설명*할 뿐 *실행*하지 않으므로 실제 feature 코드를 import하지 않는다. 그래프 데이터는 코드 심볼을 **문자열로** 참조(실제 import 아님).

## 데이터 모델

```ts
type Layer = "app" | "widget" | "feature" | "entity" | "db-cron";

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

interface Flow {
  id: string;
  label: string;                                    // 칩 라벨
  summary: string;
  trigger: "user" | "cron" | "after" | "user+cron";
  llm: { model: string; touchpoint: string } | null;
  async: boolean;
  idempotencyKey: string | null;                    // 🔑 재실행 안전 마커
  nodeIds: string[];                                // 흐름이 지나는 노드 순서
  edges: FlowEdge[];
}

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
│    app  │ widget │ feature   │ entity     │ db·cron          │
│   Page ─▶ Widget ─▶ Composer ─▶ createMemo ─▶ memos          │
│                     ▼ after()                                │
│                     classify ─────────────▶ memo_categories  │
│   흐름 배지: 🤖모델 · ⚡async · 🔑멱등키 · ⏰트리거           │
│   (선택 안 된 흐름 노드는 흐리게)                             │
├─────────────────────────────────────────────────────────────┤
│  ③ 노드 상세 패널 (클릭 시, 접힘 가능)                        │
│    경로 · 역할 · 주요 export · 의존 · ⚠️함정 · 유지보수 명령  │
│    [$ curl -X POST .../memo-classify -H "Auth: Bearer $..."] │
└─────────────────────────────────────────────────────────────┘
```

- **5개 레이어 컬럼**: FSD 의존 방향(`app→widget→feature→entity→shared/db·cron`)을 왼→오로. cron은 별도 진입점이라 db 컬럼과 묶되 시각적으로 구분(⏰ 표식).
- **한 번에 하나의 흐름**에 집중: 선택된 흐름 노드/엣지만 진하게, 나머지는 흐리게.
- **흐름 배지**: LLM 모델(🤖 Haiku/Sonnet/없음), async(⚡), 멱등키(🔑), 트리거(⏰cron/👆user/📨after).
- 노드 클릭 → 하단 상세 패널: `파일:심볼`, 역할, 주요 export, 의존, ⚠️함정(인라인), 유지보수 명령어(복사).

## 유지보수 색인 탭

top 유지보수 시나리오를 검색 가능한 표로. 컬럼: **작업 / 어디를(파일:심볼) / 어떻게(명령·문장) / ⚠️주의**. 각 행의 명령어는 복사 버튼. 조사가 확정한 시나리오:

- 메모 cron 4종 로컬 수동 트리거 (`curl -X POST http://localhost:3020/api/cron/<name> -H "Authorization: Bearer $CRON_BEARER_TOKEN"`)
- 분류 프롬프트·모델·토큰 수정 (`classifyMemo.ts:buildSystemPrompt` / `HAIKU_MODEL` / ⚠️ `MemoCategoryResponseSchema`에 slug regex 금지)
- 새 카테고리 태그 추가 코드 없이 (`INSERT INTO memo_categories (id,label_ko,is_seed) VALUES (...) ON CONFLICT DO NOTHING` — 마이그레이션 0044 참조)
- 변환/추출/다이제스트/정리 LLM 모델 변경 (각 파일 모델 상수 / ⚠️ 생성 계열 haiku 금지)
- 새 빌트인 프리셋 추가 (3곳 동시: `TRANSFORM_PRESET_IDS`+`PRESET_INSTRUCTIONS`+`preset-meta`)
- 액션 상태기계 수정 (`actionItem.ts:ACTION_ITEM_ALLOWED_FROM` / DB CHECK·fixture 동기)
- 다이제스트 백필·주차경계·재부상 (`week.ts:enumerateMissingWeekEnds` / ⚠️ 오래된 순 컷 유지 PR #297)
- cron 스케줄 변경 (`apps/cron/scheduler.js` / ⚠️ 이미지 재배포 필요)
- 운영 DB 마이그레이션 선적용 (⚠️ `db:migrate` 우회, psql `BEGIN/COMMIT` 수동 → 이미지 배포)

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
- 검증: `pnpm typecheck && pnpm lint`, `cd apps/dashboard && pnpm build`(server/client seam 확인), `/memos/architecture` 실제 렌더 확인(정적이라 DB 불필요)

## v1 범위 밖 (의도적 제외)

- DB 스키마 ER 다이어그램 탭 (DB 레이어는 그래프 노드에 포함, 별도 탭은 YAGNI)
- 런타임 데이터 연동 (실제 메모 수·cron 최근 실행 상태 등 — 정적 구조도로 확정)
- 그래프 자동 레이아웃 엔진 (8개 흐름은 데이터에 좌표/순서를 직접 기술, 자동 배치 불필요)
