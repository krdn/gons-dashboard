import { describe, expect, it } from "vitest";
import { formatChange } from "./HoldingDetailButton.utils";

describe("formatChange", () => {
  it("정상 케이스: 양수 손익률", () => {
    const res = formatChange(110, 100);
    expect(res.label).toBe("+10.0%");
    expect(res.color).toContain("emerald");
  });

  it("정상 케이스: 음수 손익률", () => {
    const res = formatChange(90, 100);
    expect(res.label).toBe("-10.0%");
    expect(res.color).toContain("rose");
  });

  it("avgCost=null (watchlist): '—' 라벨", () => {
    const res = formatChange(110, null);
    expect(res.label).toBe("—");
    expect(res.pct).toBeNull();
  });

  it("avgCost=0: '—' 라벨 (divide-by-zero 회피)", () => {
    const res = formatChange(110, 0);
    expect(res.label).toBe("—");
    expect(res.pct).toBeNull();
  });

  it("avgCost=NaN/Infinity: '—' 라벨", () => {
    expect(formatChange(110, Number.NaN).label).toBe("—");
    expect(formatChange(110, Number.POSITIVE_INFINITY).label).toBe("—");
  });
});
