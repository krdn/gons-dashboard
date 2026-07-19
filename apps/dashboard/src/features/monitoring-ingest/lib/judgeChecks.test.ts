import { describe, it, expect } from "vitest";
import { judgeChecks } from "./judgeChecks";

const NOW = new Date("2026-07-19T12:00:00+09:00");
const nowEpoch = Math.floor(NOW.getTime() / 1000);

describe("judgeChecks — service", () => {
  it("active→ok / failed→critical / inactive→warning", () => {
    const verdicts = judgeChecks(
      {
        host: "h",
        services: [
          { unit: "nginx", active: "active" },
          { unit: "ollama", active: "failed" },
          { unit: "smbd", active: "inactive" },
        ],
      },
      NOW,
    );
    expect(verdicts.map((v) => [v.target, v.status])).toEqual([
      ["nginx", "ok"],
      ["ollama", "critical"],
      ["smbd", "warning"],
    ]);
    expect(verdicts[1].dedupKeySuffix).toBe("svc:ollama");
  });
});

describe("judgeChecks — timer", () => {
  it("result 실패 → warning", () => {
    const [v] = judgeChecks(
      {
        host: "h",
        timers: [
          { unit: "n8n-backup.timer", result: "exit-code", lastTriggerEpoch: nowEpoch - 3600 },
        ],
      },
      NOW,
    );
    expect(v.status).toBe("warning");
    expect(v.title).toContain("실패");
  });

  it("nextElapse 30분+ 과거 → warning(지연), 미래면 ok", () => {
    const [late, fine] = judgeChecks(
      {
        host: "h",
        timers: [
          { unit: "late.timer", result: "success", nextElapseEpoch: nowEpoch - 3600 },
          { unit: "fine.timer", result: "success", nextElapseEpoch: nowEpoch + 3600 },
        ],
      },
      NOW,
    );
    expect(late.status).toBe("warning");
    expect(fine.status).toBe("ok");
  });

  it("관찰치 전무 → unknown", () => {
    const [v] = judgeChecks({ host: "h", timers: [{ unit: "ghost.timer" }] }, NOW);
    expect(v.status).toBe("unknown");
  });
});

describe("judgeChecks — hostcron", () => {
  const spec = { name: "self-healing", readable: true, maxAgeMin: 60 };

  it("age ≤ maxAge → ok", () => {
    const [v] = judgeChecks(
      { host: "h", hostCron: [{ ...spec, mtimeEpoch: nowEpoch - 30 * 60 }] },
      NOW,
    );
    expect(v.status).toBe("ok");
  });

  it("maxAge 초과 → warning, 2배 초과 → critical", () => {
    const [warn] = judgeChecks(
      { host: "h", hostCron: [{ ...spec, mtimeEpoch: nowEpoch - 90 * 60 }] },
      NOW,
    );
    expect(warn.status).toBe("warning");
    const [crit] = judgeChecks(
      { host: "h", hostCron: [{ ...spec, mtimeEpoch: nowEpoch - 121 * 60 }] },
      NOW,
    );
    expect(crit.status).toBe("critical");
    expect(crit.title).toContain("실행 흔적 없음");
  });

  it("readable=false → unknown (이벤트 무발행 status)", () => {
    const [v] = judgeChecks(
      { host: "h", hostCron: [{ name: "x", readable: false, maxAgeMin: 60 }] },
      NOW,
    );
    expect(v.status).toBe("unknown");
  });
});
