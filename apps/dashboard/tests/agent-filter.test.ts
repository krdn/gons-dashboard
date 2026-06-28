// filterAgents 순수 테스트 — query/source/model 직교 필터.
import { describe, it, expect } from "vitest";
import { filterAgents } from "@/widgets/agent-catalog/lib/filterAgents";
import type { AgentMeta } from "@/entities/agent/client";

function mk(over: Partial<AgentMeta>): AgentMeta {
  return {
    name: "x",
    description: "",
    model: "sonnet",
    tools: [],
    source: "personal",
    filePath: "~/x.md",
    bodyPath: "/agent-catalog/x.json",
    ...over,
  };
}

const agents: AgentMeta[] = [
  mk({ name: "architect", description: "system design", model: "opus", source: "personal" }),
  mk({ name: "code-reviewer", description: "review", model: "sonnet", source: "framework", tools: ["Bash"] }),
  mk({ name: "coder", description: "impl", model: "inherit", source: "personal" }),
];

describe("filterAgents", () => {
  it("필터 없으면 전체 반환", () => {
    expect(filterAgents(agents, "")).toHaveLength(3);
  });
  it("source 필터", () => {
    const r = filterAgents(agents, "", "framework");
    expect(r.map((a) => a.name)).toEqual(["code-reviewer"]);
  });
  it("model 필터", () => {
    expect(filterAgents(agents, "", "all", "opus").map((a) => a.name)).toEqual(["architect"]);
    expect(filterAgents(agents, "", "all", "inherit").map((a) => a.name)).toEqual(["coder"]);
  });
  it("이름 검색", () => {
    expect(filterAgents(agents, "arch").map((a) => a.name)).toEqual(["architect"]);
  });
  it("설명 검색", () => {
    expect(filterAgents(agents, "design").map((a) => a.name)).toEqual(["architect"]);
  });
  it("도구 검색", () => {
    expect(filterAgents(agents, "bash").map((a) => a.name)).toEqual(["code-reviewer"]);
  });
  it("source + model 동시 필터(교집합)", () => {
    expect(filterAgents(agents, "", "personal", "opus").map((a) => a.name)).toEqual(["architect"]);
    expect(filterAgents(agents, "", "personal", "sonnet")).toHaveLength(0);
  });
});
