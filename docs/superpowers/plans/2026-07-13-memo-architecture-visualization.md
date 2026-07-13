# 메모 아키텍처 시각화 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모 시스템의 구조·워크플로우·유지보수 진입점을 계층적 인터랙티브 그래프로 보여주는 정적 페이지(`/memos/architecture`)를 만든다.

**Architecture:** 정적 데이터(`architecture-graph.ts`)가 진실의 원천이고 React 컴포넌트는 순수 렌더러다. FSD 위젯 `widgets/memo-architecture`가 그래프를 렌더하고, `page.tsx`(app 레이어)가 `auth()` 가드 후 그래프 데이터를 props로 주입한다. 런타임 DB/LLM 조회 없음.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript strict, Tailwind CSS v4(라이트 모드 고정), Vitest + @testing-library/react(jsdom).

## Global Constraints

- FSD 의존 방향: `app → widgets → features → entities → shared`. 위젯은 `entities/memo/client`(타입)와 `shared`만 하위 참조. features·`entities/*/server` 미참조.
- 모든 외부 import는 위젯 barrel `index.ts` 경유 (deep import 금지).
- `page.tsx`는 per-page 인증 필수: `const session = await auth(); if (!session?.user?.id) redirect("/login");` — layout에 가드 없음.
- 라이트 모드 고정 (`globals.css` 디자인 토큰 사용, 하드코딩 색상 금지).
- 시크릿은 데이터·화면·주석 어디에도 평문 금지 — `$VAR` 플레이스홀더만 (`$CRON_BEARER_TOKEN`, `$DATABASE_URL` 등).
- 외부 라이브러리 의존 추가 금지 (자체 SVG/CSS만).
- 클라이언트 시각 표기는 locale-free (hydration mismatch 회피) — 이 페이지엔 시각 표시 없음이라 사실상 무관.
- 컴포넌트 테스트는 파일 상단에 `// @vitest-environment jsdom` + `@testing-library/react`의 `render`/`cleanup`. 순수 로직은 노드 환경(기본).
- 검증 게이트: `pnpm typecheck && pnpm lint`, `cd apps/dashboard && pnpm build`(server/client seam 확인), `/memos/architecture` 실제 렌더 + 로그아웃 접근 시 `/login` redirect 확인.
- spec 원본: `docs/superpowers/specs/2026-07-13-memo-architecture-visualization-design.md` (커밋 b882aea).

---

## File Structure

```
apps/dashboard/src/
├── widgets/memo-architecture/
│   ├── model/
│   │   ├── types.ts                 # Layer, Trigger, GraphNode, FlowEdge, Flow, MaintenanceEntry, ArchitectureGraph 타입
│   │   ├── architecture-graph.ts     # ⭐ ARCHITECTURE_GRAPH 정적 데이터 (진실의 원천)
│   │   └── architecture-graph.test.ts # 데이터 무결성 테스트 (노드 참조·시크릿 없음 등)
│   ├── ui/
│   │   ├── FlowChips.tsx             # 8개 흐름 선택 칩 + 트리거/LLM 배지
│   │   ├── WorkflowGraph.tsx         # 선택 흐름을 레이어 컬럼 위에 렌더 (SVG 엣지 + 노드)
│   │   ├── GraphNode.tsx             # 파일:심볼 노드 (클릭 콜백)
│   │   ├── NodeDetailPanel.tsx       # 선택 노드 상세 (역할·의존·⚠️함정·유지보수 명령)
│   │   ├── CopyableCommand.tsx       # 복사 버튼 코드블록
│   │   ├── CopyableCommand.test.tsx  # 복사 상호작용 테스트
│   │   ├── MaintenanceIndex.tsx      # 유지보수 색인 탭 (검색 가능 표)
│   │   ├── MaintenanceIndex.test.tsx # 검색 필터 테스트
│   │   └── MemoArchitectureView.tsx  # "use client" 최상위 — 탭·흐름선택·노드선택 오케스트레이션
│   └── index.ts                     # barrel: MemoArchitectureView, ARCHITECTURE_GRAPH, 타입
└── app/(dashboard)/memos/architecture/
    └── page.tsx                     # RSC: auth 가드 + PageContainer/PageHeader + MemoArchitectureView
```

**연결(마지막)**: `app/(dashboard)/memos/page.tsx`의 PageHeader `actions`에 `/memos/architecture` 링크 추가.

