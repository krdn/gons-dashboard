import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./narrative-server";

describe("extractJsonObject — happy path", () => {
  it("순수 JSON", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("앞뒤 공백 + 줄바꿈", () => {
    expect(extractJsonObject('\n  {"a":1}  \n')).toBe('{"a":1}');
  });
});

describe("extractJsonObject — 마크다운 펜스", () => {
  it("```json fenced", () => {
    const input = '```json\n{"a":1}\n```';
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });

  it("``` (언어 미지정) fenced", () => {
    const input = '```\n{"a":1}\n```';
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });
});

describe("extractJsonObject — 운영 회귀 케이스", () => {
  it("한국어 prose 접두사 + JSON", () => {
    const input = '명조 분석 요약 (전체): \n{"narrativeText":"...","sections":{}}';
    expect(extractJsonObject(input)).toBe(
      '{"narrativeText":"...","sections":{}}',
    );
  });

  it("'명조 분석 JSON' 접두사", () => {
    const input = '명조 분석 JSON\n{"a":1}';
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });

  it("'## 명조 분석 요' 마크다운 헤더 접두사", () => {
    const input = '## 명조 분석 요약\n{"a":1}';
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });
});

describe("extractJsonObject — 중첩 객체", () => {
  it("중첩 객체 정확 균형", () => {
    const input = '{"a":1,"b":{"c":2,"d":{"e":3}}}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it("JSON 뒤 trailing prose 무시", () => {
    const input = '{"a":1}\n끝.';
    expect(extractJsonObject(input)).toBe('{"a":1}');
  });
});

describe("extractJsonObject — 문자열 리터럴 안의 중괄호", () => {
  it("문자열 안의 } 가 객체 종료로 오인되지 않음", () => {
    const input = '{"text":"a } b","n":1}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it("문자열 안의 escape 따옴표 처리", () => {
    const input = '{"q":"He said \\"hi\\"","n":1}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it("문자열 안의 { 도 무시", () => {
    const input = '{"t":"{not json}","n":1}';
    expect(extractJsonObject(input)).toBe(input);
  });
});

describe("extractJsonObject — 실패 케이스", () => {
  it("'{' 없음 → throw", () => {
    expect(() => extractJsonObject("plain prose only")).toThrow(
      /no JSON object found/,
    );
  });

  it("빈 문자열 → throw", () => {
    expect(() => extractJsonObject("")).toThrow(/no JSON object found/);
  });

  it("균형 안 맞는 객체 → throw", () => {
    expect(() => extractJsonObject('{"a":1')).toThrow(/unbalanced JSON/);
  });
});
