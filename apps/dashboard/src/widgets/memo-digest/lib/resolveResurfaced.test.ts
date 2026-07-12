import { describe, expect, it } from "vitest";
import { resolveResurfaced } from "./resolveResurfaced";

const row = (id: string, title: string) => ({ id, title, createdAt: new Date("2026-04-01") });

describe("resolveResurfaced", () => {
  it("삭제된 id(조회 안 됨)는 조용히 생략한다", () => {
    const out = resolveResurfaced(["a", "deleted", "b"], [row("a", "A"), row("b", "B")]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    for (const m of out) expect(typeof m.title).toBe("string");
  });

  it("rows 순서가 아니라 id 스냅샷 순서를 보존한다", () => {
    const out = resolveResurfaced(["b", "a"], [row("a", "A"), row("b", "B")]);
    expect(out.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("빈 입력 — 빈 결과", () => {
    expect(resolveResurfaced([], [row("a", "A")])).toEqual([]);
    expect(resolveResurfaced(["a"], [])).toEqual([]);
  });
});