각 Task는 위 파일 하나(또는 밀접한 짝)를 완성하고 독립적으로 테스트/커밋한다. Task 순서 = 의존 순서(타입 → 데이터 → 순수 UI 프리미티브 → 조합 → 페이지 → 링크).

---

### Task 1: 그래프 도메인 타입

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/model/types.ts`

**Interfaces:**
- Consumes: (없음)
- Produces: `Layer`, `Trigger`, `GraphNode`, `FlowEdge`, `Flow`, `MaintenanceEntry`, `ArchitectureGraph` 타입. 이후 모든 Task가 이 타입을 import.

- [ ] **Step 1: 타입 파일 작성**

```ts
// apps/dashboard/src/widgets/memo-architecture/model/types.ts
// 메모 아키텍처 시각화 — 순수 데이터 타입 (client-safe, 의존 없음).

// FSD 레이어 (eslint.config.mjs boundaries와 동일). cron 라우트는 app,
// DB 스키마는 shared 하위.
export type Layer = "app" | "widgets" | "features" | "entities" | "shared";

// 원자 트리거. Flow.triggers 배열이 조합을 표현.
export type Trigger = "user" | "cron" | "after";

export interface GraphNode {
  id: string; // 안정 키
  layer: Layer;
  label: string; // 표시명 (예: "createMemoAction")
  path: string; // repo-relative 파일 경로
  symbol?: string; // 함수/컴포넌트/테이블 심볼
  role: string; // 한 문장 역할 (한국어)
  keyExports?: string[];
  dependsOn?: string[];
  maintenance?: MaintenanceEntry[];
  warning?: string; // ⚠️ 인라인 함정
}

export interface FlowEdge {
  from: string; // GraphNode.id
  to: string; // GraphNode.id
  label?: string; // "after()", "FK", "JOIN" 등
}

export interface Flow {
  id: string;
  label: string;
  summary: string;
  triggers: Trigger[];
  llm: { model: string; touchpoint: string } | null;
  async: boolean;
  idempotencyKey: string | null; // 🔑 재실행 안전 마커
  nodeIds: string[]; // 흐름이 지나는 노드 순서
  edges: FlowEdge[];
}

export interface MaintenanceEntry {
  task: string;
  where: string; // "classifyMemo.ts:buildSystemPrompt"
  how: string;
  command?: string; // 복사 가능 명령 ($VAR 플레이스홀더)
  warning?: string;
}

export interface ArchitectureGraph {
  nodes: GraphNode[];
  flows: Flow[];
  maintenance: MaintenanceEntry[]; // 유지보수 색인 탭용 (노드에 안 묶인 것 포함)
}
```

- [ ] **Step 2: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS (새 타입만 추가, 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/model/types.ts
git commit -m "feat(memo-arch): 그래프 도메인 타입 추가"
```

---

### Task 2: 정적 그래프 데이터 + 무결성 테스트

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.ts`
- Test: `apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ArchitectureGraph`, `GraphNode`, `Flow`, `MaintenanceEntry`.
- Produces: `export const ARCHITECTURE_GRAPH: ArchitectureGraph`. UI 컴포넌트·page가 소비.

**주의:** 데이터 내용은 spec의 "8개 크로스레이어 워크플로우"·"유지보수 색인 탭"·"인라인 함정" 섹션에서 그대로 옮긴다. 아래 Step 3은 **최소 형태**를 보이고, 실제로는 spec의 8개 흐름·모든 노드·유지보수 항목을 전부 채운다. 시크릿은 `$VAR`만.

- [ ] **Step 1: 무결성 테스트 먼저 작성 (실패)**

```ts
// apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.test.ts
import { describe, it, expect } from "vitest";
import { ARCHITECTURE_GRAPH } from "./architecture-graph";

