// Layer 1 — deterministic 답장 분류 회귀 게이트. LLM 없음, 매 PR.
// spec 2026-06-17 §3 §5. recall = reply 트랙 recall의 상한.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyDeterministic } from "@/entities/email/lib/deterministic-classifier";
import type { ThreadInput } from "@/entities/email/model/types";
import { binaryMetrics } from "./scorer";
import { ReplyFixtureArraySchema, ThresholdsSchema } from "./types";

const fixtures = ReplyFixtureArraySchema.parse(
  JSON.parse(readFileSync(join(__dirname, "fixtures/reply-needed.json"), "utf-8")),
);
const thresholds = ThresholdsSchema.parse(
  JSON.parse(readFileSync(join(__dirname, "thresholds.json"), "utf-8")),
);

// fixture input → ThreadInput (receivedAt·threadId는 deterministic 로직에 무관, 채움).
function toThreadInput(f: (typeof fixtures)[number]): ThreadInput {
  return {
    threadId: f.id,
    lastSenderEmail: f.input.lastSenderEmail,
    lastSenderName: f.input.lastSenderName,
    subject: f.input.subject,
    snippet: f.input.snippet,
    receivedAt: new Date("2026-06-17T00:00:00Z"),
    ownerEmail: f.input.ownerEmail,
    lastSenderIsOwner: f.input.lastSenderIsOwner,
  };
}

describe("Layer 1 — deterministic 답장 recall", () => {
  const cases = fixtures.map((f) => {
    const result = classifyDeterministic(toThreadInput(f));
    return { predicted: result !== null, expected: f.expect.needsReply };
  });
  const m = binaryMetrics(cases);

  it("recall 측정값 로그 + 임계치 게이트", () => {
    console.log(
      `[eval] deterministic recall=${m.recall.toFixed(3)} (tp=${m.tp} fn=${m.fn}) ` +
        `threshold=${thresholds.replyDeterministic.recall ?? "TBD"}`,
    );
    if (thresholds.replyDeterministic.recall !== null) {
      expect(m.recall).toBeGreaterThanOrEqual(thresholds.replyDeterministic.recall);
    } else {
      expect(m.recall).toBeGreaterThanOrEqual(0); // placeholder — 항상 통과
    }
  });

  it("severity exact-match — deterministic이 잡은 needsReply 케이스", () => {
    for (const f of fixtures.filter((x) => x.expect.needsReply && x.expect.severity)) {
      const result = classifyDeterministic(toThreadInput(f));
      if (result === null) continue; // B 케이스: 못 잡는 게 정상, severity 비교 제외
      expect(result.severity, `${f.id} severity 회귀`).toBe(f.expect.severity);
    }
  });
});
