import { expect, it } from "vitest";
import { buildDocument, isDocumentTemplate } from "./templates";
it("unknown or inherited template names are rejected", () => {
  expect(isDocumentTemplate("manual")).toBe(true);
  expect(isDocumentTemplate("toString")).toBe(false);
  expect(isDocumentTemplate("anything")).toBe(false);
});
it("handoff explicitly marks missing facts instead of inventing progress", () => {
  const doc = buildDocument("handoff", "gateway", " 다음 세션 ", [
    "릴리스 검증",
    "커밋 완료",
  ]);
  expect(doc).toContain("# 다음 세션");
  expect(doc).toContain("프로젝트: gateway");
  expect(doc).toContain("## 현재 상태 · 완료한 작업\n\n커밋 완료");
  expect(doc).toContain("## 검증 결과와 미확인 사항\n\n미작성 · 확인 필요");
});
