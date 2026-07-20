import { describe, it, expect } from "vitest";
import { normalizeRunOutcome } from "./normalizeRunOutcome";

describe("normalizeRunOutcome", () => {
  it("conclusion success 는 success", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "success" })).toBe("success");
  });

  it.each(["failure", "timed_out", "startup_failure", "action_required"])(
    "%s 는 failure",
    (conclusion) => {
      expect(normalizeRunOutcome({ status: "completed", conclusion })).toBe("failure");
    },
  );

  it.each(["queued", "in_progress", "requested", "waiting", "pending"])(
    "%s 상태는 running",
    (status) => {
      expect(normalizeRunOutcome({ status, conclusion: null })).toBe("running");
    },
  );

  it.each(["cancelled", "skipped", "neutral", "stale"])(
    "%s 는 inconclusive — 성공도 실패도 아니다",
    (conclusion) => {
      expect(normalizeRunOutcome({ status: "completed", conclusion })).toBe("inconclusive");
    },
  );

  // 회귀 가드 3: cancelled 를 failure 로 보면 사람이 의도적으로 중단한
  // 빌드마다 critical 알림이 나간다.
  it("cancelled 는 failure 가 아니다", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "cancelled" })).not.toBe(
      "failure",
    );
  });

  it("미지의 conclusion 은 inconclusive 로 떨어진다", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: "some_new_value" })).toBe(
      "inconclusive",
    );
  });

  it("completed 인데 conclusion 이 null 이면 inconclusive", () => {
    expect(normalizeRunOutcome({ status: "completed", conclusion: null })).toBe("inconclusive");
  });
});
