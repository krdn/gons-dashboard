// 공통 Server Action 본체 — restart/start/stop이 모두 위임.
// 보안 boundary 5종 (실패 시 즉시 반환, 호출자에 절대 throw 하지 않음):
//  1) Authentication: auth() session 확보 안 되면 UNAUTHORIZED
//  2) Authorization: ADMIN_EMAILS allowlist 미포함 → FORBIDDEN
//  3~5) Input validation · Host validation · Audit log:
//       executeContainerAction 으로 분리 (이슈 #352) — cron auto-remediate
//       진입점(CRON_BEARER_TOKEN 인증, 세션 없음)과 공유하기 위함. 이 파일은
//       사람 세션 전제인 경계 1·2만 담당하고, 나머지는 위임한다.
//
// 의도적 설계 결정:
//  - revalidatePath는 success 경로에서만 호출 (실패 시 캐시 무효화 의미 없음)
import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { routeServerDetail } from "@/shared/config/routes";
import { env } from "@/shared/config/env";
import { isAdmin } from "../lib/isAdmin";
import {
  executeContainerAction,
  type ActionInputT,
} from "./executeContainerAction";

export type { ActionInputT };

type ActionErrorCode =
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

  // 3~5) 입력 검증 · host 검증 · docker 실행 · 감사 로그 (executeContainerAction)
  const result = await executeContainerAction(action, rawInput, email);
  if (!result.ok) return result;

  revalidatePath(routeServerDetail(result.hostName));
  return { ok: true };
}
