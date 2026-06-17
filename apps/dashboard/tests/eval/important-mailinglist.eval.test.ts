// Layer 1 — 중요 트랙 mailing-list 컷 회귀. LLM 없음, 매 PR.
// 중요 분류 자체는 LLM 몫이라 Layer 2에서 측정. 여기선 isMailingList exact-match만.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMailingList } from "@/entities/email/lib/unsubscribe-filter";
import { accuracy } from "./scorer";
import { ImportantFixtureArraySchema } from "./types";

const fixtures = ImportantFixtureArraySchema.parse(
  JSON.parse(readFileSync(join(__dirname, "fixtures/important.json"), "utf-8")),
);

describe("Layer 1 — mailing-list 컷", () => {
  it("isMailingList exact-match — 전수 일치", () => {
    const cases = fixtures.map((f) => ({
      id: f.id,
      predicted: isMailingList(f.signals, f.input.snippet),
      expected: f.expect.isMailingList,
    }));
    const acc = accuracy(
      cases.map((c) => ({ predicted: c.predicted, expected: c.expected })),
    );
    console.log(`[eval] mailing-list 컷 accuracy=${acc.toFixed(3)}`);
    for (const c of cases) {
      expect(c.predicted, `${c.id} mailing-list 컷 회귀`).toBe(c.expected);
    }
  });
});
