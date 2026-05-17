import { describe, expect, it } from "vitest";
import { findCity, searchCities } from "./cityLookup";

describe("cityLookup", () => {
  it("부천 검색 시 한 건 반환, 경도 126.78", () => {
    const result = findCity("부천");
    expect(result?.longitudeDeg).toBeCloseTo(126.78, 1);
    expect(result?.timezone).toBe("Asia/Seoul");
  });

  it("'서' prefix 검색 → 서울특별시 포함", () => {
    const results = searchCities("서");
    expect(results.some(c => c.nameKo === "서울특별시")).toBe(true);
  });

  it("Tokyo 영문 검색 가능", () => {
    const result = findCity("Tokyo");
    expect(result?.timezone).toBe("Asia/Tokyo");
  });

  it("없는 도시 → undefined", () => {
    expect(findCity("애틀란티스")).toBeUndefined();
  });
});
