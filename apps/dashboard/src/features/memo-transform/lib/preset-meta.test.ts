import { describe, it, expect } from "vitest";
import { TRANSFORM_PRESETS, isTransformPresetId } from "./preset-meta";
import { TRANSFORM_PRESET_IDS } from "@/entities/memo/client";

describe("TRANSFORM_PRESETS", () => {
  it("7종 전부 정의되고 id가 키와 일치한다", () => {
    expect(Object.keys(TRANSFORM_PRESETS).sort()).toEqual([...TRANSFORM_PRESET_IDS].sort());
    for (const id of TRANSFORM_PRESET_IDS) expect(TRANSFORM_PRESETS[id].id).toBe(id);
  });
  it("tidy만 strictPreserve", () => {
    for (const id of TRANSFORM_PRESET_IDS) {
      expect(TRANSFORM_PRESETS[id].strictPreserve).toBe(id === "tidy");
    }
  });
  it("minInputLen 스펙 확정값", () => {
    expect(TRANSFORM_PRESETS.tidy.minInputLen).toBe(1);
    expect(TRANSFORM_PRESETS.polish.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.summary.minInputLen).toBe(80);
    expect(TRANSFORM_PRESETS.structured.minInputLen).toBe(80);
    expect(TRANSFORM_PRESETS.todos.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.journal.minInputLen).toBe(20);
    expect(TRANSFORM_PRESETS.email.minInputLen).toBe(20);
  });
});

describe("isTransformPresetId", () => {
  it("유효/무효 판별", () => {
    expect(isTransformPresetId("summary")).toBe(true);
    expect(isTransformPresetId("nope")).toBe(false);
  });
});
