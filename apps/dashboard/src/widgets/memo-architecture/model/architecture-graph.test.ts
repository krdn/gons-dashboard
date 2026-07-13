import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ARCHITECTURE_GRAPH } from "./architecture-graph";

// vitest cwd = apps/dashboard. 노드 path는 repo-relative(apps/dashboard/... 접두)라
// repo 루트를 기준으로 해석한다.
const REPO_ROOT = resolve(__dirname, "../../../../../..");

describe("ARCHITECTURE_GRAPH 무결성", () => {
  const { nodes, flows, maintenance } = ARCHITECTURE_GRAPH;
  const nodeIds = new Set(nodes.map((n) => n.id));

  it("노드 id는 유일하다", () => {
    expect(nodeIds.size).toBe(nodes.length);
  });

  it("모든 flow.nodeIds는 실존 노드를 가리킨다", () => {
    for (const f of flows) {
      for (const id of f.nodeIds) expect(nodeIds.has(id), `${f.id}: ${id}`).toBe(true);
    }
  });

  it("모든 edge의 from/to는 실존 노드다", () => {
    for (const f of flows) {
      for (const e of f.edges) {
        expect(nodeIds.has(e.from), `${f.id}: ${e.from}`).toBe(true);
        expect(nodeIds.has(e.to), `${f.id}: ${e.to}`).toBe(true);
      }
    }
  });

  it("모든 dependsOn은 실존 노드를 가리킨다", () => {
    for (const n of nodes) {
      for (const dep of n.dependsOn ?? []) {
        expect(nodeIds.has(dep), `${n.id} → ${dep}`).toBe(true);
      }
    }
  });

  it("8개 워크플로우를 담는다", () => {
    expect(flows.length).toBe(8);
  });

  it("각 흐름의 edge는 그 흐름의 nodeIds 안에서만 연결된다", () => {
    for (const f of flows) {
      const inFlow = new Set(f.nodeIds);
      for (const e of f.edges) {
        expect(inFlow.has(e.from), `${f.id}: edge from ${e.from} not in nodeIds`).toBe(true);
        expect(inFlow.has(e.to), `${f.id}: edge to ${e.to} not in nodeIds`).toBe(true);
      }
    }
  });

  it("유지보수 색인은 비어있지 않다", () => {
    expect(maintenance.length).toBeGreaterThan(0);
  });

  it("모든 노드 path는 실존 파일을 가리킨다", () => {
    for (const n of nodes) {
      // apps/cron/* 은 dashboard 밖이지만 repo 루트 기준이라 함께 해석된다.
      const abs = resolve(REPO_ROOT, n.path);
      expect(existsSync(abs), `${n.id}: ${n.path}`).toBe(true);
    }
  });

  it("어떤 문자열에도 평문 시크릿·운영 호스트가 없다 ($VAR만)", () => {
    const all = JSON.stringify(ARCHITECTURE_GRAPH);
    expect(all).not.toMatch(/192\.168\.\d+\.\d+/);
    expect(all).not.toMatch(/Bearer\s+[A-Za-z0-9]{12,}/);
    expect(all).not.toMatch(/CHANGE_ME|password\s*=\s*\S/i);
  });
});
