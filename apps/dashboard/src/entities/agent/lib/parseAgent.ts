import matter from "gray-matter";
import { type AgentMeta, type AgentSource, type AgentModel } from "../model/types";

/** name 의 파일명 위험 문자(`:` `/` 공백)를 `-` 로 치환. */
export function sanitizeName(name: string): string {
  return name.replace(/[:/\s]+/g, "-");
}

/** frontmatter 이후 본문 문자열. */
export function extractBody(rawContent: string): string {
  return matter(rawContent).content;
}

/** YAML 값을 표시용 문자열로 정규화 (folded scalar 의 줄바꿈 → 공백). */
function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

/**
 * model frontmatter → AgentModel.
 * bare tier("opus") · full id("claude-opus-4-8") · null/"inherit"/미인식 모두 처리.
 */
export function normalizeModel(v: unknown): AgentModel {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s.includes("opus")) return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku")) return "haiku";
  return "inherit"; // undefined / "inherit" / 미인식
}

/**
 * tools frontmatter → string[].
 * gray-matter 가 `["a","b"]` 는 배열로, `a, b` 는 문자열로, 없으면 undefined 로 준다.
 */
export function normalizeTools(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

export interface RawAgent {
  fileBase: string; // 파일명에서 .md 제거된 base (name 폴백용)
  rawContent: string;
  isSymlink: boolean;
  filePath: string;
}

export function toMeta(raw: RawAgent): AgentMeta {
  const { data } = matter(raw.rawContent);
  const name = asString(data.name) ?? raw.fileBase;
  // ⚠️ skill 과 의미 반전: 일반 파일=개인, symlink=프레임워크.
  const source: AgentSource = raw.isSymlink ? "framework" : "personal";
  return {
    name,
    description: asString(data.description) ?? "",
    model: normalizeModel(data.model),
    tools: normalizeTools(data.tools),
    source,
    filePath: raw.filePath,
    bodyPath: `/agent-catalog/${sanitizeName(name)}.json`,
  };
}
