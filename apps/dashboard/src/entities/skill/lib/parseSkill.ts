import matter from "gray-matter";
import type { SkillMeta, SkillSource } from "../model/types";

/** name 의 파일명 위험 문자(`:` `/` 공백)를 `-` 로 치환. */
export function sanitizeName(name: string): string {
  return name.replace(/[:/\s]+/g, "-");
}

/** frontmatter 이후 본문 문자열. */
export function extractBody(rawContent: string): string {
  return matter(rawContent).content;
}

/**
 * 한글 요약(summary)을 body 맨 위에 blockquote 로 prepend.
 * 요약이 없으면 body 를 그대로 반환(영어 graceful fallback).
 * blockquote + hr 로 원문과 시각 분리되며, ReactMarkdown(remark-gfm)이
 * 기존 prose 스타일로 렌더한다 — SkillDetail UI 변경 불필요.
 */
export function prependSummary(body: string, summary?: string): string {
  const trimmed = summary?.trim();
  if (!trimmed) return body;
  // 각 줄을 blockquote 화. "📌 한눈에" 헤더 + 요약 본문 + 구분선.
  const quoted = trimmed
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return `> **📌 한눈에**\n>\n${quoted}\n\n---\n\n${body}`;
}

/** YAML 값을 표시용 문자열로 정규화 (folded scalar 의 줄바꿈 → 공백). */
function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

export interface RawSkill {
  dirName: string;
  rawContent: string;
  isSymlink: boolean;
  filePath: string;
}

export function toMeta(raw: RawSkill): SkillMeta {
  const { data } = matter(raw.rawContent);
  const name = asString(data.name) ?? raw.dirName;
  const source: SkillSource = raw.isSymlink ? "personal" : "standalone";
  return {
    name,
    description: asString(data.description) ?? "",
    version: asString(data.version),
    model: asString(data.model),
    source,
    filePath: raw.filePath,
    bodyPath: `/skill-catalog/${sanitizeName(name)}.json`,
  };
}
