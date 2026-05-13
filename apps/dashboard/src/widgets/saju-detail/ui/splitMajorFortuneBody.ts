export interface MajorFortuneSegment {
  age: number;
  ganZhi: string;
  body: string;
}

const SEGMENT_RE =
  /\*\*(\d+)세\s+(\S\S)(?:[^*]*?)?\*\*([\s\S]*?)(?=\n\*\*\d+세|\n\*\*올해|\n\*\*현재|$)/g;

/**
 * Phase 1 의 major_fortune 섹션 본문(`**N세 XY (YYYY~)**` 패턴)을
 * 10개 segment로 분리. 마지막 "올해 흐름" / "현재 흐름" 종합 단락은 제외.
 */
export function splitMajorFortuneBody(body: string): MajorFortuneSegment[] {
  const matches = [...body.matchAll(SEGMENT_RE)];
  return matches.map((m) => ({
    age: Number(m[1]),
    ganZhi: m[2],
    body: m[3].trim().replace(/^—\s*/, ""),
  }));
}
