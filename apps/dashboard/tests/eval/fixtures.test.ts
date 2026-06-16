import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ReplyFixtureArraySchema,
  ImportantFixtureArraySchema,
} from "./types";

const DIR = join(__dirname, "fixtures");
const load = (f: string) =>
  JSON.parse(readFileSync(join(DIR, f), "utf-8"));

describe("eval fixtures", () => {
  it("reply-needed.json — Zod 스키마 통과 + id 고유", () => {
    const parsed = ReplyFixtureArraySchema.parse(load("reply-needed.json"));
    expect(parsed.length).toBeGreaterThanOrEqual(9);
    const ids = parsed.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reply-needed.json — needsReply=true 케이스는 severity 보유", () => {
    const parsed = ReplyFixtureArraySchema.parse(load("reply-needed.json"));
    for (const f of parsed.filter((x) => x.expect.needsReply)) {
      expect(f.expect.severity, `${f.id} severity 누락`).toBeDefined();
    }
  });

  it("important.json — Zod 스키마 통과 + 컷 아닌 행은 category 보유", () => {
    const parsed = ImportantFixtureArraySchema.parse(load("important.json"));
    expect(parsed.length).toBeGreaterThanOrEqual(9);
    for (const f of parsed.filter((x) => !x.expect.isMailingList)) {
      expect(f.expect.category, `${f.id} category 누락`).toBeDefined();
    }
  });
});
