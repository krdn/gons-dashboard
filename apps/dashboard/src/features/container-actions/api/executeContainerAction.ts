// 컨테이너 액션 실행 계층 (이슈 #352).
//
// _runAction 에서 인증·인가(경계 1·2)를 제외한 나머지(경계 3·4·5 + docker 실행)를
// 분리했다. 두 진입점이 공유한다:
//   - Server Action  : auth() + isAdmin() 검사 후 호출 (사람)
//   - auto-remediate : CRON_BEARER_TOKEN 으로 인증된 cron 이 호출 (시스템)
// 무인증 실행 경로는 없다 — 신뢰 주체가 다를 뿐이다.
//
// 의도적 설계 결정 (원래 _runAction 에 있던 근거를 함께 이전):
//  - validate-then-lookup 순서: Zod 통과 후 DB hit (불필요한 쿼리 방지)
//  - errorMessage 500자 제한 (DB row bloat 방지 + Docker stderr 노출 최소화)
//  - try-finally 대신 try-catch로 success/failed 분기 명시 (audit row의 status 필드)
import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { runDocker } from "@/shared/lib/docker";
import { logger } from "@/shared/lib/log";
import { insertAuditLog } from "./insertAuditLog";

const ActionInput = z.object({
  hostId: z.string().uuid(),
  // Docker container ID는 항상 hex (short=12, full=64). path traversal 방어.
  containerId: z.string().regex(/^[a-f0-9]{12,64}$/),
  containerName: z.string().min(1).max(200),
});

export type ActionInputT = z.infer<typeof ActionInput>;

export type ExecuteResult =
  | { ok: true; hostName: string }
  | {
      ok: false;
      code: "INVALID_INPUT" | "HOST_NOT_FOUND" | "DOCKER_ERROR";
      message?: string;
    };

export async function executeContainerAction(
  action: "restart" | "start" | "stop",
  rawInput: unknown,
  actor: string,
): Promise<ExecuteResult> {
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
      userEmail: actor,
      status: dockerErr ? "failed" : "success",
      errorMessage: message ?? null,
      durationMs,
    });
  } catch (auditErr) {
    // audit insert 실패는 docker 결과를 가려선 안 됨 — 운영자에게는 stderr로 알림.
    logger.error("container-actions", "audit-log-insert-failed", {
      action,
      containerId: input.containerId,
      dockerOk: dockerErr == null,
      message: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  if (dockerErr) {
    return { ok: false, code: "DOCKER_ERROR", message };
  }
  return { ok: true, hostName: host.name };
}
