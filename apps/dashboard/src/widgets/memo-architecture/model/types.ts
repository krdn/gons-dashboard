// 메모 아키텍처 시각화 — 순수 데이터 타입 (client-safe, 의존 없음).

// FSD 레이어 (eslint.config.mjs boundaries와 동일). cron 라우트는 app,
// DB 스키마는 shared 하위.
export type Layer = "app" | "widgets" | "features" | "entities" | "shared";

// 원자 트리거. Flow.triggers 배열이 조합을 표현.
export type Trigger = "user" | "cron" | "after";

export interface MaintenanceEntry {
  task: string;
  where: string; // "classifyMemo.ts:buildSystemPrompt"
  how: string;
  command?: string; // 복사 가능 명령 ($VAR 플레이스홀더)
  warning?: string;
}

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

export interface ArchitectureGraph {
  nodes: GraphNode[];
  flows: Flow[];
  maintenance: MaintenanceEntry[]; // 유지보수 색인 탭용 (노드에 안 묶인 것 포함)
}
