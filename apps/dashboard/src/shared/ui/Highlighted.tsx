// 검색어 하이라이트 — terms와 일치하는 조각을 <mark>로 감싼다. terms가 비면 평문 통과.
import { Fragment } from "react";

export interface TextChunk {
  text: string;
  hit: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * text를 terms 일치 구간(hit=true)과 나머지로 분절한다. 대소문자 무시.
 * 긴 term을 먼저 시도해 "메모"·"메모검색" 겹침 시 긴 쪽이 통으로 매칭된다.
 */
export function splitByTerms(text: string, terms: string[]): TextChunk[] {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (text.length === 0 || cleaned.length === 0) return [{ text, hit: false }];

  const pattern = new RegExp(cleaned.map(escapeRegExp).join("|"), "gi");
  const chunks: TextChunk[] = [];
  let cursor = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index;
    if (start > cursor) chunks.push({ text: text.slice(cursor, start), hit: false });
    chunks.push({ text: m[0], hit: true });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) chunks.push({ text: text.slice(cursor), hit: false });
  return chunks;
}

interface HighlightedProps {
  text: string;
  terms: string[];
}

export function Highlighted({ text, terms }: HighlightedProps) {
  const chunks = splitByTerms(text, terms);
  return (
    <>
      {chunks.map((c, i) =>
        c.hit ? (
          <mark key={i} className="rounded-[2px] bg-amber-200/70 text-inherit">
            {c.text}
          </mark>
        ) : (
          <Fragment key={i}>{c.text}</Fragment>
        ),
      )}
    </>
  );
}
