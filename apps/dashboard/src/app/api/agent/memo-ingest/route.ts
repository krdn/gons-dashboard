// /api/agent/memo-ingest — Claude Code 스킬(gon:memo-save)의 메모 저장 입구.
//
// 정책 (spec 2026-07-19-agent-memo-ingest):
//   - Bearer 인증 (env.MCP_DASHBOARD_TOKEN — mediator와 동일 토큰·정책).
//   - 단일 사용자: ADMIN_EMAILS[0] → users 조회.
//   - 저장 후 분류·액션 추출은 after()로 기존 파이프라인 재사용 (best-effort).
//   - rate limiting 없음 (명시 결정 — 단일 사용자 + Bearer 필수).
import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { env } from "@/shared/config/env";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { verifyBearer } from "@/shared/lib/auth/cron";
import { createMemo, classifyAndPersistMemoCategory } from "@/entities/memo/server";
import { deriveTitle } from "@/entities/memo/client";
// features→features 아님 — app 레이어의 features 참조 (FSD 허용 방향).
import { extractAndPersistMemoActions } from "@/features/memo-actions";

export const dynamic = "force-dynamic";

// createMemoAction의 MAX_MEMO_LEN 미러 (상수 공유화 없이 값만 — spec §4.3).
const MAX_MEMO_LEN = 20_000;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(MAX_MEMO_LEN),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  if (!verifyBearer(req, env.MCP_DASHBOARD_TOKEN)) {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400, headers: NO_STORE });
  }

  const adminEmail = env.ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  if (!adminEmail) {
    return Response.json({ error: "ADMIN_EMAILS 미설정" }, { status: 500, headers: NO_STORE });
  }

  const { content } = parsed.data;
  const title = parsed.data.title ?? deriveTitle(content);

  // 오류 경계를 저장 시점까지로 좁힌다 — DB 조회·createMemo 실패는 여기서 500.
  // (조회를 이 try 밖에 두면 throw 시 unhandled로 새 나가는 결함이 있었음.)
  let memo: Awaited<ReturnType<typeof createMemo>>;
  try {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);
    if (row.length === 0) {
      return new Response("User not found", { status: 404, headers: NO_STORE });
    }
    memo = await createMemo({
      userId: row[0].id,
      source: "agent",
      title,
      rawContent: content,
      cleanedContent: content,
    });
  } catch (err) {
    console.error("[memo-ingest] 저장 실패", err);
    return Response.json({ error: "Transient error" }, { status: 500, headers: NO_STORE });
  }

  // 저장은 이미 성공 — 이후 후처리 예약 실패가 응답을 뒤집으면 클라이언트가
  // 500으로 오인해 재시도하고(비멱등) 메모가 중복 저장될 수 있다. 별도 try로 격리.
  try {
    // createMemoAction 성공 분기와 동일 — best-effort, 실패는 cron sweep이 회수.
    after(() =>
      Promise.allSettled([
        classifyAndPersistMemoCategory(memo),
        extractAndPersistMemoActions(memo, new Date()),
      ]),
    );
    revalidatePath("/memos");
  } catch (err) {
    console.error("[memo-ingest] 후처리 예약 실패(저장은 성공)", err);
  }
  return Response.json({ id: memo.id }, { headers: NO_STORE });
}
