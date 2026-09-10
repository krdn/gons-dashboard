import { z } from "zod";
import type { DocumentTemplate } from "./templates";
const kind = z.enum(["handoff", "manual", "learning", "project"]);
const schema = z.object({
  kind,
  project: z.string().max(160),
  title: z.string().max(120),
  drafts: z.record(kind, z.array(z.string().max(4000)).max(7)),
  requestId: z.string().uuid().nullable(),
});
export type DocumentDraft = {
  kind: DocumentTemplate;
  project: string;
  title: string;
  drafts: Partial<Record<DocumentTemplate, string[]>>;
  requestId: string | null;
};
export function parseDocumentDraft(value: string | null): DocumentDraft | null {
  if (!value || value.length > 120_000) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function subscribeToDraft(onChange: () => void) {
  window.addEventListener("gons-document-draft", onChange);
  return () => window.removeEventListener("gons-document-draft", onChange);
}
export function readDocumentDraft(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
