import { describe, it, expect } from "vitest";
import { parseDockerStats } from "@/shared/lib/docker/parseDockerStats";

const line = (o: Record<string, string>) => JSON.stringify(o);

describe("parseDockerStats", () => {
  it("정상 라인 — %, GiB/MiB 를 수치로 변환", () => {
    const s = parseDockerStats(
      line({
        Name: "gons-dashboard",
        CPUPerc: "1.23%",
        MemPerc: "1.50%",
        MemUsage: "123.4MiB / 7.5GiB",
      }),
    );
    expect(s).toEqual({
      name: "gons-dashboard",
      cpuPct: 1.23,
      memPct: 1.5,
      memUsedMb: 123.4,
    });
  });

  it("GiB 사용량 → MiB 환산 (ais collector 6GiB 급)", () => {
    const s = parseDockerStats(
      line({
        Name: "collector-worker",
        CPUPerc: "280.51%", // multi-core 는 100 초과 가능
        MemPerc: "9.90%",
        MemUsage: "6.204GiB / 62.71GiB",
      }),
    );
    expect(s?.cpuPct).toBe(280.51);
    expect(s?.memUsedMb).toBeCloseTo(6352.9, 0);
  });

  it("KiB·B 단위 지원", () => {
    expect(
      parseDockerStats(
        line({ Name: "tiny", CPUPerc: "0.00%", MemPerc: "0.00%", MemUsage: "512KiB / 1GiB" }),
      )?.memUsedMb,
    ).toBeCloseTo(0.5, 3);
  });

  it("malformed — JSON 아님·-- 값·필드 누락 → null", () => {
    expect(parseDockerStats("not json")).toBeNull();
    expect(
      parseDockerStats(
        line({ Name: "stopped", CPUPerc: "--", MemPerc: "--", MemUsage: "-- / --" }),
      ),
    ).toBeNull();
    expect(parseDockerStats(line({ Name: "x", CPUPerc: "1%" }))).toBeNull();
  });
});
