// @vitest-environment jsdom
// AgentCatalog 필터칩 인터랙션 — source/model 칩·검색으로 행 수가 결정적으로 변하는지.
// 브라우저 인터랙션의 flakiness 없이 회귀를 잡는다 (skill/plugin 카탈로그 교훈).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentCatalog } from "@/widgets/agent-catalog/ui/AgentCatalog";
import type { AgentMeta } from "@/entities/agent/client";

afterEach(cleanup);

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
  mk({ name: "architect", model: "opus", source: "personal" }),
  mk({ name: "code-reviewer", model: "sonnet", source: "framework" }),
  mk({ name: "coder", model: "inherit", source: "personal" }),
];

describe("AgentCatalog 필터", () => {
  it("초기엔 전체 에이전트가 보인다", () => {
    render(<AgentCatalog agents={agents} />);
    expect(screen.getByText("architect")).toBeTruthy();
    expect(screen.getByText("code-reviewer")).toBeTruthy();
    expect(screen.getByText("coder")).toBeTruthy();
  });

  it("프레임워크 출처 필터 시 개인 에이전트가 숨는다", () => {
    render(<AgentCatalog agents={agents} />);
    // role=group "출처 필터" 안의 "프레임워크" 버튼
    const sourceGroup = screen.getByRole("group", { name: "출처 필터" });
    fireEvent.click(within(sourceGroup, "프레임워크"));
    expect(screen.getByText("code-reviewer")).toBeTruthy();
    expect(screen.queryByText("architect")).toBeNull();
    expect(screen.queryByText("coder")).toBeNull();
  });

  it("모델 필터(Opus) 시 해당 모델만 남는다", () => {
    render(<AgentCatalog agents={agents} />);
    const modelGroup = screen.getByRole("group", { name: "모델 필터" });
    fireEvent.click(within(modelGroup, "Opus"));
    expect(screen.getByText("architect")).toBeTruthy();
    expect(screen.queryByText("code-reviewer")).toBeNull();
  });

  it("검색어로 좁힐 수 있다", () => {
    render(<AgentCatalog agents={agents} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "에이전트 검색" }), {
      target: { value: "reviewer" },
    });
    expect(screen.getByText("code-reviewer")).toBeTruthy();
    expect(screen.queryByText("architect")).toBeNull();
  });
});

// group scope 안에서 텍스트로 버튼을 찾는 헬퍼 (source/model 칩이 같은 라벨일 수 있어 scope 필요).
function within(container: HTMLElement, text: string): HTMLElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`button "${text}" not found in group`);
  return btn as HTMLElement;
}
