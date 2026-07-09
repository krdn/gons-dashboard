import { describe, it, expect } from "vitest";
import {
  HARD_CONTRACT,
  FIDELITY_GUARD,
  PRESET_INSTRUCTIONS,
  buildTransformSystemPrompt,
} from "./prompts";

describe("buildTransformSystemPrompt", () => {
  it("가드 on: 하드 계약 + 충실 가드 + 지시 순서로 조립", () => {
    const p = buildTransformSystemPrompt("스타일: 테스트.", true);
    expect(p).toBe(`${HARD_CONTRACT}\n\n${FIDELITY_GUARD}\n\n스타일: 테스트.`);
  });
  it("가드 off: 충실 가드 미포함", () => {
    const p = buildTransformSystemPrompt("스타일: 테스트.", false);
    expect(p).toBe(`${HARD_CONTRACT}\n\n스타일: 테스트.`);
    expect(p).not.toContain("절대 규칙");
  });
  it("하드 계약은 JSON 출력 계약을 포함하고 페르소나 중립", () => {
    expect(HARD_CONTRACT).toContain('{"content"');
    expect(HARD_CONTRACT).not.toContain("도구입니다");
  });
  it("빌트인 7종 지시가 전부 존재", () => {
    expect(Object.keys(PRESET_INSTRUCTIONS)).toHaveLength(7);
  });
});
