import { describe, it, expect } from "vitest";
import { lookupCorpCode } from "../src/adapters/dart-corp-lookup";
import { DartError } from "../src/adapters/dart-types";

describe("lookupCorpCode", () => {
  it("returns 8-digit corp_code for known KRX symbol (삼성전자)", () => {
    const corp = lookupCorpCode("005930");
    expect(corp).toMatch(/^\d{8}$/);
  });

  it("returns 8-digit corp_code for 035420 (NAVER)", () => {
    const corp = lookupCorpCode("035420");
    expect(corp).toMatch(/^\d{8}$/);
  });

  it("throws DartError for unknown code", () => {
    expect(() => lookupCorpCode("999999")).toThrow(DartError);
    expect(() => lookupCorpCode("999999")).toThrow(/not_listed_in_dart/);
  });

  it("throws DartError for malformed input", () => {
    expect(() => lookupCorpCode("12345")).toThrow(DartError);
  });
});
