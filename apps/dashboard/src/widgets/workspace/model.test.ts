import { describe, expect, it } from "vitest";
import { projectStatus, safeProjectUrl } from "./model";
import type { HostSummary } from "@/features/host-catalog";
const group = {
  totalCount: 0,
  runningCount: 0,
  warningCount: 0,
  isStale: false,
} as HostSummary["groups"][number];
describe("project status boundaries", () => {
  it("never treats unobserved containers as healthy", () => {
    expect(projectStatus(group)).toBe("unknown");
    expect(
      projectStatus({
        ...group,
        totalCount: 2,
        runningCount: 2,
        isStale: true,
      }),
    ).toBe("unknown");
  });
  it("requires all observed containers to be running", () => {
    expect(projectStatus({ ...group, totalCount: 2, runningCount: 1 })).toBe(
      "attention",
    );
    expect(projectStatus({ ...group, totalCount: 2, runningCount: 2 })).toBe(
      "running",
    );
    expect(
      projectStatus({
        ...group,
        totalCount: 2,
        runningCount: 2,
        warningCount: 1,
      }),
    ).toBe("attention");
  });
  it("allows only credential-free web service links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:password@example.com",
      "/relative",
      null,
    ])
      expect(safeProjectUrl(url)).toBeNull();
    expect(safeProjectUrl("https://example.com/app")).toBe(
      "https://example.com/app",
    );
  });
});
