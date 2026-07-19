import { describe, expect, test } from "vitest";
import { sourceForKind } from "./sourceForKind";

describe("sourceForKind", () => {
  test("보안 kind 는 security 로 분류된다 (Phase 2 는 전부 cron 이었음)", () => {
    // Phase 2 의 "service 아니면 cron" 규칙이 남아 있으면 보안 이벤트가
    // cron 으로 오분류되어 타임라인 필터·알림 라우팅이 어긋난다.
    for (const kind of ["iptables", "fail2ban", "ufw", "portdrift", "sshfail"] as const) {
      expect(sourceForKind(kind)).toBe("security");
    }
  });

  test("데이터스토어 kind 는 host 로 분류된다", () => {
    expect(sourceForKind("pg")).toBe("host");
    expect(sourceForKind("redis")).toBe("host");
  });

  test("Phase 2 매핑은 그대로 유지된다", () => {
    expect(sourceForKind("service")).toBe("service");
    expect(sourceForKind("timer")).toBe("cron");
    expect(sourceForKind("hostcron")).toBe("cron");
  });
});
