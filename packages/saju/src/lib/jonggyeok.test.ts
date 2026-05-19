import { describe, expect, it } from "vitest";
import { buildJonggyeokYongshin } from "./jonggyeok";
import type { ShenStrengthResult, Role } from "./shen-strength";
import type { Element } from "../hanja";

function shenOf(
  dayEl: Element,
  verdict: ShenStrengthResult["verdict"],
  jonggyeokKind: ShenStrengthResult["jonggyeokKind"],
  jonggyeokRole: Role | null,
  roleCount: Partial<Record<Role, number>> = {},
): ShenStrengthResult {
  const base = { 비겁: 0, 인성: 0, 식상: 0, 재성: 0, 관성: 0, ...roleCount };
  return {
    dayElement: dayEl,
    supportScore: 0,
    drainScore: 0,
    roleCount: base,
    roleCountExtended: base,
    verdict, jonggyeokKind, jonggyeokRole,
  };
}

describe("buildJonggyeokYongshin", () => {
  it("종아 → primary=식상 오행, gisin=[일간, 인성]", () => {
    const shen = shenOf("water", "종아", "가종", "식상", { 식상: 4 });
    const result = buildJonggyeokYongshin(shen);
    expect(result).not.toBeNull();
    expect(result!.primary).toBe("wood");
    expect(result!.gisin).toEqual(expect.arrayContaining(["water", "metal"]));
    expect(result!.rationale).toContain("종아");
  });

  it("종재 → primary=재성 오행", () => {
    const shen = shenOf("wood", "종재", "완전종", "재성", { 재성: 7 });
    const result = buildJonggyeokYongshin(shen);
    expect(result!.primary).toBe("earth");
    expect(result!.gisin).toEqual(expect.arrayContaining(["wood", "water"]));
  });

  it("종살 → primary=관성 오행", () => {
    const shen = shenOf("wood", "종살", "완전종", "관성", { 관성: 7 });
    const result = buildJonggyeokYongshin(shen);
    expect(result!.primary).toBe("metal");
    expect(result!.gisin).toEqual(expect.arrayContaining(["wood", "water"]));
  });

  it("일반 신약 (jonggyeokKind=null) → null 반환", () => {
    const shen = shenOf("wood", "신약", null, null);
    expect(buildJonggyeokYongshin(shen)).toBeNull();
  });

  it("일반 신강 (jonggyeokKind=null) → null 반환", () => {
    const shen = shenOf("wood", "신강", null, null);
    expect(buildJonggyeokYongshin(shen)).toBeNull();
  });
});