describe("ARCHITECTURE_GRAPH 무결성", () => {
  const { nodes, flows } = ARCHITECTURE_GRAPH;
  const nodeIds = new Set(nodes.map((n) => n.id));

  it("노드 id는 유일하다", () => {
    expect(nodeIds.size).toBe(nodes.length);
  });

  it("모든 flow.nodeIds는 실존 노드를 가리킨다", () => {
    for (const f of flows) {
      for (const id of f.nodeIds) expect(nodeIds.has(id)).toBe(true);
    }
  });

  it("모든 edge의 from/to는 실존 노드다", () => {
    for (const f of flows) {
      for (const e of f.edges) {
        expect(nodeIds.has(e.from)).toBe(true);
        expect(nodeIds.has(e.to)).toBe(true);
      }
    }
  });

  it("8개 워크플로우를 담는다", () => {
    expect(flows.length).toBe(8);
  });

  it("어떤 명령에도 평문 시크릿/운영 호스트가 없다 ($VAR만)", () => {
    const all = JSON.stringify(ARCHITECTURE_GRAPH);
    expect(all).not.toMatch(/192\.168\.\d+\.\d+/);
    expect(all).not.toMatch(/Bearer\s+[A-Za-z0-9]{12,}/);
    expect(all).not.toMatch(/CHANGE_ME|password\s*=\s*\S/i);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/widgets/memo-architecture/model/architecture-graph.test.ts`
Expected: FAIL ("Cannot find module './architecture-graph'")

- [ ] **Step 3: 그래프 데이터 작성**

spec의 8개 흐름·노드·유지보수·함정을 전부 옮긴다. 골격(축약 예시 — 실제로는 8흐름 전부):

```ts
// apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.ts
// 메모 시스템 아키텍처 — 정적 데이터(진실의 원천). 시스템 변경 시 이 파일만 갱신.
// 시크릿은 절대 평문 금지 — $VAR 플레이스홀더만.
import type { ArchitectureGraph } from "./types";

export const ARCHITECTURE_GRAPH: ArchitectureGraph = {
  nodes: [
    {
      id: "page-memos",
      layer: "app",
      label: "MemosPage",
      path: "apps/dashboard/src/app/(dashboard)/memos/page.tsx",
      role: "메모 라우트 RSC — auth 후 서버 데이터 5종 병렬 fetch해 MemoWidget에 주입",
      dependsOn: ["widget-memo"],
    },
    {
      id: "compose-createMemoAction",
      layer: "features",
      label: "createMemoAction",
      path: "apps/dashboard/src/features/memo-compose/api/createMemoAction.ts",
      symbol: "createMemoAction",
      role: "메모 저장 Server Action — createMemo 후 after()로 분류·액션추출 백그라운드 킥",
      dependsOn: ["memoRepo-createMemo"],
      warning: "after() fire-and-forget는 탭 직렬 큐 점유 — 반드시 after()+cron sweep 폴백 패턴",
    },
    {
      id: "classify-classifyMemo",
      layer: "entities",
      label: "classifyAndPersistMemoCategory",
      path: "apps/dashboard/src/entities/memo/api/classifyMemo.ts",
      symbol: "classifyAndPersistMemoCategory",
      role: "Haiku 분류 → upsertCategory(FK 먼저) → setMemoCategory. 이미 분류된 행 skip(멱등)",
      warning: "MemoCategoryResponseSchema에 slug regex 금지 — throw가 llm-unavailable로 잡혀 etc fallback 도달 실패",
      maintenance: [
        {
          task: "분류 프롬프트 수정",
          where: "classifyMemo.ts:buildSystemPrompt",
          how: "템플릿 문자열 편집. 응답 스키마에 slug regex 넣지 말 것(파싱 후 isValidCategorySlug로 검증).",
          command: "pnpm typecheck && pnpm lint",
        },
      ],
    },
    {
      id: "table-memos",
      layer: "shared",
      label: "memos (db)",
      path: "apps/dashboard/src/shared/lib/db/schema/memo.ts",
      symbol: "memos",
      role: "메모 본체 테이블. category → memo_categories FK(ON DELETE set null)",
    },
    // ... spec의 나머지 노드 전부 (8개 흐름이 지나는 모든 파일:심볼)
  ],
  flows: [
    {
      id: "write-path",
      label: "작성→저장→백그라운드",
      summary: "음성/텍스트 메모를 AI 정리 후 승인 저장, after()로 분류·액션추출 백그라운드 킥",
      triggers: ["user", "after"],
      llm: { model: "claude-sonnet-5", touchpoint: "정리(cleanup)" },
      async: true,
      idempotencyKey: null,
      nodeIds: ["page-memos", "compose-createMemoAction", "memoRepo-createMemo", "table-memos"],
      edges: [
        { from: "page-memos", to: "compose-createMemoAction", label: "render" },
        { from: "compose-createMemoAction", to: "memoRepo-createMemo", label: "createMemo" },
        { from: "memoRepo-createMemo", to: "table-memos", label: "INSERT" },
      ],
    },
    // ... spec의 나머지 7개 흐름 (자동분류/변환/액션추출/상태전이/리마인더/다이제스트/검색) 전부
  ],
  maintenance: [
    {
      task: "메모 cron 4종 로컬 수동 트리거",
      where: "app/api/cron/{memo-classify,memo-digest,memo-extract-actions,memo-action-reminders}/route.ts",
      how: "각 cron을 로컬 dev 서버에 POST. 토큰 불일치 시 401.",
      command: 'curl -X POST http://localhost:3020/api/cron/memo-classify -H "Authorization: Bearer $CRON_BEARER_TOKEN"',
    },
    // ... spec 유지보수 색인 탭의 나머지 항목 전부 (새 카테고리 INSERT, 모델 변경,
    //     프리셋 3파일 4정의, 액션 상태기계, 다이제스트 백필, cron 재배포(pull+up),
    //     운영 마이그레이션 fail-closed 등 — spec에서 command까지 그대로 복사)
  ],
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd apps/dashboard && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/widgets/memo-architecture/model/architecture-graph.test.ts`
Expected: PASS (5개 테스트, flows.length === 8)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.ts apps/dashboard/src/widgets/memo-architecture/model/architecture-graph.test.ts
git commit -m "feat(memo-arch): 정적 그래프 데이터 + 무결성 테스트"
```

---

### Task 3: CopyableCommand (복사 버튼 코드블록)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.tsx`
- Test: `apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.test.tsx`

**Interfaces:**
- Consumes: (없음 — 순수 프리미티브)
- Produces: `CopyableCommand({ command }: { command: string })` — 코드블록 + 복사 버튼.

- [ ] **Step 1: 테스트 먼저 작성 (실패)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CopyableCommand } from "./CopyableCommand";

afterEach(cleanup);

describe("CopyableCommand", () => {
  it("명령 문자열을 <code>로 렌더한다", () => {
    render(<CopyableCommand command="pnpm typecheck" />);
    expect(screen.getByText("pnpm typecheck")).toBeTruthy();
  });

  it("복사 버튼 클릭 시 clipboard.writeText를 명령으로 호출한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyableCommand command="curl ..." />);
    fireEvent.click(screen.getByRole("button", { name: /복사/ }));
    expect(writeText).toHaveBeenCalledWith("curl ...");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm test src/widgets/memo-architecture/ui/CopyableCommand.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.tsx
"use client";
import { useState } from "react";

export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-[var(--color-surface-2)] p-2">
      <code className="flex-1 whitespace-pre-wrap break-all text-xs text-[var(--color-text)]">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="복사"
        className="shrink-0 rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]"
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}
```

(참고: `--color-surface-*` 토큰이 `globals.css`에 없으면 존재하는 토큰으로 교체 — 구현 전 `grep "color-surface" apps/dashboard/src/app/globals.css`로 확인.)

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && pnpm test src/widgets/memo-architecture/ui/CopyableCommand.test.tsx`
Expected: PASS (2개)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.tsx apps/dashboard/src/widgets/memo-architecture/ui/CopyableCommand.test.tsx
git commit -m "feat(memo-arch): CopyableCommand 복사 버튼 코드블록"
```

---

### Task 4: GraphNode + NodeDetailPanel

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/GraphNode.tsx`
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/NodeDetailPanel.tsx`

**Interfaces:**
- Consumes: Task 1 `GraphNode` 타입, Task 3 `CopyableCommand`.
- Produces:
  - `GraphNode({ node, dimmed, selected, onSelect }: { node: GraphNodeType; dimmed: boolean; selected: boolean; onSelect: (id: string) => void })`
  - `NodeDetailPanel({ node }: { node: GraphNodeType | null })` — null이면 안내 문구.

- [ ] **Step 1: GraphNode 구현 (표시용 프리미티브, 순수)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/GraphNode.tsx
"use client";
import type { GraphNode as GraphNodeData } from "../model/types";

export function GraphNode({
  node,
  dimmed,
  selected,
  onSelect,
}: {
  node: GraphNodeData;
  dimmed: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className={[
        "rounded-md border px-2 py-1 text-left text-xs transition",
        selected ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]" : "border-[var(--color-border)]",
        dimmed ? "opacity-30" : "opacity-100",
      ].join(" ")}
    >
      <span className="font-medium">{node.label}</span>
      {node.warning && <span aria-hidden className="ml-1">⚠️</span>}
    </button>
  );
}
```

- [ ] **Step 2: NodeDetailPanel 구현**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/NodeDetailPanel.tsx
"use client";
import type { GraphNode } from "../model/types";
import { CopyableCommand } from "./CopyableCommand";

export function NodeDetailPanel({ node }: { node: GraphNode | null }) {
  if (!node) {
    return <p className="text-sm text-[var(--color-text-muted)]">노드를 클릭하면 상세가 표시됩니다.</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="font-mono text-xs text-[var(--color-text-muted)]">{node.path}</p>
      <p>{node.role}</p>
      {node.warning && (
        <p className="rounded bg-[var(--color-surface-2)] p-2 text-xs">⚠️ {node.warning}</p>
      )}
      {node.dependsOn?.length ? (
        <p className="text-xs text-[var(--color-text-muted)]">의존: {node.dependsOn.join(", ")}</p>
      ) : null}
      {node.maintenance?.map((m, i) => (
        <div key={i} className="space-y-1 border-t border-[var(--color-border)] pt-2">
          <p className="font-medium">{m.task}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{m.where} — {m.how}</p>
          {m.warning && <p className="text-xs">⚠️ {m.warning}</p>}
          {m.command && <CopyableCommand command={m.command} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/ui/GraphNode.tsx apps/dashboard/src/widgets/memo-architecture/ui/NodeDetailPanel.tsx
git commit -m "feat(memo-arch): GraphNode + NodeDetailPanel"
```

---

### Task 5: FlowChips + WorkflowGraph

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/FlowChips.tsx`
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/WorkflowGraph.tsx`

**Interfaces:**
- Consumes: Task 1 `Flow`/`GraphNode`/`Layer`/`Trigger`, Task 4 `GraphNode` 컴포넌트.
- Produces:
  - `FlowChips({ flows, selectedId, onSelect }: { flows: Flow[]; selectedId: string; onSelect: (id: string) => void })`
  - `WorkflowGraph({ flow, nodes, selectedNodeId, onSelectNode }: { flow: Flow; nodes: GraphNodeData[]; selectedNodeId: string | null; onSelectNode: (id: string) => void })`

**참고:** WorkflowGraph는 노드를 `layer`별 5개 컬럼(`app/widgets/features/entities/shared`)에 배치하고, 선택된 흐름의 `nodeIds`에 속한 노드만 진하게, 나머지는 dimmed로 렌더. 엣지는 CSS(레이어 순서상 왼→오)로 표현하거나 단순 화살표 라벨로. SVG 엣지는 v1에서 노드 위치 간 직선 1개 정도로 최소화(과설계 금지 — spec은 "자동 레이아웃 엔진 불필요"라 명시).

- [ ] **Step 1: FlowChips 구현 (트리거/LLM 배지 포함)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/FlowChips.tsx
"use client";
import type { Flow, Trigger } from "../model/types";

const TRIGGER_ICON: Record<Trigger, string> = { user: "👆", cron: "⏰", after: "📨" };

export function FlowChips({
  flows,
  selectedId,
  onSelect,
}: {
  flows: Flow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {flows.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onSelect(f.id)}
          aria-pressed={f.id === selectedId}
          className={[
            "rounded-full border px-3 py-1 text-xs transition",
            f.id === selectedId
              ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
              : "border-[var(--color-border)]",
          ].join(" ")}
        >
          <span>{f.label}</span>
          <span aria-hidden className="ml-1">
            {f.triggers.map((t) => TRIGGER_ICON[t]).join("")}
            {f.llm ? " 🤖" : ""}
            {f.async ? " ⚡" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: WorkflowGraph 구현 (레이어 컬럼)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/WorkflowGraph.tsx
"use client";
import type { Flow, GraphNode as GraphNodeData, Layer } from "../model/types";
import { GraphNode } from "./GraphNode";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "app", label: "app" },
  { key: "widgets", label: "widgets" },
  { key: "features", label: "features" },
  { key: "entities", label: "entities" },
  { key: "shared", label: "shared" },
];

export function WorkflowGraph({
  flow,
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  flow: Flow;
  nodes: GraphNodeData[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const active = new Set(flow.nodeIds);
  const byLayer = (layer: Layer) => nodes.filter((n) => n.layer === layer && active.has(n.id));
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-[var(--color-text-muted)]">
        {flow.summary}
        {flow.idempotencyKey ? ` · 🔑 ${flow.idempotencyKey}` : ""}
        {flow.llm ? ` · 🤖 ${flow.llm.model}` : ""}
      </p>
      <div className="grid min-w-[720px] grid-cols-5 gap-2">
        {LAYERS.map((l) => (
          <div key={l.key} className="space-y-2">
            <p className="text-center text-[10px] uppercase text-[var(--color-text-muted)]">{l.label}</p>
            {byLayer(l.key).map((n) => (
              <GraphNode
                key={n.id}
                node={n}
                dimmed={false}
                selected={n.id === selectedNodeId}
                onSelect={onSelectNode}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/ui/FlowChips.tsx apps/dashboard/src/widgets/memo-architecture/ui/WorkflowGraph.tsx
git commit -m "feat(memo-arch): FlowChips + WorkflowGraph 레이어 컬럼 렌더"
```

---

### Task 6: MaintenanceIndex (유지보수 색인 탭)

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.tsx`
- Test: `apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.test.tsx`

**Interfaces:**
- Consumes: Task 1 `MaintenanceEntry`, Task 3 `CopyableCommand`.
- Produces: `MaintenanceIndex({ entries }: { entries: MaintenanceEntry[] })` — 검색 입력 + 필터된 표.

- [ ] **Step 1: 검색 필터 테스트 먼저 작성 (실패)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MaintenanceIndex } from "./MaintenanceIndex";
import type { MaintenanceEntry } from "../model/types";

afterEach(cleanup);

const entries: MaintenanceEntry[] = [
  { task: "분류 프롬프트 수정", where: "classifyMemo.ts", how: "..." },
  { task: "cron 스케줄 변경", where: "scheduler.js", how: "..." },
];

describe("MaintenanceIndex", () => {
  it("전체 항목을 렌더한다", () => {
    render(<MaintenanceIndex entries={entries} />);
    expect(screen.getByText("분류 프롬프트 수정")).toBeTruthy();
    expect(screen.getByText("cron 스케줄 변경")).toBeTruthy();
  });

  it("검색어로 항목을 필터한다", () => {
    render(<MaintenanceIndex entries={entries} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cron" } });
    expect(screen.queryByText("분류 프롬프트 수정")).toBeNull();
    expect(screen.getByText("cron 스케줄 변경")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/dashboard && pnpm test src/widgets/memo-architecture/ui/MaintenanceIndex.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.tsx
"use client";
import { useMemo, useState } from "react";
import type { MaintenanceEntry } from "../model/types";
import { CopyableCommand } from "./CopyableCommand";

export function MaintenanceIndex({ entries }: { entries: MaintenanceEntry[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return entries;
    return entries.filter((e) =>
      [e.task, e.where, e.how, e.command ?? ""].some((s) => s.toLowerCase().includes(t)),
    );
  }, [q, entries]);
  return (
    <div className="space-y-3">
      <input
        type="search"
        role="searchbox"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="유지보수 작업 검색…"
        className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
      />
      <ul className="space-y-3">
        {filtered.map((e, i) => (
          <li key={i} className="space-y-1 rounded-md border border-[var(--color-border)] p-3">
            <p className="font-medium">{e.task}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{e.where} — {e.how}</p>
            {e.warning && <p className="text-xs">⚠️ {e.warning}</p>}
            {e.command && <CopyableCommand command={e.command} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/dashboard && pnpm test src/widgets/memo-architecture/ui/MaintenanceIndex.test.tsx`
Expected: PASS (2개)

- [ ] **Step 5: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.tsx apps/dashboard/src/widgets/memo-architecture/ui/MaintenanceIndex.test.tsx
git commit -m "feat(memo-arch): MaintenanceIndex 검색 가능 유지보수 색인 탭"
```

---

### Task 7: MemoArchitectureView + barrel

**Files:**
- Create: `apps/dashboard/src/widgets/memo-architecture/ui/MemoArchitectureView.tsx`
- Create: `apps/dashboard/src/widgets/memo-architecture/index.ts`

**Interfaces:**
- Consumes: Task 1~6 전부 (`ArchitectureGraph` 타입, FlowChips, WorkflowGraph, NodeDetailPanel, MaintenanceIndex).
- Produces:
  - `MemoArchitectureView({ graph }: { graph: ArchitectureGraph })` — "use client" 최상위.
  - barrel `index.ts`: `MemoArchitectureView`, `ARCHITECTURE_GRAPH`, 타입 re-export.

- [ ] **Step 1: MemoArchitectureView 구현 (탭·흐름선택·노드선택 상태)**

```tsx
// apps/dashboard/src/widgets/memo-architecture/ui/MemoArchitectureView.tsx
"use client";
import { useState } from "react";
import type { ArchitectureGraph } from "../model/types";
import { FlowChips } from "./FlowChips";
import { WorkflowGraph } from "./WorkflowGraph";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { MaintenanceIndex } from "./MaintenanceIndex";

type Tab = "graph" | "maintenance";

export function MemoArchitectureView({ graph }: { graph: ArchitectureGraph }) {
  const [tab, setTab] = useState<Tab>("graph");
  const [flowId, setFlowId] = useState(graph.flows[0]?.id ?? "");
  const [nodeId, setNodeId] = useState<string | null>(null);
  const flow = graph.flows.find((f) => f.id === flowId) ?? graph.flows[0];
  const node = graph.nodes.find((n) => n.id === nodeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-[var(--color-border)]">
        <TabButton active={tab === "graph"} onClick={() => setTab("graph")}>워크플로우 그래프</TabButton>
        <TabButton active={tab === "maintenance"} onClick={() => setTab("maintenance")}>유지보수 색인</TabButton>
      </div>
      {tab === "graph" ? (
        <div className="space-y-4">
          <FlowChips flows={graph.flows} selectedId={flowId} onSelect={setFlowId} />
          {flow && (
            <WorkflowGraph flow={flow} nodes={graph.nodes} selectedNodeId={nodeId} onSelectNode={setNodeId} />
          )}
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <NodeDetailPanel node={node} />
          </div>
        </div>
      ) : (
        <MaintenanceIndex entries={graph.maintenance} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "px-3 py-2 text-sm",
        active ? "border-b-2 border-[var(--color-accent)] font-medium" : "text-[var(--color-text-muted)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: barrel 작성**

```ts
// apps/dashboard/src/widgets/memo-architecture/index.ts
export { MemoArchitectureView } from "./ui/MemoArchitectureView";
export { ARCHITECTURE_GRAPH } from "./model/architecture-graph";
export type {
  ArchitectureGraph,
  GraphNode,
  Flow,
  FlowEdge,
  MaintenanceEntry,
  Layer,
  Trigger,
} from "./model/types";
```

- [ ] **Step 3: typecheck + lint (FSD boundary 확인)**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS (위젯이 features·entities/server 미참조 — boundary 규칙 통과)

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/src/widgets/memo-architecture/ui/MemoArchitectureView.tsx apps/dashboard/src/widgets/memo-architecture/index.ts
git commit -m "feat(memo-arch): MemoArchitectureView 조합 + barrel"
```

---

### Task 8: 페이지 라우트 (auth 가드)

**Files:**
- Create: `apps/dashboard/src/app/(dashboard)/memos/architecture/page.tsx`

**Interfaces:**
- Consumes: Task 7 barrel (`MemoArchitectureView`, `ARCHITECTURE_GRAPH`), `shared/ui`(PageContainer, PageHeader), `shared/lib/auth`.
- Produces: `/memos/architecture` 라우트.

- [ ] **Step 1: page.tsx 구현 (spec 스켈레톤 그대로)**

```tsx
// apps/dashboard/src/app/(dashboard)/memos/architecture/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { MemoArchitectureView, ARCHITECTURE_GRAPH } from "@/widgets/memo-architecture";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

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

- [ ] **Step 2: 빌드 확인 (server/client seam)**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS — `/memos/architecture` 라우트가 빌드 산출물에 포함, `tls`/`net`/`perf_hooks` module-not-found 없음(위젯이 server-only를 안 끌어옴).

- [ ] **Step 3: 커밋**

```bash
git add "apps/dashboard/src/app/(dashboard)/memos/architecture/page.tsx"
git commit -m "feat(memo-arch): /memos/architecture 라우트 + auth 가드"
```

---

### Task 9: /memos 헤더에서 진입 링크

**Files:**
- Modify: `apps/dashboard/src/app/(dashboard)/memos/page.tsx` (PageHeader `actions`)

**Interfaces:**
- Consumes: Task 8 라우트.
- Produces: `/memos` 페이지 헤더에 `/memos/architecture` 링크.

- [ ] **Step 1: 기존 actions 확인**

Run: `grep -n "actions" apps/dashboard/src/app/(dashboard)/memos/page.tsx`
현재 actions에 `⚙ AI 정리 설정`(→/memos/settings) 링크가 있다. 그 옆에 `🗺 시스템 구조`(→/memos/architecture) 링크를 추가.

- [ ] **Step 2: 링크 추가**

기존 `actions={ <Link .../> }`를 두 링크를 담는 fragment로 변경. 예:

```tsx
actions={
  <div className="flex items-center gap-3">
    <Link href="/memos/architecture" className="text-sm text-[var(--color-text-muted)] hover:underline">
      🗺 시스템 구조
    </Link>
    <Link href="/memos/settings" className="...(기존 클래스 그대로)...">
      ⚙ AI 정리 설정
    </Link>
  </div>
}
```

(기존 설정 링크의 정확한 className·구조는 파일에서 확인해 그대로 유지하고, 앞에 architecture 링크만 추가.)

- [ ] **Step 3: typecheck + lint + build**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add "apps/dashboard/src/app/(dashboard)/memos/page.tsx"
git commit -m "feat(memo-arch): /memos 헤더에 시스템 구조 링크 추가"
```

---

### Task 10: 실제 렌더 + 인증 가드 검증

**Files:** (검증 전용, 코드 변경 없음)

- [ ] **Step 1: dev 서버 기동 + 인증 없이 접근**

Run: dev 서버(`pnpm dev`)에서 로그아웃 상태(세션 쿠키 제거)로 `http://localhost:3020/memos/architecture` 접근.
Expected: `/login`으로 redirect.

- [ ] **Step 2: 인증 상태로 접근**

로그인 상태(dev OAuth 세션 재사용 패턴 — [[dev-oauth-test-auth-session-reuse]])로 `/memos/architecture` 접근.
Expected: 페이지 렌더. 흐름 칩 8개, 흐름 선택 시 레이어 컬럼 그래프, 노드 클릭 시 상세 패널, 유지보수 색인 탭 검색·복사 동작.

- [ ] **Step 3: 전체 검증 게이트**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build && TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test src/widgets/memo-architecture`
Expected: 모두 PASS.

- [ ] **Step 4: 최종 커밋 (검증 완료 마커, 필요 시)**

검증만 했고 코드 변경 없으면 커밋 불필요. 변경 있었으면 커밋.

---

## Self-Review

**1. Spec 커버리지:**
- 라우트 `/memos/architecture` + auth 가드 → Task 8 ✓
- 자체 SVG/CSS 그래프(외부 라이브러리 없음) → Task 5 (레이어 컬럼, 자동 레이아웃 엔진 미사용 — spec 명시) ✓
- 정적 데이터 주도 + barrel props 주입 → Task 2·7·8 ✓
- 8개 크로스레이어 워크플로우(계층적: 개념→클릭 시 파일:심볼) → Task 2 데이터 + Task 5 그래프 + Task 4 상세 ✓
- 유지보수 색인 탭(검색 + 복사 명령) → Task 6 ✓
- 복사 버튼 코드블록, $VAR 플레이스홀더 → Task 3 + Task 2 무결성 테스트(시크릿 스캔) ✓
- ⚠️ 인라인 함정 → Task 2 데이터(node.warning) + Task 4 표시 ✓
- /memos 헤더 진입 링크 → Task 9 ✓
- server/client seam(위젯이 server-only 미참조) → Task 7·8 build 검증 ✓

**2. Placeholder 스캔:** Task 2 데이터는 "spec에서 그대로 옮긴다"고 명시하고 골격+채울 목록을 제시(실제 데이터는 spec 원본이 완전한 출처라 중복 전사 대신 참조). 나머지 Task는 완전한 코드 포함. ✓

**3. 타입 일관성:** `ArchitectureGraph`/`GraphNode`/`Flow`/`MaintenanceEntry`/`Layer`/`Trigger`가 Task 1에서 정의되고 이후 Task에서 동일 이름·시그니처로 사용. `MemoArchitectureView({ graph })`, `CopyableCommand({ command })`, `MaintenanceIndex({ entries })` 등 props 이름이 Task 간 일치. ✓

**주의(구현자용):** Task 2·6의 데이터·색인 내용은 **spec의 해당 섹션이 완전한 출처**다. 이 계획의 축약 골격이 아니라 spec 원본(`docs/superpowers/specs/2026-07-13-memo-architecture-visualization-design.md`)의 8개 흐름·유지보수 색인·함정을 빠짐없이 옮겨라. `--color-*` 토큰은 구현 전 `globals.css`에서 실존 여부 확인 후 사용.
