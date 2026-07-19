import { describe, it, expect } from "vitest";
import { evaluateVitals } from "./evaluateVitals";
import { type VitalsPayload } from "../model/vitalsSchema";

function makeVitals(overrides: Partial<VitalsPayload> = {}): VitalsPayload {
  return {
    host: "home-server",
    cpuPct: 10,
    load1: 0.5,
    load5: 0.4,
    load15: 0.3,
    memUsedPct: 40,
    swapUsedMb: 100,
    disks: [{ mount: "/", usedPct: 50, inodePct: 10 }],
    cpuTempC: 55,
    gpu: { utilPct: 20, vramPct: 30, tempC: 50 },
    uptimeSec: 3600,
    rebootRequired: false,
    ...overrides,
  };
}

function verdictOf(payload: VitalsPayload, suffix: string) {
  const found = evaluateVitals(payload).find((v) => v.dedupKeySuffix === suffix);
  if (!found) throw new Error(`verdict ${suffix} 없음`);
  return found;
}

describe("evaluateVitals", () => {
  it("정상 범위면 모든 verdict 가 violated=false", () => {
    const verdicts = evaluateVitals(makeVitals());
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => !v.violated)).toBe(true);
  });

  it("cpu 92% → warning 위반", () => {
    const v = verdictOf(makeVitals({ cpuPct: 92 }), "cpu");
    expect(v.violated).toBe(true);
    if (v.violated) {
      expect(v.severity).toBe("warning");
      expect(v.title).toContain("CPU");
    }
  });

  it("cpu 98% → critical 위반", () => {
    const v = verdictOf(makeVitals({ cpuPct: 98 }), "cpu");
    expect(v.violated && v.severity).toBe("critical");
  });

  it("디스크는 mount 별로 분리 판정", () => {
    const payload = makeVitals({
      disks: [
        { mount: "/", usedPct: 50 },
        { mount: "/data", usedPct: 88 },
      ],
    });
    expect(verdictOf(payload, "disk:/").violated).toBe(false);
    const data = verdictOf(payload, "disk:/data");
    expect(data.violated && data.severity).toBe("warning");
  });

  it("디스크 96% → critical", () => {
    const v = verdictOf(makeVitals({ disks: [{ mount: "/", usedPct: 96 }] }), "disk:/");
    expect(v.violated && v.severity).toBe("critical");
  });

  it("rebootRequired → warning 위반", () => {
    const v = verdictOf(makeVitals({ rebootRequired: true }), "reboot");
    expect(v.violated && v.severity).toBe("warning");
  });

  it("gpu 미제공이면 gpu verdict 없음", () => {
    const suffixes = evaluateVitals(makeVitals({ gpu: undefined })).map(
      (v) => v.dedupKeySuffix,
    );
    expect(suffixes).not.toContain("gpu.vram");
    expect(suffixes).not.toContain("gpu.temp");
  });

  it("cpuTempC 미제공이면 temp verdict 없음, 91°C 면 critical", () => {
    const without = evaluateVitals(makeVitals({ cpuTempC: undefined })).map(
      (v) => v.dedupKeySuffix,
    );
    expect(without).not.toContain("temp");
    const v = verdictOf(makeVitals({ cpuTempC: 91 }), "temp");
    expect(v.violated && v.severity).toBe("critical");
  });
});
