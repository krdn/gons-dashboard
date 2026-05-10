// 공통 Server Action 본체 — restart/start/stop이 모두 위임.
// 보안 boundary 5종 (실패 시 즉시 반환, 호출자에 절대 throw 하지 않음):
//  1) Authentication: auth() session 확보 안 되면 UNAUTHORIZED
//  2) Authorization: ADMIN_EMAILS allowlist 미포함 → FORBIDDEN
//  3) Input validation: Zod (uuid + hex 12-64자) — path traversal 방어
//  4) Host validation: hostId가 DB에 없으면 HOST_NOT_FOUND (사용자 입력 신뢰 X)
//  5) Audit log: success/failed 양 경로 기록 (insertAuditLog)
//
// 의도적 설계 결정:
//  - validate-then-lookup 순서: Zod 통과 후 DB hit (불필요한 쿼리 방지)
//  - revalidatePath는 success 경로에서만 호출 (실패 시 캐시 무효화 의미 없음)
//  - errorMessage 500자 제한 (DB row bloat 방지 + Docker stderr 노출 최소화)
//  - try-finally 대신 try-catch로 success/failed 분기 명시 (audit row의 status 필드)
import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { runDocker } from "@/shared/lib/docker";
import { isAdmin } from "../lib/isAdmin";
import { insertAuditLog } from "./insertAuditLog";

export const ActionInput = z.object({
  hostId: z.string().uuid(),
  // Docker container ID는 항상 hex (short=12, full=64). path traversal 방어.
  containerId: z.string().regex(/^[a-f0-9]{12,64}$/),
  containerName: z.string().min(1).max(200),
});

export type ActionInputT = z.infer<typeof ActionInput>;

export type ActionErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "HOST_NOT_FOUND"
  | "DOCKER_ERROR";

export type ActionResult =
  | { ok: true }
  | { ok: false; code: ActionErrorCode; message?: string };

export async function runAction(
  action: "restart" | "start" | "stop",
  rawInput: unknown,
): Promise<ActionResult> {
  // 1) Authentication
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) return { ok: false, code: "UNAUTHORIZED" };

  // 2) Authorization
  if (!isAdmin(email, process.env.ADMIN_EMAILS ?? "")) {
    return { ok: false, code: "FORBIDDEN" };
  }

  // 3) Input validation
  const parsed = ActionInput.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  // 4) Host validation
  const [host] = await db
    .select()
    .from(hosts)
    .where(eq(hosts.id, input.hostId))
    .limit(1);
  if (!host) return { ok: false, code: "HOST_NOT_FOUND" };

  // 5) Docker action + audit log
  const startMs = Date.now();
  try {
    await runDocker(host.dockerContext, [action, input.containerId]);
    const durationMs = Date.now() - startMs;
    await insertAuditLog({
      hostId: host.id,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: email,
      status: "success",
      durationMs,
    });
    revalidatePath(`/servers/${host.name}`);
    return { ok: true };
  } catch (err: unknown) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    await insertAuditLog({
      hostId: host.id,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: email,
      status: "failed",
      errorMessage: message.slice(0, 500),
      durationMs,
    });
    return { ok: false, code: "DOCKER_ERROR", message };
  }
}
