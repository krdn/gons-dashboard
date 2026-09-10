"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "./templates";
import { createMemoOnce, getMemo } from "@/entities/memo/server";

const schema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["handoff", "manual", "learning", "project"]),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(20_000),
});
export async function saveDocumentAction(input: {
  requestId: string;
  kind: DocumentTemplate;
  title: string;
  content: string;
}): Promise<
  | { kind: "ok" | "conflict"; id: string }
  | { kind: "invalid" | "unauthorized" | "failed" }
> {
  const session = await auth();
  if (!session?.user?.id) return { kind: "unauthorized" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  try {
    // 선택한 문서 유형을 명시 분류로 저장한다. 후속 AI 액션 추출·다이제스트는 기존 메모 cron 정책을 따른다.
    const memo = await createMemoOnce(
      {
        userId: session.user.id,
        source: "text",
        title: parsed.data.title,
        rawContent: parsed.data.content,
        cleanedContent: parsed.data.content,
      },
      parsed.data.requestId,
      {
        id: `workspace-${parsed.data.kind}`,
        labelKo: DOCUMENT_TEMPLATES[parsed.data.kind].label,
      },
    );
    if (!memo) {
      const existing = await getMemo(session.user.id, parsed.data.requestId);
      return existing
        ? { kind: "conflict", id: existing.id }
        : { kind: "failed" };
    }
    revalidatePath("/projects");
    revalidatePath("/knowledge");
    revalidatePath("/memos");
    revalidatePath("/");
    return { kind: "ok", id: memo.id };
  } catch {
    return { kind: "failed" };
  }
}
