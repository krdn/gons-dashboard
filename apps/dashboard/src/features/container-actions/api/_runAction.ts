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
import { routeServerDetail } from "@/shared/config/routes";
import { env } from "@/shared/config/env";
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
  if (!isAdmin(email, env.ADMIN_EMAILS)) {
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

  // 5) Docker action + audit log — 두 단계를 분리한다.
  //    이전 구현은 둘을 같은 try 안에 두어, Docker 성공 + audit insert 실패 시
  //    catch가 발동해 "failed" 행을 추가로 남기려는 (그마저도 또 실패하는) 잘못된
  //    경로로 빠졌다. 이제 docker 결과는 외부 변수로 캡처하고, audit log 실패는
  //    독립된 try/catch로 swallow하여 docker 결과를 가린다.
  const startMs = Date.now();
  let dockerErr: unknown = null;
  try {
    await runDocker(host.dockerContext, [action, input.containerId]);
  } catch (err) {
    dockerErr = err;
  }
  const durationMs = Date.now() - startMs;

  const rawMessage =
    dockerErr instanceof Error
      ? dockerErr.message
      : dockerErr != null
        ? String(dockerErr)
        : null;
  const message = rawMessage?.slice(0, 500);

  try {
    await insertAuditLog({
      hostId: host.id,
      containerId: input.containerId,
      containerName: input.containerName,
      action,
      userEmail: email,
      status: dockerErr ? "failed" : "success",
      errorMessage: message ?? null,
      durationMs,
    });
  } catch (auditErr) {
    // audit insert 실패는 docker 결과를 가려선 안 됨 — 운영자에게는 stderr로 알림.
    console.error("[container-actions] audit log insert failed", {
      action,
      containerId: input.containerId,
      dockerOk: dockerErr == null,
      auditErr: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  if (dockerErr) {
    return { ok: false, code: "DOCKER_ERROR", message };
  }
  revalidatePath(routeServerDetail(host.name));
  return { ok: true };
}
